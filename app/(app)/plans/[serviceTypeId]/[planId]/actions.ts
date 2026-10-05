"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { parseCatalogId } from "@/lib/catalog/ids";
import type { ScheduleSelection } from "@/lib/domain";
import type { HymnNoteStatus, PreviewedHymnNote } from "@/lib/hymnNotes";
import { parsePcoId } from "@/lib/pco";
import { parsePreviewedHymnNotes } from "@/lib/previewedHymnNotes";
import {
    previewHymnNotes,
    syncHymnNotes,
    type HymnNotesSyncResult,
} from "@/lib/queries/hymnNotes";
import { linkCatalogSong, type LinkResult } from "@/lib/queries/reconcile";
import {
    SELECTION_NOT_SAVED_MESSAGE,
    saveScheduleSelection as saveSelection,
    type SaveScheduleSelectionResult,
} from "@/lib/queries/selections";
import { routes } from "@/lib/routes";

/**
 * What a link made from a plan's Schedule tab tells the song's card: done,
 * or the message to show beside its suggestions (a refusal, or a failure).
 */
export type LinkPcoSongState = { ok: true } | { ok: false; message: string };

/** Shown for a failure the action cannot explain; the log has the details. */
const FAILURE_MESSAGE =
    "Something went wrong, so nothing was linked. Try again; the server log has the details.";

/** Shown when an argument is not an id of its kind: a stale or tampered page. */
const NOT_AN_ID_MESSAGE =
    "This page asked for a link that cannot be made. Reload it and try again.";

/**
 * The Schedule tab's one-click Link: link Planning Center song `pcoSongId`,
 * which plan `planId` of service type `serviceTypeId` schedules, to catalog
 * song `songId`, by hand (`linked_by = 'manual'`; see `linkCatalogSong`).
 * Then the plan's pages are revalidated, so the action's response brings
 * the song's numbers to the tab without leaving it, and so are the
 * catalog's, which show the link too (convention 15).
 *
 * A server action is a public POST endpoint. It checks the session first and
 * throws without one (convention 15), and since its arguments may be
 * anything, each passes through the parser for its kind (convention 19)
 * before it reaches a query or a route builder. A refusal (either song does
 * not exist, or one is already linked elsewhere) comes back with its
 * message, and so does a failure, which is logged; neither changes a page.
 */
export async function linkPcoSong(
    serviceTypeId: string,
    planId: string,
    pcoSongId: string,
    songId: string
): Promise<LinkPcoSongState> {
    const session = await auth();
    if (!session) {
        throw new Error("Not signed in");
    }
    const st = parsePcoId(serviceTypeId);
    const plan = parsePcoId(planId);
    const pcoSong = parsePcoId(pcoSongId);
    const song = parseCatalogId(songId);
    if (st === null || plan === null || pcoSong === null || song === null) {
        return { ok: false, message: NOT_AN_ID_MESSAGE };
    }
    let result: LinkResult;
    try {
        result = await linkCatalogSong(song, pcoSong);
    } catch (error) {
        console.error(
            `Failed to link Planning Center song ${pcoSong} to catalog song ${song}:`,
            error
        );
        return { ok: false, message: FAILURE_MESSAGE };
    }
    if (!result.ok) {
        return { ok: false, message: result.message };
    }
    // Also when the two were already linked: the tab that asked is out of date.
    revalidatePath(routes.plan(st, plan), "layout");
    revalidatePath(routes.catalog(), "layout");
    return { ok: true };
}

/** What saving a Schedule-tab choice tells the tab: saved, or why not, fit to show. */
export type SaveScheduleSelectionState = SaveScheduleSelectionResult;

/** Shown when the choice could not be written; the log has the details. */
const SELECTION_FAILURE_MESSAGE = "The database could not be written.";

/**
 * Save the Schedule tab's choice for item `itemId` of plan `planId` (of
 * service type `serviceTypeId`): Numbers, Leave blank, or Custom with its
 * text, replacing the one saved before, so it is there when the plan is
 * opened again (`getPlanDetail` reads it back).
 *
 * It checks the session first and throws without one, then passes every id
 * through `parsePcoId` (convention 19); `saveScheduleSelection` checks them
 * again, with the option and the text. A refusal comes back with its
 * message, and so does a failure to write, which is logged.
 *
 * It revalidates nothing. The tab already shows the choice, and the plan's
 * provider owns its choices once it has them, so a fresh plan would change
 * nothing on screen; and revalidating would render the plan again, which
 * reads Planning Center, on every click.
 */
export async function saveScheduleSelection(
    serviceTypeId: string,
    planId: string,
    itemId: string,
    option: ScheduleSelection["option"],
    customText?: string
): Promise<SaveScheduleSelectionState> {
    const session = await auth();
    if (!session) {
        throw new Error("Not signed in");
    }
    const st = parsePcoId(serviceTypeId);
    const plan = parsePcoId(planId);
    const item = parsePcoId(itemId);
    if (st === null || plan === null || item === null) {
        return { ok: false, message: SELECTION_NOT_SAVED_MESSAGE };
    }
    try {
        return saveSelection(plan, item, option, customText);
    } catch (error) {
        console.error(
            `Failed to save the Schedule tab's choice for plan ${st}/${plan} item ${item}:`,
            error
        );
        return { ok: false, message: SELECTION_FAILURE_MESSAGE };
    }
}

