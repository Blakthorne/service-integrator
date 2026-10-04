import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { checkCredits, parseCredits, renderCredits, songCreditsOf } from "@/lib/credits";
import { getDb, withTransaction } from "@/lib/db";
import { findCatalogSong, songLabelOf } from "@/lib/db/catalog";
import { deriveSongCredits } from "@/lib/db/credits";
import { errorMessage } from "@/lib/db/errors";
import { linkSong, type LinkResult } from "@/lib/db/links";
import { findPcoSong, upsertPcoSongs } from "@/lib/db/pcoSongs";
import { listSongTagGroups, replaceSongTags } from "@/lib/db/tags";
import { recordWrite, type NewWriteLogEntry } from "@/lib/db/writeLog";
import type {
    Credit,
    PcoLibrarySong,
    PcoTag,
    Plan,
    PlanItem,
    PlanSummary,
    SongArrangement,
    SongCredits,
} from "@/lib/domain";
import {
    PcoError,
    PcoValidationError,
    assignSongTags,
    createSong,
    createSongItem,
    fetchPlanItems,
    fetchSong,
    fetchSongTags,
    fetchUpcomingPlans,
    getServiceType,
    getServiceTypes,
    getSongArrangements,
    getUpcomingPlans,
    parsePcoId,
    updateSong,
    type PcoSongChanges,
    type SongTag,
} from "@/lib/pco";
import { hasControlCharacter } from "@/lib/settings";
import { getSettings } from "./settings";

/**
 * The app's writes to Planning Center songs and plans: a song's credits
 * (the credit editor), a catalog song created in Planning Center, a song
 * added to an upcoming plan (with the upcoming plans to choose from), and a
 * song's tags (the tag editor).
 *
 * Each write reads what it changes afresh from Planning Center first
 * (refresh-before-write), writes, then brings the mirror (`pco_songs`) and
 * the credits derived from it up to date, and records a `write_log` row for
 * every write it sends, made or refused, with a payload a person can read.
 * The database is opened before anything is sent, and written only after
 * Planning Center has answered: nothing waits on Planning Center inside a
 * transaction. A write refused, by the app or by Planning Center (a 422),
 * comes back as a value with a message fit to show; anything unexpected
 * (Planning Center failing, a database that cannot be opened) throws, after
 * the failed write is logged. Each function takes ids its caller has parsed
 * (convention 19) and checks them again. None revalidates a page: its
 * caller, a server action, does.
 */

const NO_SUCH_PCO_SONG = "There is no such Planning Center song.";
const NO_SUCH_CATALOG_SONG = "There is no such catalog song.";

/** Why a write was refused. */
export type PcoWriteRefusalReason =
    /** A field or an id that is not valid. */
    | "invalid"
    /** There is no such song (in the catalog or Planning Center) or plan. */
    | "not-found"
    /** The catalog song is linked to a Planning Center song already. */
    | "linked"
    /**
     * The same write is under way already: the same catalog song being
     * created in Planning Center, or the same song being added to the same
     * plan.
     */
    | "busy"
    /** The song has no arrangement to put in a plan. */
    | "no-arrangement"
    /** The plan is not an upcoming one any more, or its service type is archived. */
    | "not-upcoming"
    /** The plan holds the song already; adding it again needs `allowDuplicate`. */
    | "already-in-plan"
    /**
     * What the write would change has changed in Planning Center since the
     * page showed it, so nothing was written: the page should show it
     * afresh first.
     */
    | "changed"
    /** Planning Center refused the write as invalid (a 422); `details` gives its reasons. */
    | "refused";

/** A write that was refused, with a message fit to show. */
export interface PcoWriteRefusal {
    ok: false;
    reason: PcoWriteRefusalReason;
    message: string;
    /** Planning Center's reasons, one line each, when it refused the write. */
    details?: string[];
}

function refusal(reason: PcoWriteRefusalReason, message: string): PcoWriteRefusal {
    return { ok: false, reason, message };
}

/** What the write log records of a write that failed: why, Planning Center's status, and its reasons for a 422. */
function writeError(error: unknown): { error: string; status?: number; details?: string[] } {
    if (error instanceof PcoValidationError) {
        return {
            error: error.details.length > 0 ? error.details.join("; ") : error.message,
            status: error.status,
            details: [...error.details],
        };
    }
    if (error instanceof PcoError) {
        return { error: error.message, status: error.status };
    }
    return { error: errorMessage(error) };
}

/** Record a write at `at`; a failure to record it is logged, and does not undo or stop anything. */
function logWrite(db: DatabaseSync, entry: NewWriteLogEntry, at: Date): void {
    try {
        recordWrite(db, entry, at);
    } catch (error) {
        console.error(`Failed to record a write to Planning Center (${entry.target}):`, error);
    }
}

/** A refusal for a write Planning Center refused as invalid (a 422), naming `what`; null for any other failure. */
function refusedByPco(error: unknown, what: string): PcoWriteRefusal | null {
    if (!(error instanceof PcoValidationError)) {
        return null;
    }
    const reasons = error.details.length > 0 ? `: ${error.details.join("; ")}` : ".";
    return {
        ok: false,
        reason: "refused",
        message: `Planning Center refused ${what}${reasons}`,
        details: [...error.details],
    };
}

