"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { upcomingPlanOptions, type UpcomingPlanOption } from "@/lib/catalog/addToPlan";
import { readCreditsInput } from "@/lib/catalog/creditsEditor";
import { parseCatalogId } from "@/lib/catalog/ids";
import { readCcliSongNumber, readNewPcoSongInput } from "@/lib/catalog/newPcoSong";
import { readTagIdsInput } from "@/lib/catalog/tagsEditor";
import type { Credit, PcoTag, SongCredits } from "@/lib/domain";
import { parsePcoId } from "@/lib/pco";
import {
    addSongToPlan,
    createSongInPlanningCenter,
    listUpcomingPlans,
    saveSongCredits,
    saveSongTags,
    type AddSongToPlanResult,
    type CreateInPlanningCenterResult,
    type NewPcoSongField,
    type PlanItemSummary,
    type SaveSongCreditsResult,
    type SaveSongTagsResult,
    type UpcomingPlans,
} from "@/lib/queries/pcoSongs";
import { routes } from "@/lib/routes";

/**
 * The song page's writes to Planning Center: a linked song's credits (the
 * Credits card), its tags (the Tags card) and adding it to an upcoming plan
 * (with the plans to choose from), and creating an unlinked one in Planning
 * Center.
 *
 * Every one of them waits on Planning Center, so the page calls each from an
 * event handler with its pending state in `useState`, never as a form
 * action or in a transition, which would hold every navigation until
 * Planning Center answered (convention 15). Each is a public POST endpoint:
 * it checks the session first and throws without one, takes its arguments
 * as anything the network may send, passes every id through the parser for
 * its kind (convention 19) and every other argument through a reader of its
 * shape, and calls only `lib/queries`. A refusal comes back with its
 * message; a failure is logged and comes back as a message that says what
 * may or may not have been written. After a write, each revalidates the
 * pages that show what it changed.
 */

/** What an action says when it refuses or fails, fit to show. */
export type SongPageRefusal = { ok: false; message: string };

/** Shown when an id is not one of its kind: a stale or tampered page. */
const NOT_AN_ID_MESSAGE =
    "This page asked for a change that cannot be made. Reload it and try again.";

/** Shown when an argument is not the shape the page sends: a stale or tampered page. */
const UNREADABLE_MESSAGE =
    "This page sent something the server cannot read. Reload it and try again.";

/**
 * A server action is a public POST endpoint, so each one checks the session
 * itself rather than relying on the middleware (convention 15), and throws
 * without one.
 */
async function requireSession(): Promise<void> {
    const session = await auth();
    if (!session) {
        throw new Error("Not signed in");
    }
}

/** Log a failure nobody expected, and give the page `message`. */
function failed(what: string, error: unknown, message: string): SongPageRefusal {
    console.error(`Failed to ${what}:`, error);
    return { ok: false, message };
}

/** A refusal as the page shows it: its message, and nothing of the query's own detail. */
function refused({ message }: { message: string }): SongPageRefusal {
    return { ok: false, message };
}

// ---------------------------------------------------------------------------
// Credits
// ---------------------------------------------------------------------------

/** What saving the credits tells the Credits card. */
export type SaveSongCreditsState =
    | {
          ok: true;
          /** False when Planning Center already had exactly these credits, so nothing was sent. */
          changed: boolean;
          /** The song's author as Planning Center has it now. */
          author: string;
          /** What that author reads as. */
          credits: SongCredits;
      }
    | (SongPageRefusal & {
          /**
           * When the author changed in Planning Center since the page showed
           * it, so nothing was saved: the author it has now ("" for none)
           * and what it reads as, for the card to start again from.
           */
          current?: { author: string; credits: SongCredits };
      });

const CREDITS_FAILURE_MESSAGE =
    "Something went wrong, so the credits may or may not have been saved. Look at the song in Planning Center before trying again; the server log has the details.";

/**
 * The Credits card's Save: write `credits` to Planning Center song
 * `pcoSongId`'s author in the labelled convention (`saveSongCredits`, which
 * reads the song afresh, writes only when its author changes, logs the
 * write and brings the mirror up to date). `shownAuthor` is the author the
 * card showed and the person edited ("" or null for none): when Planning
 * Center has another one now, nothing is written, and the refusal carries
 * the author as it is now (`current`).
 *
 * After a save the catalog's pages are revalidated, the song's page among
 * them, and so are the plans', whose copyright text prints the credits;
 * the dashboard shows no credits. After a refusal because the author
 * changed, the catalog's are revalidated too: the mirror took the song as
 * it is now, so the page shows its author afresh.
 */
