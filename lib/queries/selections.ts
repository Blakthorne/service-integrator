import "server-only";
import { getDb } from "@/lib/db";
import {
    isScheduleOption,
    listScheduleSelections,
    upsertScheduleSelection,
} from "@/lib/db/selections";
import type { ScheduleSelection } from "@/lib/domain";
import { parsePcoId } from "@/lib/pco";

/**
 * The Schedule tab's saved choices: one per song item of a plan, so a
 * choice survives leaving the plan. The plan's pages read them with the
 * plan (`getPlanDetail`); the tab saves each change as it is made.
 */

/** The longest custom text saved. */
export const CUSTOM_TEXT_MAX_LENGTH = 500;

/** What `saveScheduleSelection` did: saved, or why not, fit to show. */
export type SaveScheduleSelectionResult = { ok: true } | { ok: false; message: string };

/** Shown when an argument is not what the page sends: a stale or tampered page. */
export const SELECTION_NOT_SAVED_MESSAGE =
    "This page asked to save a choice that cannot be saved. Reload it and try again.";

/**
 * Save the choice made for item `itemId` of plan `planId`, at `now`,
 * replacing the one saved before: Numbers, Leave blank, or Custom with its
 * text (kept as typed; the other options drop it). Every argument is
 * checked, since a server action passes on what a browser sent: ids that
 * are not Planning Center ids, an option that is not one of the three, or
 * custom text that is not text or is longer than `CUSTOM_TEXT_MAX_LENGTH`
 * come back as a refusal, and nothing is saved. Whether the item is in the
 * plan is not checked (that needs Planning Center): a choice for an item
 * no longer there is never shown. Throws when the database cannot be
 * written.
 */
export function saveScheduleSelection(
    planId: string,
    itemId: string,
    option: unknown,
    customText?: unknown,
    now: Date = new Date()
): SaveScheduleSelectionResult {
    const plan = parsePcoId(planId);
    const item = parsePcoId(itemId);
    if (plan === null || item === null || !isScheduleOption(option)) {
        return { ok: false, message: SELECTION_NOT_SAVED_MESSAGE };
    }
    let text: string | null = null;
    if (option === "custom") {
        if (customText !== undefined && customText !== null && typeof customText !== "string") {
            return { ok: false, message: SELECTION_NOT_SAVED_MESSAGE };
        }
        text = customText ?? "";
        if (text.length > CUSTOM_TEXT_MAX_LENGTH) {
            return {
                ok: false,
                message: `Custom text is at most ${CUSTOM_TEXT_MAX_LENGTH} characters.`,
            };
        }
    }
    upsertScheduleSelection(getDb(), { planId: plan, itemId: item, option, customText: text }, now);
    return { ok: true };
}

/**
 * The choices saved for plan `planId`, by item id: Custom with its text
 * ("" when none was typed), or Numbers or Leave blank. A choice whose
 * option this build does not know is left out, and stays stored. Nothing
 * for an id that is not a Planning Center id. Throws when the database
 * cannot be read. One query.
 */
export function getScheduleSelections(planId: string): Record<string, ScheduleSelection> {
    if (parsePcoId(planId) === null) {
        return {};
    }
    return Object.fromEntries(
        listScheduleSelections(getDb(), planId).map(({ itemId, option, customText }) => [
            itemId,
            option === "custom" ? { option, customText: customText ?? "" } : { option },
        ])
    );
}