/** What `promise` resolves to, or null when Planning Center answers 404 (it has no such thing); anything else is rethrown. */
async function unlessMissing<T>(promise: Promise<T>): Promise<T | null> {
    try {
        return await promise;
    } catch (error) {
        if (error instanceof PcoError && error.status === 404) {
            return null;
        }
        throw error;
    }
}

/** A song as the write log shows it. */
function songSummary(song: PcoLibrarySong) {
    const { id, title, author, copyright, ccliNumber } = song;
    return { id, title, author, copyright, ccliNumber };
}

/**
 * Store songs as Planning Center has them now in the mirror, at `now`, and
 * derive their credits afresh with `roles`, in one transaction.
 */
function mirrorSongs(
    db: DatabaseSync,
    songs: readonly PcoLibrarySong[],
    roles: readonly string[],
    now: Date
): void {
    withTransaction(db, () => {
        upsertPcoSongs(db, songs, now);
        deriveSongCredits(db, songs, roles);
    });
}

// ---------------------------------------------------------------------------
// The credit editor
// ---------------------------------------------------------------------------

/** A song's author as Planning Center has it now, and what it reads as. */
export interface CurrentAuthor {
    /** "" for none. */
    author: string;
    credits: SongCredits;
}

/** What `saveSongCredits` did. */
export type SaveSongCreditsResult =
    | ({
          ok: true;
          /** False when the song's author already said exactly this, so nothing was sent. */
          changed: boolean;
      } & CurrentAuthor)
    | (PcoWriteRefusal & {
          /**
           * With a "changed" refusal: the author Planning Center has now,
           * which differs from the one the page showed, and what it reads
           * as, for the page to show instead.
           */
          current?: CurrentAuthor;
      });

/** The same author: Planning Center may send an empty one as null or as "". */
function sameAuthor(a: string | null, b: string | null): boolean {
    return (a ?? "") === (b ?? "");
}

/**
 * Save Planning Center song `pcoSongId`'s credits from the credit editor:
 * one song, only when someone saves, never a mass rewrite. `shownAuthor`
 * is the author the editor showed the song with, which the person edited.
 *
 * The credits are checked against the `creditRoles` setting first
 * (`checkCredits`; with no names at all they are refused, as that would
 * empty the author). The song is then read afresh. When its author already
 * says exactly what the credits write, nothing is sent. When it differs
 * from `shownAuthor` (an empty one and a missing one are the same), it was
 * changed in Planning Center since the page loaded, so the save is
 * refused as "changed", sending nothing, with the author as it is now:
 * the person never saw it, so it is never overwritten. Otherwise its
 * author is written in the convention (`renderCredits`, a PATCH of
 * `author` alone) and the write logged (`song`, with the author before and
 * after). Last, the mirror gets the song as Planning Center has it now,
 * and its credits are derived afresh, a refused song's too, so that the
 * page shows its author as it is now once reloaded.
 *
 * Refused when the id is not a song's or Planning Center has no such song,
 * when the credits do not check, when the author changed since the page
 * loaded, or when Planning Center refuses the write. Throws when Planning
 * Center or the database fails.
 */
export async function saveSongCredits(
    pcoSongId: string,
    shownAuthor: string | null,
    credits: readonly Credit[],
    now: Date = new Date()
): Promise<SaveSongCreditsResult> {
    const id = parsePcoId(pcoSongId);
    if (id === null) {
        return refusal("not-found", NO_SUCH_PCO_SONG);
    }
    const { settings } = getSettings();
    const checked = checkCredits(credits, settings.creditRoles);
    if (!checked.ok) {
        return refusal("invalid", checked.message);
    }
    if (checked.credits.length === 0) {
        return refusal("invalid", "Enter at least one name: the credits would be empty.");
    }
    const db = getDb();
    const song = await unlessMissing(fetchSong(id));
    if (song === null) {
        return refusal("not-found", NO_SUCH_PCO_SONG);
    }
    const currentOf = (of: PcoLibrarySong): CurrentAuthor => ({
        author: of.author ?? "",
        credits: songCreditsOf(parseCredits(of.author, settings.creditRoles)),
    });
    const author = renderCredits(checked.credits);
    const changed = !sameAuthor(song.author, author);
    if (changed && !sameAuthor(song.author, shownAuthor)) {
        mirrorSongs(db, [song], settings.creditRoles, now);
        return {
            ...refusal(
                "changed",
                `The credits of "${song.title}" changed in Planning Center since this page loaded, so nothing was saved. Check them as they are now, then save again.`
            ),
            current: currentOf(song),
        };
    }
    let saved = song;
    if (changed) {
        const target = `song ${id}`;
        const payload = { action: "credits", title: song.title, previous: song.author, author };
        try {
            saved = await updateSong(id, { author });
        } catch (error) {
            logWrite(db, { kind: "song", target, ok: false, payload, result: writeError(error) }, now);
            const refused = refusedByPco(error, `the credits of "${song.title}"`);
            if (refused) {
                return refused;
            }
            throw error;
        }
        logWrite(db, { kind: "song", target, ok: true, payload, result: { song: songSummary(saved) } }, now);
    }
    mirrorSongs(db, [saved], settings.creditRoles, now);
    return { ok: true, changed, ...currentOf(saved) };
}

