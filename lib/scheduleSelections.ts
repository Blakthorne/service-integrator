import type { PlanItem, ScheduleSelection } from "./domain";
import { catalogMatchFor, type ScheduleCatalog } from "./serviceSchedule";

/** What a song's radio buttons pick: its numbers, leave it blank, or custom text. */
export type ScheduleOption = ScheduleSelection["option"];

/**
 * The Schedule tab's choices, keyed by plan item ID: an option, custom text
 * typed before any option was chosen, or both. An item without an option
 * shows its default (see `defaultOption`). The choices saved for a plan
 * (`PlanDetail.selections`) are one of these, so they seed it as they are.
 */
export type ScheduleSelections = Readonly<
    Record<string, Partial<ScheduleSelection>>
>;

/** A change made on the Schedule tab. */
export type ScheduleSelectionsAction =
    | {
          type: "chooseOption";
          itemId: string;
          option: ScheduleOption;
      }
    | {
          type: "setCustomText";
          itemId: string;
          text: string;
      };

/**
 * The longest custom text the custom box takes: what the database saves
 * (`CUSTOM_TEXT_MAX_LENGTH` in lib/queries/selections.ts, which a test keeps
 * the same), so a choice is never refused for its length.
 */
export const CUSTOM_TEXT_INPUT_MAX_LENGTH = 500;

/** Pick a song's option: its numbers, "blank" or "custom". */
export type ChooseOption = (itemId: string, option: ScheduleOption) => void;

/** Save the custom text typed for a song. */
export type SetCustomText = (itemId: string, text: string) => void;

/**
 * Apply a Schedule-tab change. Pure: it returns a new state and leaves the
 * old one alone, so a debounced update applied later never undoes a newer one.
 *
 * - `chooseOption` sets the option. "custom" keeps the custom text already
 *   typed (or starts it at ""); "numbers" and "blank" drop it, so choosing
 *   Custom again starts empty.
 * - `setCustomText` sets only the custom text.
 */
export function scheduleSelectionsReducer(
    state: ScheduleSelections,
    action: ScheduleSelectionsAction
): ScheduleSelections {
    const current: Partial<ScheduleSelection> | undefined = state[action.itemId];
    switch (action.type) {
        case "chooseOption":
            return {
                ...state,
                [action.itemId]:
                    action.option === "custom"
                        ? { option: "custom", customText: current?.customText || "" }
                        : { option: action.option },
            };
        case "setCustomText":
            return {
                ...state,
                [action.itemId]: { ...current, customText: action.text },
            };
    }
}

/**
 * What the database keeps of an item's selection (`schedule_selections`):
 * its option, with the custom text when the option is Custom. Null when no
 * option has been chosen: text typed in the custom box while the default
 * shows prints nothing, so it is not saved until Custom is chosen, which
 * saves it then. Text typed while another option is chosen is left out for
 * the same reason.
 */
export function savedSelection(
    selection: Partial<ScheduleSelection> | undefined
): ScheduleSelection | null {
    if (selection?.option === undefined) {
        return null;
    }
    return selection.option === "custom"
        ? { option: "custom", customText: selection.customText ?? "" }
        : { option: selection.option };
}

/** Whether two saved selections (see `savedSelection`) are the same: one option, and the same custom text. */
export function sameSavedSelection(
    a: ScheduleSelection | null,
    b: ScheduleSelection | null
): boolean {
    if (a === null || b === null) {
        return a === b;
    }
    return a.option === b.option && (a.customText ?? "") === (b.customText ?? "");
}

/**
 * Whether an item can print numbers: it is a song whose Planning Center song
 * is linked to a catalog song in at least one book.
 */
export function hasNumbers(
    item: Pick<PlanItem, "itemType" | "songId">,
    catalog: ScheduleCatalog
): boolean {
    if (item.itemType !== "song") {
        return false;
    }
    return (catalogMatchFor(catalog, item.songId)?.entries.length ?? 0) > 0;
}

/**
 * The option an item starts on: "numbers" when it can print numbers (see
 * `hasNumbers`), otherwise "blank".
 */
export function defaultOption(
    item: Pick<PlanItem, "itemType" | "songId">,
    catalog: ScheduleCatalog
): ScheduleOption {
    return hasNumbers(item, catalog) ? "numbers" : "blank";
}

/**
 * The items as the Schedule tab sees them: each item with its option and any
 * custom text. The option is the one chosen, or the default
 * (`defaultOption`), so a song linked while the tab is open turns to its
 * numbers unless something else was chosen for it. "numbers" needs numbers:
 * an item that has none (its song was unlinked since) shows "blank". Returns
 * new objects in the same order and modifies nothing.
 */
export function mergeScheduleSelections<
    T extends Pick<PlanItem, "id" | "itemType" | "songId">,
>(
    items: readonly T[],
    selections: ScheduleSelections,
    catalog: ScheduleCatalog
): (T & ScheduleSelection)[] {
    return items.map((item) => {
        const chosen: Partial<ScheduleSelection> | undefined = selections[item.id];
        const numbers = hasNumbers(item, catalog);
        const option = chosen?.option ?? (numbers ? "numbers" : "blank");
        return {
            ...item,
            ...chosen,
            option: option === "numbers" && !numbers ? "blank" : option,
        };
    });
}