export async function saveSongCreditsAction(
    pcoSongId: string,
    shownAuthor: string | null,
    credits: readonly Credit[]
): Promise<SaveSongCreditsState> {
    await requireSession();
    const id = parsePcoId(pcoSongId);
    if (id === null) {
        return { ok: false, message: NOT_AN_ID_MESSAGE };
    }
    const read = readCreditsInput(credits);
    if (read === null || (shownAuthor !== null && typeof shownAuthor !== "string")) {
        return { ok: false, message: UNREADABLE_MESSAGE };
    }
    let result: SaveSongCreditsResult;
    try {
        result = await saveSongCredits(id, shownAuthor, read);
    } catch (error) {
        return failed(`save the credits of Planning Center song ${id}`, error, CREDITS_FAILURE_MESSAGE);
    }
    if (!result.ok) {
        if (result.current === undefined) {
            return refused(result);
        }
        revalidatePath(routes.catalog(), "layout");
        const { author, credits: currentCredits } = result.current;
        return { ok: false, message: result.message, current: { author, credits: currentCredits } };
    }
    revalidatePath(routes.catalog(), "layout");
    revalidatePath(routes.plans(), "layout");
    return { ok: true, changed: result.changed, author: result.author, credits: result.credits };
}

// ---------------------------------------------------------------------------
// Create in Planning Center
// ---------------------------------------------------------------------------

/** What "Create in Planning Center" tells its form. */
export type CreateInPlanningCenterState =
    | {
          ok: true;
          /** The new Planning Center song's id and title, as Planning Center has them. */
          pcoSongId: string;
          title: string;
          /** Whether the catalog song is linked to it now. */
          linked: boolean;
          /** What did not go as planned once the song existed, fit to show. */
          warnings: string[];
      }
    | (SongPageRefusal & {
          /** The part of the form the refusal is about, when it is about one. */
          field?: NewPcoSongField;
      });

const CREATE_FAILURE_MESSAGE =
    "Something went wrong, so it is not known whether the song was created in Planning Center. Look for it there, or on Reconcile after the next sync, before trying again, so that it is not created twice; the server log has the details.";

/**
 * "Create in Planning Center": create catalog song `songId` in Planning
 * Center from `form` (title, credits, copyright, and a CCLI number, as
 * typed, with whether to keep CCLI's details), link it and mirror it
 * (`createSongInPlanningCenter`). A refusal about a part of the form names
 * it (`field`). Once Planning Center has the song, the result is ok, with
 * any later step that failed as a warning. Then the pages that show links
 * are revalidated: the catalog's (the song's page shows its new link), the
 * plans' (their numbers come from links) and the dashboard (its songs'
 * numbers and its to-dos).
 */
export async function createInPlanningCenterAction(
    songId: string,
    form: {
        title: string;
        credits: readonly Credit[];
        copyright: string;
        ccliNumber: string;
        useCcliDetails: boolean;
    }
): Promise<CreateInPlanningCenterState> {
    await requireSession();
    const id = parseCatalogId(songId);
    if (id === null) {
        return { ok: false, message: NOT_AN_ID_MESSAGE };
    }
    const input = readNewPcoSongInput(form);
    if (input === null) {
        return { ok: false, message: UNREADABLE_MESSAGE };
    }
    const ccliNumber = readCcliSongNumber(input.ccliNumber);
    if (!ccliNumber.ok) {
        return { ok: false, message: ccliNumber.message, field: "ccliNumber" };
    }
    let result: CreateInPlanningCenterResult;
    try {
        result = await createSongInPlanningCenter(id, {
            title: input.title,
            credits: input.credits,
            copyright: input.copyright,
            ccliNumber: ccliNumber.value,
            useCcliDetails: input.useCcliDetails,
        });
    } catch (error) {
        return failed(`create catalog song ${id} in Planning Center`, error, CREATE_FAILURE_MESSAGE);
    }
    if (!result.ok) {
        return result.field === undefined
            ? refused(result)
            : { ok: false, message: result.message, field: result.field };
    }
    revalidatePath(routes.catalog(), "layout");
    revalidatePath(routes.plans(), "layout");
    revalidatePath(routes.home());
    return {
        ok: true,
        pcoSongId: result.song.id,
        title: result.song.title,
        linked: result.linked,
        warnings: [...result.warnings],
    };
}