// ---------------------------------------------------------------------------
// Create in Planning Center
// ---------------------------------------------------------------------------

/** What the "Create in Planning Center" form starts with, for a catalog song. */
export interface NewPcoSongDraft {
    /** The catalog song's id. */
    songId: number;
    /** The title to give the song in Planning Center (see `pcoSongTitleFor`). */
    title: string;
    /** The Planning Center song it is linked to already, or null: only a song with none can be created. */
    pcoSongId: string | null;
}

/**
 * The title a catalog song gets in Planning Center, by the church's
 * practice of one Planning Center song per hymn and tune: the hymn's title,
 * plus " (TUNE)" when the hymn is sung to other tunes too and this song's
 * tune is known ("Abba, Father (PRITCHARD)").
 */
export function pcoSongTitleFor(
    hymnTitle: string,
    tuneName: string | null,
    hymnHasOtherSongs: boolean
): string {
    return tuneName !== null && hymnHasOtherSongs ? `${hymnTitle} (${tuneName})` : hymnTitle;
}

/** The form's first values for catalog song `catalogSongId`, or null when there is no such song. Throws when the database cannot be read. */
export function getNewPcoSongDraft(catalogSongId: number): NewPcoSongDraft | null {
    const song = findCatalogSong(getDb(), catalogSongId);
    if (!song) {
        return null;
    }
    return {
        songId: song.id,
        title: pcoSongTitleFor(song.hymn.title, song.tune?.name ?? null, song.otherTunes.length > 0),
        pcoSongId: song.pcoSongId,
    };
}

/** What the "Create in Planning Center" form sends. */
export interface NewPcoSongForm {
    /** The song's title in Planning Center. */
    title: string;
    /** Its credits, as roles with names, written to its author in the convention. */
    credits: readonly Credit[];
    /** Its copyright; "" for none. */
    copyright: string;
    /** Its CCLI song number, or null for none. */
    ccliNumber: number | null;
    /**
     * Keep the title and credits CCLI gives the song for its number. Without
     * it, the ones typed are written back over CCLI's.
     */
    useCcliDetails: boolean;
}

/** A part of the form a refusal is about. */
export type NewPcoSongField = "title" | "credits" | "copyright" | "ccliNumber";

/** The longest title taken. */
export const PCO_SONG_TITLE_MAX_LENGTH = 255;
/** The longest copyright taken. */
export const PCO_SONG_COPYRIGHT_MAX_LENGTH = 1000;
/** The biggest CCLI song number taken: 15 digits, as the mirror reads them. */
const CCLI_NUMBER_MAX = 999_999_999_999_999;

/** A refusal of the form, about one of its parts. */
export type NewPcoSongRefusal = PcoWriteRefusal & { field?: NewPcoSongField };

/** The form's song, checked: what is sent to Planning Center. */
interface CheckedNewPcoSong {
    title: string;
    /** The credits in the convention; "" for none. */
    author: string;
    copyright: string;
    ccliNumber: number | null;
    useCcliDetails: boolean;
}

function fieldRefusal(field: NewPcoSongField, message: string): NewPcoSongRefusal {
    return { ok: false, reason: "invalid", message, field };
}

/** Check the form against `roles`: each part, or a refusal about the first that is wrong. */
function checkNewPcoSong(
    form: NewPcoSongForm,
    roles: readonly string[]
): { ok: true; song: CheckedNewPcoSong } | NewPcoSongRefusal {
    const title = form.title.trim();
    if (title === "") {
        return fieldRefusal("title", "Enter the song's title.");
    }
    if (hasControlCharacter(title)) {
        return fieldRefusal("title", "The title must be on one line.");
    }
    if (title.length > PCO_SONG_TITLE_MAX_LENGTH) {
        return fieldRefusal("title", `The title is at most ${PCO_SONG_TITLE_MAX_LENGTH} characters.`);
    }
    const credits = checkCredits(form.credits, roles);
    if (!credits.ok) {
        return fieldRefusal("credits", credits.message);
    }
    const copyright = form.copyright.trim();
    if (hasControlCharacter(copyright)) {
        return fieldRefusal("copyright", "The copyright must be on one line.");
    }
    if (copyright.length > PCO_SONG_COPYRIGHT_MAX_LENGTH) {
        return fieldRefusal(
            "copyright",
            `The copyright is at most ${PCO_SONG_COPYRIGHT_MAX_LENGTH} characters.`
        );
    }
    const { ccliNumber } = form;
    if (ccliNumber !== null && !(Number.isSafeInteger(ccliNumber) && ccliNumber > 0 && ccliNumber <= CCLI_NUMBER_MAX)) {
        return fieldRefusal("ccliNumber", "A CCLI song number is a whole number, such as 22025.");
    }
    return {
        ok: true,
        song: {
            title,
            author: renderCredits(credits.credits),
            copyright,
            ccliNumber,
            useCcliDetails: form.useCcliDetails === true,
        },
    };
}

