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
    fetchSong,
    fetchSongTags,
    getPlan,
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
    /** The same catalog song is being created in Planning Center already. */
    | "busy"
    /** The song has no arrangement to put in a plan. */
    | "no-arrangement"
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

/** What `saveSongCredits` did. */
export type SaveSongCreditsResult =
    | {
          ok: true;
          /** False when the song's author already said exactly this, so nothing was sent. */
          changed: boolean;
          /** The song's author as Planning Center has it now. */
          author: string;
          /** What it reads as now, as the mirror stores it. */
          credits: SongCredits;
      }
    | PcoWriteRefusal;

/**
 * Save Planning Center song `pcoSongId`'s credits from the credit editor:
 * one song, only when someone saves, never a mass rewrite.
 *
 * The credits are checked against the `creditRoles` setting first
 * (`checkCredits`; with no names at all they are refused, as that would
 * empty the author). The song is then read afresh, and its author
 * written in the convention (`renderCredits`, a PATCH of `author` alone)
 * unless it says exactly that already; the write is logged (`song`, with
 * the author before and after). Last, the mirror gets the song as
 * Planning Center has it now, and its credits are derived afresh.
 *
 * Refused when the id is not a song's or Planning Center has no such song,
 * when the credits do not check, or when Planning Center refuses the
 * write. Throws when Planning Center or the database fails.
 */
export async function saveSongCredits(
    pcoSongId: string,
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
    const author = renderCredits(checked.credits);
    let saved = song;
    const changed = song.author !== author;
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
    return {
        ok: true,
        changed,
        author: saved.author ?? "",
        credits: songCreditsOf(parseCredits(saved.author, settings.creditRoles)),
    };
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
    | PcoWriteRefusal;

/**
 * Add Planning Center song `pcoSongId` to plan `planId` of service type
 * `serviceTypeId`, as a new item at the end of the plan, titled with the
 * song's title and using its default arrangement (`defaultArrangement`):
 * the spike found an item given only its song is called "New Item" and has
 * no arrangement.
 *
 * It reads the song, its arrangements and the plan afresh, in parallel;
 * adds the item (logged as `item`, with the plan's date and the song's
 * title); then mirrors the song as it was read and derives its credits
 * (its last scheduled date catches up at the next sync; a mirror that
 * cannot be written is only logged, since the item is in the plan). One
 * write, no undo. Refused when an id is not a Planning Center id, Planning Center has
 * no such song or plan, the song has no arrangement that is not archived,
 * or Planning Center refuses the item. Throws when Planning Center or the
 * database fails. It revalidates nothing: the action that calls it does.
 */
export async function addSongToPlan(
    serviceTypeId: string,
    planId: string,
    pcoSongId: string,
    now: Date = new Date()
): Promise<AddSongToPlanResult> {
    const st = parsePcoId(serviceTypeId);
    const planIdChecked = parsePcoId(planId);
    const songId = parsePcoId(pcoSongId);
    if (st === null || planIdChecked === null) {
        return refusal("not-found", "There is no such plan.");
    }
    if (songId === null) {
        return refusal("not-found", NO_SUCH_PCO_SONG);
    }
    const { settings } = getSettings();
    const db = getDb();
    const [song, arrangements, plan] = await Promise.all([
        unlessMissing(fetchSong(songId)),
        unlessMissing(getSongArrangements(songId)),
        unlessMissing(getPlan(st, planIdChecked)),
    ]);
    if (song === null || arrangements === null) {
        return refusal("not-found", NO_SUCH_PCO_SONG);
    }
    if (plan === null) {
        return refusal("not-found", "There is no such plan.");
    }
    const arrangement = defaultArrangement(arrangements);
    if (arrangement === null) {
        return refusal(
            "no-arrangement",
            `"${song.title}" has no arrangement in Planning Center to put in a plan.`
        );
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
          /** False when the song had exactly these tags already, so nothing was sent. */
          changed: boolean;
          /** The song's whole set of tags now, as sent (or as it was, when unchanged). */
          tagIds: string[];
          /**
           * Tags the song has in Planning Center that the mirror does not
           * know yet (made since the last tags sync), so nobody could have
           * chosen to drop them: they were kept.
           */
          kept: SongTag[];
      }
    | PcoWriteRefusal;

/** The tags as the write log shows them: id and name. */
function tagSummaries(tags: readonly Pick<PcoTag, "id" | "name">[]) {
    return tags.map(({ id, name }) => ({ id, name }));
}

/**
 * Give mirrored Planning Center song `pcoSongId` the song tags `tagIds`
 * from the tag editor: the whole set it should have of the mirror's song
 * tag groups.
 *
 * Every id must be a tag of one of the mirror's song tag groups (never an
 * arrangement group's, which Planning Center would silently ignore), and a
 * group that takes one tag may have only one chosen. The song's tags are
 * then read afresh, and, since `assign_tags` replaces all of them, the full
 * new set is sent: the ids chosen, plus any tag the song has that the
 * mirror does not know yet, kept as it is (`kept`). Nothing is sent when
 * the song has exactly that set already. The write is logged (`tags`, with
 * the tags' names before and after), and the mirror's tags for the song
 * replaced.
 *
 * Refused when the song id is not one, the mirror or Planning Center has
 * no such song, a tag is not a mirrored song tag or a group has too many,
 * or Planning Center refuses the write. Throws when Planning Center or the
 * database fails.
 */
export async function saveSongTags(
    pcoSongId: string,
    tagIds: readonly string[],
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
    const wanted = new Set(tagIds);
    for (const tagId of wanted) {
        if (!known.has(tagId)) {
            return refusal(
                "invalid",
                "One of the tags chosen is not a song tag in Planning Center any more. Sync the tags and choose again."
            );
        }
    }
    for (const group of groups) {
        if (!group.allowMultiple && group.tags.filter((tag) => wanted.has(tag.id)).length > 1) {
            return refusal("invalid", `Choose one tag at most of "${group.name}".`);
        }
    }
    // In the mirror's order: by group, then by name.
    const chosen = [...known.values()].filter((tag) => wanted.has(tag.id));

    const current = await unlessMissing(fetchSongTags(id));
    if (current === null) {
        return refusal("not-found", NO_SUCH_PCO_SONG);
    }
    const kept = current.filter((tag) => !known.has(tag.id));
    const next = [...chosen.map((tag) => tag.id), ...kept.map((tag) => tag.id)];
    const before = new Set(current.map((tag) => tag.id));
    const changed = next.length !== before.size || next.some((tagId) => !before.has(tagId));
    if (changed) {
        const target = `song ${id}`;
        const payload = {
            action: "assign",
            title: mirrored.title,
            tags: tagSummaries([...chosen, ...kept]),
            previous: tagSummaries(current),
        };
        try {
            await assignSongTags(id, next);
        } catch (error) {
            logWrite(db, { kind: "tags", target, ok: false, payload, result: writeError(error) }, now);
            const refused = refusedByPco(error, `the tags of "${mirrored.title}"`);
            if (refused) {
                return refused;
            }
            throw error;
        }
        logWrite(db, { kind: "tags", target, ok: true, payload, result: { tagIds: next } }, now);
    }
    replaceSongTags(db, id, changed ? next : current.map((tag) => tag.id));
    return { ok: true, changed, tagIds: changed ? next : current.map((tag) => tag.id), kept };
}