// ---------------------------------------------------------------------------
// Add to a plan
// ---------------------------------------------------------------------------

/** What reading the upcoming plans tells the "Add to a plan" dialog. */
export type UpcomingPlansState =
    | {
          ok: true;
          /** Earliest first: every service type's upcoming plans. */
          plans: UpcomingPlanOption[];
          /** How many service types' plans could not be read, and are left out. */
          unreadServiceTypes: number;
      }
    | SongPageRefusal;

const UPCOMING_PLANS_FAILURE_MESSAGE =
    "The upcoming plans could not be read from Planning Center. Try again; the server log has the details.";

/**
 * The plans "Add to a plan" offers: every service type's upcoming plans
 * (`listUpcomingPlans`), as the picker shows them. A service type whose
 * plans cannot be read is left out and counted. It reads Planning Center,
 * so the dialog calls it when it opens, rather than the page on every load
 * (the song page reads only the database, and is prefetched). It writes
 * nothing and revalidates nothing.
 */
export async function listUpcomingPlansAction(): Promise<UpcomingPlansState> {
    await requireSession();
    let upcoming: UpcomingPlans;
    try {
        upcoming = await listUpcomingPlans();
    } catch (error) {
        return failed("read the upcoming plans", error, UPCOMING_PLANS_FAILURE_MESSAGE);
    }
    return {
        ok: true,
        plans: upcomingPlanOptions(upcoming.plans),
        unreadServiceTypes: upcoming.failedServiceTypeIds.length,
    };
}

/** What adding the song to a plan tells the dialog. */
export type AddSongToPlanState =
    | {
          ok: true;
          /** The new item's id and title (the song's title in Planning Center). */
          itemId: string;
          title: string;
          /** The name of the arrangement it uses. */
          arrangement: string;
      }
    /** Refused, so nothing was added: the plan is not upcoming any more, the song has no arrangement, and so on. */
    | (SongPageRefusal & { kind: "refused" })
    /**
     * Something failed, so it is not known whether the song was added: the
     * dialog never offers to try again in one step, since the app cannot
     * take an item out again.
     */
    | (SongPageRefusal & { kind: "unknown" })
    /** The plan holds the song already, so nothing was added; adding another needs `allowDuplicate`. */
    | (SongPageRefusal & {
          kind: "already-in-plan";
          /** The plan's items for the song, in plan order. */
          existingItems: PlanItemSummary[];
      });

const ADD_TO_PLAN_FAILURE_MESSAGE =
    "Something went wrong, so it is not known whether the song was added to the plan. Look at the plan in Planning Center before you add it again; the server log has the details.";

/**
 * "Add to a plan": add Planning Center song `pcoSongId` to plan `planId` of
 * service type `serviceTypeId`, at its end, with the song's title and its
 * default arrangement (`addSongToPlan`, which reads the song, the plan and
 * its items afresh and logs the write). One write, which the app cannot
 * undo; the dialog has named the plan first.
 *
 * A plan that holds the song already is refused ("already-in-plan", with
 * its items) unless `allowDuplicate` is true, which the dialog sends once
 * the person chose to add another anyway; anything but true is false. A
 * failure is logged and comes back as "unknown": the song may have been
 * added (a write that timed out may have been applied). After an add, and
 * after an unknown outcome, that plan's pages are revalidated, the
 * dashboard, which lists the next plans' songs, and the catalog's pages,
 * since the song was mirrored as Planning Center has it now.
 */