/** What `createSongInPlanningCenter` did. */
export type CreateInPlanningCenterResult =
    | {
          ok: true;
          /** The Planning Center song, as Planning Center has it now. */
          song: PcoLibrarySong;
          /** Whether the catalog song is linked to it now (see `warnings` when not). */
          linked: boolean;
          /**
           * What did not go as planned once the song was created, fit to
           * show. The song exists in Planning Center either way, so nothing
           * is undone, and creating it again would make a second one.
           */
          warnings: string[];
      }
    | NewPcoSongRefusal;

/**
 * The catalog songs being created in Planning Center right now. They live
 * on globalThis so that every copy of this module (convention 15) sees
 * them: a second request for the same song while one is under way is
 * refused rather than creating it twice.
 */
const CREATING_GLOBAL = Symbol.for("service-integrator.pcoSongs.creating.v1");

function songsBeingCreated(): Set<number> {
    const scope = globalThis as unknown as { [CREATING_GLOBAL]?: Set<number> };
    return (scope[CREATING_GLOBAL] ??= new Set());
}

/**
 * Create catalog song `catalogSongId` in Planning Center from the form, link
 * it, and mirror it.
 *
 * The form is checked first (a title, credits that `checkCredits` takes,
 * a copyright on one line, a whole CCLI number or none); the catalog song
 * must exist and have no Planning Center song. Then:
 *
 * 1. The song is created with its title, its credits as its author, and
 *    its copyright, never its CCLI number: on create, the spike found, a
 *    CCLI number makes Planning Center replace the song with CCLI's
 *    details.
 * 2. With a CCLI number, the number is PATCHed in and the song read back.
 *    Unless `useCcliDetails` is set, a title or credits that Planning
 *    Center replaced with CCLI's are written back as typed (credits only
 *    when some were typed); its copyright and admin stay CCLI's.
 * 3. The song is mirrored, its credits derived, and the catalog song
 *    linked to it (`manual`).
 *
 * Every write is logged (`song`). Once the song exists nothing is undone:
 * a later step that fails becomes a warning, and the result is still ok,
 * so that nobody creates the song twice. Refused, creating nothing, when
 * the form or the catalog song is not right, when the same song is being
 * created already, or when Planning Center refuses the song. Throws when
 * Planning Center or the database fails before the song exists.
 */
export async function createSongInPlanningCenter(
    catalogSongId: number,
    form: NewPcoSongForm,
    now: Date = new Date()
): Promise<CreateInPlanningCenterResult> {
    if (!Number.isSafeInteger(catalogSongId) || catalogSongId < 1) {
        return refusal("not-found", NO_SUCH_CATALOG_SONG);
    }
    const { settings } = getSettings();
    const checked = checkNewPcoSong(form, settings.creditRoles);
    if (!checked.ok) {
        return checked;
    }
    const db = getDb();
    const catalogSong = findCatalogSong(db, catalogSongId);
    if (!catalogSong) {
        return refusal("not-found", NO_SUCH_CATALOG_SONG);
    }
    const label = songLabelOf(catalogSong.hymn.title, catalogSong.tune?.name ?? null);
    if (catalogSong.pcoSongId !== null) {
        return refusal(
            "linked",
            `"${label}" is linked to a Planning Center song already, so it is not created again.`
        );
    }
    const creating = songsBeingCreated();
    if (creating.has(catalogSongId)) {
        return refusal("busy", `"${label}" is being created in Planning Center already.`);
    }
    creating.add(catalogSongId);
    try {
        return await createAndLink(db, catalogSongId, checked.song, settings.creditRoles, now);
    } finally {
        creating.delete(catalogSongId);
    }
}

async function createAndLink(
    db: DatabaseSync,
    catalogSongId: number,
    typed: CheckedNewPcoSong,
    roles: readonly string[],
    now: Date
): Promise<CreateInPlanningCenterResult> {
    const payload = {
        action: "create",
        catalogSongId,
        title: typed.title,
        author: typed.author,
        copyright: typed.copyright,
    };
    let song: PcoLibrarySong;
    try {
        song = await createSong({
            title: typed.title,
            ...(typed.author === "" ? {} : { author: typed.author }),
            ...(typed.copyright === "" ? {} : { copyright: typed.copyright }),
        });
    } catch (error) {
        logWrite(
            db,
            { kind: "song", target: `catalog song ${catalogSongId}`, ok: false, payload, result: writeError(error) },
            now
        );
        const refused = refusedByPco(error, `the song "${typed.title}"`);
        if (refused) {
            return refused;
        }
        throw error;
    }
    logWrite(db, { kind: "song", target: `song ${song.id}`, ok: true, payload, result: { song: songSummary(song) } }, now);

    const warnings: string[] = [];
    if (typed.ccliNumber !== null) {
        song = await setCcliNumber(db, song, typed, typed.ccliNumber, warnings, now);
    }

    let link: LinkResult;
    try {
        link = withTransaction(db, () => {
            upsertPcoSongs(db, [song], now);
            deriveSongCredits(db, [song], roles);
            return linkSong(db, catalogSongId, song.id, "manual", now);
        });
    } catch (error) {
        console.error(
            `Created Planning Center song ${song.id} for catalog song ${catalogSongId}, but could not mirror or link it:`,
            error
        );
        warnings.push(
            `The song was created in Planning Center, but could not be linked here (${errorMessage(error)}). Link it from Reconcile after the next sync.`
        );
        return { ok: true, song, linked: false, warnings };
    }
    if (!link.ok) {
        warnings.push(`The song was created in Planning Center, but not linked: ${link.message}`);
    }
    return { ok: true, song, linked: link.ok, warnings };
}