/**
 * What the hymnal notes' preview tells the dialog: each song item's diff
 * against the category, or why the notes cannot be compared (see
 * `HymnNoteStatus`); or, when Planning Center or the database could not be
 * read, why there is nothing to show.
 */
export type PreviewHymnNotesState =
    | { ok: true; status: HymnNoteStatus }
    | { ok: false; message: string };

/**
 * What a sync of the hymnal notes tells the dialog: what became of each
 * song item's note, or why nothing was written (see `HymnNotesSyncResult`);
 * or, when Planning Center or the database could not be read before any
 * write, why it stopped there ("failed").
 */
export type SyncHymnNotesState =
    | HymnNotesSyncResult
    | { ok: false; kind: "failed"; message: string };

/** Shown when the dialog sends ids that are not ids: a stale or tampered page. */
const NOT_A_PLAN_MESSAGE =
    "This page asked about a plan that cannot be found. Reload it and try again.";

/** Shown when the preview could not read what it needs; the log has the details. */
const PREVIEW_FAILURE_MESSAGE =
    "Planning Center or the database could not be read, so the notes could not be compared. Try again; the server log has the details.";

/** Shown when the preview sent back is not one: a stale or tampered page. */
const PREVIEW_NOT_USABLE_MESSAGE =
    "This page sent a preview the sync could not check, so nothing was written. Preview again.";

/** Shown when the sync stopped before writing anything; the log has the details. */
const SYNC_FAILURE_MESSAGE =
    "Planning Center or the database could not be read, so no note was written. Try again; the server log has the details.";

/**
 * What a sync of plan `planId`'s hymnal notes would do: each song item's
 * note against its service type's category (`previewHymnNotes`, which reads
 * the plan's items, the categories and the catalog afresh), or why it
 * cannot sync: the category is missing, or the categories or the catalog
 * could not be read. It writes nothing.
 *
 * It reads Planning Center, so the dialog calls it from a click, with its
 * pending state in `useState` (convention 15). It checks the session first
 * and throws without one, then parses both ids; a failure to read is
 * logged and comes back as a message.
 */
export async function previewHymnNotesAction(
    serviceTypeId: string,
    planId: string
): Promise<PreviewHymnNotesState> {
    const session = await auth();
    if (!session) {
        throw new Error("Not signed in");
    }
    const st = parsePcoId(serviceTypeId);
    const plan = parsePcoId(planId);
    if (st === null || plan === null) {
        return { ok: false, message: NOT_A_PLAN_MESSAGE };
    }
    try {
        return { ok: true, status: await previewHymnNotes(st, plan) };
    } catch (error) {
        console.error(`Failed to preview the hymnal notes of plan ${st}/${plan}:`, error);
        return { ok: false, message: PREVIEW_FAILURE_MESSAGE };
    }
}

/**
 * Bring plan `planId`'s hymnal notes in step with its songs' catalog links
 * (`syncHymnNotes`: it reads the plan again first, writes each change to
 * Planning Center and logs it), and say what became of each song item's
 * note. A missing category, or categories that could not be read, refuse
 * the sync with their message, and nothing is written; so does a sync of
 * the plan that is already running ("busy").
 *
 * `previewed` is the plan the dialog's preview showed (its `status.items`).
 * The sync writes an item only when what it needs now is what the preview
 * showed, and reports any other "changed", so Confirm writes what the
 * person saw. It comes from a browser, so it is parsed first
 * (`parsePreviewedHymnNotes`: every id, every action and kind, and the
 * lists' lengths); one that does not parse is refused before Planning
 * Center is read.
 *
 * Once a sync has run, the plan's pages are revalidated, so the song cards'
 * note statuses show what Planning Center has now. It waits on Planning
 * Center, so the dialog calls it from a click, with its pending state in
 * `useState` (convention 15). It checks the session first and throws
 * without one, then parses both ids; a failure before any write is logged
 * and comes back as a message ("failed").
 */
export async function syncHymnNotesAction(
    serviceTypeId: string,
    planId: string,
    previewed: readonly PreviewedHymnNote[]
): Promise<SyncHymnNotesState> {
    const session = await auth();
    if (!session) {
        throw new Error("Not signed in");
    }
    const st = parsePcoId(serviceTypeId);
    const plan = parsePcoId(planId);
    if (st === null || plan === null) {
        return { ok: false, kind: "failed", message: NOT_A_PLAN_MESSAGE };
    }
    const preview = parsePreviewedHymnNotes(previewed);
    if (preview === null) {
        return { ok: false, kind: "failed", message: PREVIEW_NOT_USABLE_MESSAGE };
    }
    let result: HymnNotesSyncResult;
    try {
        result = await syncHymnNotes(st, plan, preview);
    } catch (error) {
        console.error(`Failed to sync the hymnal notes of plan ${st}/${plan}:`, error);
        return { ok: false, kind: "failed", message: SYNC_FAILURE_MESSAGE };
    }
    if (result.ok) {
        revalidatePath(routes.plan(st, plan), "layout");
    }
    return result;
}
