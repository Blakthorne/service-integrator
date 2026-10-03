import type { PlanItem, ScheduleSelection } from "./domain";

/** What a song's radio buttons can pick besides a hymn version. */
export type ScheduleOption = NonNullable<ScheduleSelection["selectedOption"]>;

/**
 * The Schedule tab's choices, keyed by plan item ID. An item without an entry
 * shows its defaults (see `defaultSelection`).
 */
export type ScheduleSelections = Readonly<Record<string, ScheduleSelection>>;

/** A change made on the Schedule tab. */
export type ScheduleSelectionsAction =
    | {
          type: "chooseOption";
          itemId: string;
          /** "Leave blank" or "Custom"; undefined when a hymn version is picked. */
          option: ScheduleOption | undefined;
          /** The picked hymn version; undefined for "Leave blank" and "Custom". */
          versionIndex: number | undefined;
      }
    | {
          type: "setCustomText";
          itemId: string;
          text: string;
      };

/**
 * Pick an option for a song: a hymn version (`option` undefined and
 * `versionIndex` set), "Leave blank" or "Custom" (no `versionIndex`).
 */
export type ChooseOption = (
    itemId: string,
    option: ScheduleOption | undefined,
    versionIndex?: number
) => void;

/** Save the custom text typed for a song. */
export type SetCustomText = (itemId: string, text: string) => void;

/**
 * Apply a Schedule-tab change. Pure: it returns a new state and leaves the
 * old one alone, so a debounced update applied later never undoes a newer one.
 *
 * Mirrors what ServiceSchedule did to its items before the selections moved
 * here, field for field:
 * - `chooseOption` sets `selectedOption`, keeps the custom text for "Custom"
 *   (or starts it at "") and clears it otherwise, and sets
 *   `selectedVersionIndex` to the index passed. For "Leave blank" and "Custom"
 *   that is `undefined`, stored as a key with an undefined value, so it
 *   overrides the default version 0 when merged (`mergeScheduleSelections`).
 * - `setCustomText` sets only `customText`.
 */
export function scheduleSelectionsReducer(
    state: ScheduleSelections,
    action: ScheduleSelectionsAction
): ScheduleSelections {
    const current: ScheduleSelection | undefined = state[action.itemId];
    switch (action.type) {
        case "chooseOption":
            return {
                ...state,
                [action.itemId]: {
                    selectedOption: action.option,
                    customText:
                        action.option === "Custom"
                            ? current?.customText || ""
                            : undefined,
                    selectedVersionIndex: action.versionIndex,
                },
            };
        case "setCustomText":
            return {
                ...state,
                [action.itemId]: { ...current, customText: action.text },
            };
    }
}

/**
 * What an item shows before anything is chosen: a song starts on its first
 * hymn version, and other items have no selections.
 */
export function defaultSelection(
    item: Pick<PlanItem, "itemType">
): ScheduleSelection {
    return item.itemType === "song" ? { selectedVersionIndex: 0 } : {};
}

/**
 * The items as the Schedule tab sees them: each item with its default
 * selections, overridden by any it has in `selections`. Returns new objects in
 * the same order and modifies nothing.
 */
export function mergeScheduleSelections<
    T extends Pick<PlanItem, "id" | "itemType">,
>(items: readonly T[], selections: ScheduleSelections): (T & ScheduleSelection)[] {
    return items.map((item) => ({
        ...item,
        ...defaultSelection(item),
        ...selections[item.id],
    }));
}