/** "the title", "the credits", "the title and the credits". */
function describeFields(changes: PcoSongChanges): string {
    return [changes.title !== undefined && "the title", changes.author !== undefined && "the credits"]
        .filter(Boolean)
        .join(" and ");
}

/**
 * Give a song just created its CCLI number, read it back, and, unless
 * `useCcliDetails`, write back the title and credits typed where CCLI's
 * replaced them. Every write is logged; a step that fails is a warning,
 * and the song is returned as the last answer from Planning Center left it.
 */
async function setCcliNumber(
    db: DatabaseSync,
    created: PcoLibrarySong,
    typed: CheckedNewPcoSong,
    ccliNumber: number,
    warnings: string[],
    now: Date
): Promise<PcoLibrarySong> {
    const target = `song ${created.id}`;
    const payload = { action: "ccli-number", title: created.title, ccliNumber };
    let song: PcoLibrarySong;
    try {
        song = await updateSong(created.id, { ccliNumber });
    } catch (error) {
        logWrite(db, { kind: "song", target, ok: false, payload, result: writeError(error) }, now);
        warnings.push(
            `The song was created in Planning Center, but its CCLI number could not be set: ${writeError(error).error}`
        );
        return created;
    }
    logWrite(db, { kind: "song", target, ok: true, payload, result: { song: songSummary(song) } }, now);

    // Planning Center may have replaced the song's details with CCLI's.
    try {
        song = await fetchSong(created.id);
    } catch (error) {
        warnings.push(
            `The song was created in Planning Center with its CCLI number, but could not be read back to check its title and credits: ${writeError(error).error}`
        );
        return song;
    }
    if (typed.useCcliDetails) {
        return song;
    }
    const restore: PcoSongChanges = {
        ...(song.title !== typed.title ? { title: typed.title } : {}),
        ...(typed.author !== "" && song.author !== typed.author ? { author: typed.author } : {}),
    };
    if (Object.keys(restore).length === 0) {
        return song;
    }
    const restorePayload = {
        action: "restore-typed-details",
        ccliNumber,
        typed: restore,
        fromCcli: {
            ...(restore.title !== undefined ? { title: song.title } : {}),
            ...(restore.author !== undefined ? { author: song.author } : {}),
        },
    };
    try {
        song = await updateSong(created.id, restore);
    } catch (error) {
        logWrite(db, { kind: "song", target, ok: false, payload: restorePayload, result: writeError(error) }, now);
        warnings.push(
            `CCLI's details replaced ${describeFields(restore)} typed, which could not be written back: ${writeError(error).error}`
        );
        return song;
    }
    logWrite(db, { kind: "song", target, ok: true, payload: restorePayload, result: { song: songSummary(song) } }, now);
    return song;
}

// ---------------------------------------------------------------------------
// Add to plan
// ---------------------------------------------------------------------------

/** Every service type's upcoming plans, for a picker. */
export interface UpcomingPlans {
    /** Earliest first (by `sort_date`), then in service type order, each with its service type's id and name. */
    plans: PlanSummary[];
    /** The service types whose plans could not be read, which are left out. */
    failedServiceTypeIds: string[];
}

/**
 * The plans a song can be added to: every service type's upcoming plans
 * (`filter=future`, which keeps today's plans all day), archived service
 * types left out. One request for the service types, then one per service
 * type, in parallel. A service type whose plans cannot be read is logged,
 * left out and reported, as the plans list does; when the service types
 * cannot be read, it throws.
 */
export async function listUpcomingPlans(): Promise<UpcomingPlans> {
    const serviceTypes = (await getServiceTypes()).filter(({ archived }) => !archived);
    const results = await Promise.allSettled(
        serviceTypes.map((serviceType) => getUpcomingPlans(serviceType.id))
    );
    const plans: PlanSummary[] = [];
    const failedServiceTypeIds: string[] = [];
    results.forEach((result, i) => {
        const { id, name } = serviceTypes[i];
        if (result.status === "fulfilled") {
            plans.push(...result.value.map((plan) => ({ ...plan, serviceType: { id, name } })));
        } else {
            console.error(`Failed to read the upcoming plans of service type ${id}:`, result.reason);
            failedServiceTypeIds.push(id);
        }
    });
    plans.sort((a, b) => (a.sortDate < b.sortDate ? -1 : a.sortDate > b.sortDate ? 1 : 0));
    return { plans, failedServiceTypeIds };
}

