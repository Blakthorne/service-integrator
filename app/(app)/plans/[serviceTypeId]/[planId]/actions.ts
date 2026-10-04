"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { parseCatalogId } from "@/lib/catalog/ids";
import type { ScheduleSelection } from "@/lib/domain";
import { parsePcoId } from "@/lib/pco";
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