export async function addSongToPlanAction(
    serviceTypeId: string,
    planId: string,
    pcoSongId: string,
    allowDuplicate?: boolean
): Promise<AddSongToPlanState> {
    await requireSession();
    const st = parsePcoId(serviceTypeId);
    const plan = parsePcoId(planId);
    const song = parsePcoId(pcoSongId);
    if (st === null || plan === null || song === null) {
        return { ok: false, kind: "refused", message: NOT_AN_ID_MESSAGE };
    }
    const revalidateAdd = () => {
        revalidatePath(routes.plan(st, plan), "layout");
        revalidatePath(routes.home());
        revalidatePath(routes.catalog(), "layout");
    };
    let result: AddSongToPlanResult;
    try {
        result = await addSongToPlan(st, plan, song, { allowDuplicate: allowDuplicate === true });
    } catch (error) {
        // The song may be in the plan now: let its pages show what is there.
        revalidateAdd();
        return {
            ...failed(`add Planning Center song ${song} to plan ${st}/${plan}`, error, ADD_TO_PLAN_FAILURE_MESSAGE),
            kind: "unknown",
        };
    }
    if (!result.ok) {
        return result.reason === "already-in-plan"
            ? {
                  ok: false,
                  kind: "already-in-plan",
                  message: result.message,
                  existingItems: (result.existingItems ?? []).map(({ id, title, sequence }) => ({
                      id,
                      title,
                      sequence,
                  })),
              }
            : { ...refused(result), kind: "refused" };
    }
    revalidateAdd();
    return {
        ok: true,
        itemId: result.item.id,
        title: result.item.title,
        arrangement: result.arrangement.name,
    };
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

/** What saving the tags tells the Tags card. */
export type SaveSongTagsState =
    | {
          ok: true;
          /** False when the song's tags in Planning Center already had the changes, so nothing was sent. */
          changed: boolean;
          /** The song's whole set of tags in Planning Center now. */
          tagIds: string[];
          /** Tags it has that the app does not know yet, which were left as they are. */
          kept: Pick<PcoTag, "id" | "name">[];
      }
    | (SongPageRefusal & {
          /**
           * True when the song's tags changed in Planning Center since the
           * page showed them in a way the changes cannot be applied to (a
           * group that takes one tag would end with two), so nothing was
           * saved: the page has to show them afresh first.
           */
          changedSinceShown?: true;
      });

const TAGS_FAILURE_MESSAGE =
    "Something went wrong, so the tags may or may not have been saved. Look at the song in Planning Center before trying again; the server log has the details.";

/** Every id of `raw` through `parsePcoId`, or null when one is not a Planning Center id. */
function parseTagIds(raw: readonly string[]): string[] | null {
    const ids: string[] = [];
    for (const value of raw) {
        const id = parsePcoId(value);
        if (id === null) {
            return null;
        }
        ids.push(id);
    }
    return ids;
}

/**
 * The Tags card's Save: apply the person's changes to Planning Center song
 * `pcoSongId`'s tags (`saveSongTags`). `shown` is the set of tags the card
 * showed, and `wanted` the set it was saved with; only the tags added and
 * removed between them are applied, to the song's tags as Planning Center
 * has them now, so a tag set there since the page loaded is never dropped.
 * The query checks them against the mirror, writes only when the tags
 * change, logs the write and updates the mirror. Then the catalog's pages
 * are revalidated: the song's page, and the songs list, whose tag filter
 * reads the mirror. The plans' pages and the dashboard show no tags.
 */
export async function saveSongTagsAction(
    pcoSongId: string,
    shown: readonly string[],
    wanted: readonly string[]
): Promise<SaveSongTagsState> {
    await requireSession();
    const id = parsePcoId(pcoSongId);
    if (id === null) {
        return { ok: false, message: NOT_AN_ID_MESSAGE };
    }
    const shownRead = readTagIdsInput(shown);
    const wantedRead = readTagIdsInput(wanted);
    if (shownRead === null || wantedRead === null) {
        return { ok: false, message: UNREADABLE_MESSAGE };
    }
    const shownIds = parseTagIds(shownRead);
    const wantedIds = parseTagIds(wantedRead);
    if (shownIds === null || wantedIds === null) {
        return { ok: false, message: NOT_AN_ID_MESSAGE };
    }
    let result: SaveSongTagsResult;
    try {
        result = await saveSongTags(id, shownIds, wantedIds);
    } catch (error) {
        return failed(`save the tags of Planning Center song ${id}`, error, TAGS_FAILURE_MESSAGE);
    }
    if (!result.ok) {
        return result.reason === "changed"
            ? { ok: false, message: result.message, changedSinceShown: true }
            : refused(result);
    }
    revalidatePath(routes.catalog(), "layout");
    return {
        ok: true,
        changed: result.changed,
        tagIds: [...result.tagIds],
        kept: result.kept.map(({ id: tagId, name }) => ({ id: tagId, name })),
    };
}