/**
 * The arrangement a song is put in a plan with: the first made of those not
 * archived (Planning Center makes the "Default Arrangement" with the song),
 * in Planning Center's order when their times are the same or unknown. Null
 * when every arrangement is archived, or there is none.
 */
export function defaultArrangement(
    arrangements: readonly SongArrangement[]
): SongArrangement | null {
    let first: SongArrangement | null = null;
    for (const arrangement of arrangements) {
        if (arrangement.archived) {
            continue;
        }
        if (
            first === null ||
            (arrangement.createdAt !== null &&
                (first.createdAt === null || arrangement.createdAt < first.createdAt))
        ) {
            first = arrangement;
        }
    }
    return first;
}

/** An item of a plan, as a refusal names it. */
export type PlanItemSummary = Pick<PlanItem, "id" | "title" | "sequence">;

/** What `addSongToPlan` did. */
export type AddSongToPlanResult =
    | {
          ok: true;
          /** The item added, at the end of the plan. */
          item: PlanItem;
          /** The plan it was added to. */
          plan: Plan;
          /** The arrangement it uses. */
          arrangement: SongArrangement;
      }
    | (PcoWriteRefusal & {
          /** With an "already-in-plan" refusal: the plan's items for the song, in plan order. */
          existingItems?: PlanItemSummary[];
      });

/** Options for `addSongToPlan`. */
export interface AddSongToPlanOptions {
    /**
     * Add the song even when the plan holds it already: what the dialog
     * sends once the person has chosen to add another anyway.
     */
    allowDuplicate?: boolean;
}

const NO_SUCH_PLAN = "There is no such plan.";

/**
 * Add Planning Center song `pcoSongId` to plan `planId` of service type
 * `serviceTypeId`, as a new item at the end of the plan, titled with the
 * song's title and using its default arrangement (`defaultArrangement`):
 * the spike found an item given only its song is called "New Item" and has
 * no arrangement.
 *
 * It reads, afresh and in parallel, the song, its arrangements, the service
 * type, the service type's upcoming plans and the plan's items, and goes
 * ahead only when the plan is still one of those upcoming plans
 * (`filter=future`, which keeps today's plans all day) and the service
 * type is not archived: a dialog opened on Sunday and confirmed on Monday
 * never adds to last Sunday's plan. A plan that holds an item for the song
 * already is refused ("already-in-plan", naming its items) unless
 * `allowDuplicate` says the person chose to add another anyway: the app
 * cannot take an item out again, so a retry after an answer that was lost
 * never adds a second one unasked. Then it adds the item (logged as
 * `item`, with the plan's date and the song's title), and mirrors the song
 * as it was read and derives its credits (its last scheduled date catches
 * up at the next sync; a mirror that cannot be written is only logged,
 * since the item is in the plan). One write, no undo.
 *
 * One add of a song to a plan runs at a time: a second while the first is
 * under way, from another tab say, is refused as "busy", never joined or
 * queued, so a double confirm cannot add the song twice.
 *
 * Refused when an id is not a Planning Center id, the same add is under
 * way, Planning Center has no such song, service type or plan, the plan is
 * not upcoming any more or its service type is archived ("not-upcoming"),
 * the song has no arrangement that is not archived, the plan holds the song
 * already and no duplicate is allowed, or Planning Center refuses the item.
 * Throws when Planning Center or the database fails. It revalidates
 * nothing: the action that calls it does.
 */
export async function addSongToPlan(
    serviceTypeId: string,
    planId: string,
    pcoSongId: string,
    { allowDuplicate = false }: AddSongToPlanOptions = {},
    now: Date = new Date()
): Promise<AddSongToPlanResult> {
    const st = parsePcoId(serviceTypeId);
    const planIdChecked = parsePcoId(planId);
    const songId = parsePcoId(pcoSongId);
    if (st === null || planIdChecked === null) {
        return refusal("not-found", NO_SUCH_PLAN);
    }
    if (songId === null) {
        return refusal("not-found", NO_SUCH_PCO_SONG);
    }
    const adding = addsInProgress();
    const key = `${planIdChecked} ${songId}`;
    if (adding.has(key)) {
        return refusal("busy", ADD_IN_PROGRESS_MESSAGE);
    }
    // Set before the first await, so a call that comes in while this one
    // waits on Planning Center finds it.
    adding.add(key);
    try {
        return await addToPlan(st, planIdChecked, songId, allowDuplicate, now);
    } finally {
        adding.delete(key);
    }
}

/** What `addSongToPlan` says to a second add of the same song to the same plan while the first is under way. */
export const ADD_IN_PROGRESS_MESSAGE =
    "This song is being added to that plan already, so this added nothing. Wait for that to finish, then look at the plan.";

/**
 * The songs being added to plans right now, as "<plan id> <song id>"
 * (a plan's id is unique across service types). They live on globalThis,
 * not in a module constant, because a server action's copy of this module
 * is not the page's (convention 15), and two tabs confirming at once must
 * still see each other. Bump the version if what is stored here changes.
 */
const ADDING_GLOBAL = Symbol.for("service-integrator.pcoSongs.addingToPlans.v1");

function addsInProgress(): Set<string> {
    const scope = globalThis as unknown as { [ADDING_GLOBAL]?: Set<string> };
    return (scope[ADDING_GLOBAL] ??= new Set());
}

/** The work of `addSongToPlan`, one at a time for a song and a plan. */
async function addToPlan(
    st: string,
    planIdChecked: string,
    songId: string,
    allowDuplicate: boolean,
    now: Date
): Promise<AddSongToPlanResult> {
    const { settings } = getSettings();
    const db = getDb();
    const [song, arrangements, serviceType, upcoming, planItems] = await Promise.all([
        unlessMissing(fetchSong(songId)),
        unlessMissing(getSongArrangements(songId)),
        unlessMissing(getServiceType(st)),
        unlessMissing(fetchUpcomingPlans(st)),
        allowDuplicate ? null : unlessMissing(fetchPlanItems(st, planIdChecked)),
    ]);
    if (song === null || arrangements === null) {
        return refusal("not-found", NO_SUCH_PCO_SONG);
    }
    if (serviceType === null || upcoming === null || (!allowDuplicate && planItems === null)) {
        return refusal("not-found", NO_SUCH_PLAN);
    }
    if (serviceType.archived) {
        return refusal(
            "not-upcoming",
            `${serviceType.name} is archived in Planning Center, so nothing was added to its plans.`
        );
    }
    const plan = upcoming.find(({ id }) => id === planIdChecked);
    if (plan === undefined) {
        return refusal(
            "not-upcoming",
            `That plan of ${serviceType.name} is not an upcoming plan any more, so nothing was added. Choose one of the plans ahead.`
        );
    }
    const arrangement = defaultArrangement(arrangements);
    if (arrangement === null) {
        return refusal(
            "no-arrangement",
            `"${song.title}" has no arrangement in Planning Center to put in a plan.`
        );
    }
    const existingItems: PlanItemSummary[] = (planItems?.items ?? [])
        .filter((item) => item.itemType === "song" && item.songId === songId)
        .map(({ id, title, sequence }) => ({ id, title, sequence }));
    if (existingItems.length > 0) {
        const [first] = existingItems;
        return {
            ...refusal(
                "already-in-plan",
                `The plan for ${plan.dates} has "${song.title}" already, as its item "${first.title}", so nothing was added. Add another only if the song should be in the plan twice.`
            ),
            existingItems,
        };
    }
    const payload = {
        action: "add-song",
        serviceTypeId: st,
        planId: planIdChecked,
        planDates: plan.dates,
        songId,
        title: song.title,
        arrangementId: arrangement.id,
        arrangement: arrangement.name,
        ...(allowDuplicate ? { allowDuplicate: true } : {}),
    };
    let item: PlanItem;
    try {
        item = await createSongItem(st, planIdChecked, {
            songId,
            arrangementId: arrangement.id,
            title: song.title,
        });
    } catch (error) {
        logWrite(
            db,
            { kind: "item", target: `plan ${planIdChecked}`, ok: false, payload, result: writeError(error) },
            now
        );
        const refused = refusedByPco(error, `"${song.title}" in the plan for ${plan.dates}`);
        if (refused) {
            return refused;
        }
        throw error;
    }
    logWrite(
        db,
        {
            kind: "item",
            target: `plan ${planIdChecked} item ${item.id}`,
            ok: true,
            payload,
            result: { item: { id: item.id, title: item.title, sequence: item.sequence } },
        },
        now
    );
    try {
        mirrorSongs(db, [song], settings.creditRoles, now);
    } catch (error) {
        // The item is in the plan: the next sync mirrors the song, and
        // throwing now would invite adding it a second time.
        console.error(`Added song ${songId} to plan ${planIdChecked}, but could not mirror it:`, error);
    }
    return { ok: true, item, plan, arrangement };
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

/** What `saveSongTags` did. */
export type SaveSongTagsResult =
    | {
          ok: true;
          /** False when the song's tags in Planning Center already had the changes, so nothing was sent. */
          changed: boolean;
          /** The song's whole set of tags in Planning Center now. */
          tagIds: string[];
          /**
           * Tags the song has in Planning Center that the mirror does not
           * know yet (made since the last tags sync), so nobody saw them:
           * they were left as they are.
           */
          kept: SongTag[];
      }
    | PcoWriteRefusal;

/** The tags as the write log shows them: id and name. */
function tagSummaries(tags: readonly Pick<PcoTag, "id" | "name">[]) {
    return tags.map(({ id, name }) => ({ id, name }));
}

/** The ids in `ids` that are not in `without`, each once, in order. */
function idsNotIn(ids: Iterable<string>, without: ReadonlySet<string>): string[] {
    return [...new Set(ids)].filter((id) => !without.has(id));
}

/**
 * Apply the tag editor's changes to mirrored Planning Center song
 * `pcoSongId`'s tags as Planning Center has them now. `shown` is the set
 * of tags the editor showed the song with, and `wanted` the set it was
 * saved with: what the person changed is only the tags they added
 * (`wanted` but not `shown`) and the ones they removed (`shown` but not
 * `wanted`). Every other tag is left exactly as Planning Center has it
 * now, so a tag set in Planning Center since the page loaded, or one the
 * mirror does not know yet, is never dropped, and one removed there is
 * never put back.
 *
 * Each tag added must be a tag of one of the mirror's song tag groups
 * (never an arrangement group's, which Planning Center would silently
 * ignore), and a group that takes one tag may end with one at most. The
 * song's tags are read afresh, the changes applied to them, and, since
 * `assign_tags` replaces them all, the whole resulting set is sent, unless
 * it is the set the song has already. The write is logged (`tags`, with
 * the tags' names before and after, and those added and removed), and the
 * mirror's tags for the song replaced with what it has now.
 *
 * Refused when the song id is not one, the mirror or Planning Center has
 * no such song, a tag added is not a mirrored song tag, a group that takes
 * one tag would end with more (because one was chosen, or because the song
 * has another of its tags in Planning Center now), or Planning Center
 * refuses the write. Throws when Planning Center or the database fails.
 */
export async function saveSongTags(
    pcoSongId: string,
    shown: readonly string[],
    wanted: readonly string[],
    now: Date = new Date()
): Promise<SaveSongTagsResult> {
    const id = parsePcoId(pcoSongId);
    if (id === null) {
        return refusal("not-found", NO_SUCH_PCO_SONG);
    }
    const db = getDb();
    const mirrored = findPcoSong(db, id);
    if (mirrored === null) {
        return refusal("not-found", NO_SUCH_PCO_SONG);
    }
    const groups = listSongTagGroups(db);
    const known = new Map(groups.flatMap((group) => group.tags.map((tag) => [tag.id, tag] as const)));
    const added = idsNotIn(wanted, new Set(shown));
    const removed = new Set(idsNotIn(shown, new Set(wanted)));
    if (added.some((tagId) => !known.has(tagId))) {
        return refusal(
            "invalid",
            "One of the tags chosen is not a song tag in Planning Center any more. Sync the tags and choose again."
        );
    }
    const wantedSet = new Set(wanted);
    for (const group of groups) {
        if (!group.allowMultiple && group.tags.filter((tag) => wantedSet.has(tag.id)).length > 1) {
            return refusal("invalid", `Choose one tag at most of "${group.name}".`);
        }
    }

    const current = await unlessMissing(fetchSongTags(id));
    if (current === null) {
        return refusal("not-found", NO_SUCH_PCO_SONG);
    }
    const currentIds = new Set(current.map((tag) => tag.id));
    const next = new Set([...idsNotIn(currentIds, removed), ...added]);
    for (const group of groups) {
        if (!group.allowMultiple && group.tags.filter((tag) => next.has(tag.id)).length > 1) {
            return refusal(
                "changed",
                `"${group.name}" takes one tag, and "${mirrored.title}" has another of its tags in Planning Center now, set since this page loaded, so nothing was saved. Reload the page and choose again.`
            );
        }
    }
    // The mirror's tags in its order (by group, then by name), then any it
    // does not know that stay: the person never saw them, so they are kept.
    const kept = current.filter((tag) => !known.has(tag.id) && next.has(tag.id));
    const nextIds = [
        ...[...known.keys()].filter((tagId) => next.has(tagId)),
        ...kept.map((tag) => tag.id),
    ];
    const changed = nextIds.length !== currentIds.size || nextIds.some((tagId) => !currentIds.has(tagId));
    if (changed) {
        const nameOf = new Map<string, string>([
            ...current.map((tag) => [tag.id, tag.name] as const),
            ...[...known.values()].map((tag) => [tag.id, tag.name] as const),
        ]);
        const summary = (ids: Iterable<string>) =>
            tagSummaries([...ids].map((tagId) => ({ id: tagId, name: nameOf.get(tagId) ?? tagId })));
        const target = `song ${id}`;
        const payload = {
            action: "assign",
            title: mirrored.title,
            tags: summary(nextIds),
            previous: tagSummaries(current),
            added: summary(added.filter((tagId) => !currentIds.has(tagId))),
            removed: summary([...removed].filter((tagId) => currentIds.has(tagId))),
        };
        try {
            await assignSongTags(id, nextIds);
        } catch (error) {
            logWrite(db, { kind: "tags", target, ok: false, payload, result: writeError(error) }, now);
            const refused = refusedByPco(error, `the tags of "${mirrored.title}"`);
            if (refused) {
                return refused;
            }
            throw error;
        }
        logWrite(db, { kind: "tags", target, ok: true, payload, result: { tagIds: nextIds } }, now);
    }
    const tagIds = changed ? nextIds : current.map((tag) => tag.id);
    replaceSongTags(db, id, tagIds);
    return { ok: true, changed, tagIds, kept };
}
