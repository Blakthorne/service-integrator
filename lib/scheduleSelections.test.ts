import { describe, expect, test } from "vitest";
import type { PlanItem, ScheduleSelection } from "./domain";
import {
    defaultSelection,
    mergeScheduleSelections,
    scheduleSelectionsReducer,
    type ScheduleOption,
    type ScheduleSelections,
    type ScheduleSelectionsAction,
} from "./scheduleSelections";
import { buildScheduleCopyText, type ScheduleHymn } from "./serviceSchedule";

function planItem(
    id: string,
    title: string,
    itemType: string,
    sequence: number
): PlanItem {
    return {
        id,
        title,
        itemType,
        sequence,
        servicePosition: "during",
        keyName: null,
        length: 0,
        description: null,
        createdAt: "2025-06-01T00:00:00Z",
        updatedAt: "2025-06-01T00:00:00Z",
        songId: null,
    };
}

function choose(
    itemId: string,
    option: ScheduleOption | undefined,
    versionIndex?: number
): ScheduleSelectionsAction {
    return { type: "chooseOption", itemId, option, versionIndex };
}

function text(itemId: string, value: string): ScheduleSelectionsAction {
    return { type: "setCustomText", itemId, text: value };
}

function reduceAll(
    actions: ScheduleSelectionsAction[],
    state: ScheduleSelections = {}
): ScheduleSelections {
    return actions.reduce(scheduleSelectionsReducer, state);
}

describe("scheduleSelectionsReducer: chooseOption", () => {
    test("picking a hymn version stores the index and clears the option and custom text", () => {
        const state = reduceAll([text("1", "x"), choose("1", undefined, 2)]);
        expect(state["1"]).toStrictEqual({
            selectedOption: undefined,
            customText: undefined,
            selectedVersionIndex: 2,
        });
    });

    test("'Custom' starts the custom text at '' and keeps text already typed", () => {
        expect(reduceAll([choose("1", "Custom")])["1"]).toStrictEqual({
            selectedOption: "Custom",
            customText: "",
            selectedVersionIndex: undefined,
        });
        expect(
            reduceAll([text("1", "x"), choose("1", "Custom")])["1"]
        ).toStrictEqual({
            selectedOption: "Custom",
            customText: "x",
            selectedVersionIndex: undefined,
        });
    });

    test("'Leave blank' clears the custom text", () => {
        expect(
            reduceAll([text("1", "x"), choose("1", "Leave blank")])["1"]
        ).toStrictEqual({
            selectedOption: "Leave blank",
            customText: undefined,
            selectedVersionIndex: undefined,
        });
    });

    test("'Leave blank' and 'Custom' store selectedVersionIndex as an explicit undefined", () => {
        for (const option of ["Leave blank", "Custom"] as const) {
            const state = reduceAll([choose("1", undefined, 1), choose("1", option)]);
            expect(Object.keys(state["1"])).toContain("selectedVersionIndex");
            expect(state["1"].selectedVersionIndex).toBeUndefined();
        }
    });

    test("an empty custom text is not kept: 'Custom' turns it back into ''", () => {
        expect(
            reduceAll([text("1", ""), choose("1", "Custom")])["1"].customText
        ).toBe("");
    });
});

describe("scheduleSelectionsReducer: setCustomText", () => {
    test("sets only the custom text, keeping the other choices", () => {
        const state = reduceAll([choose("1", "Custom"), text("1", "abc")]);
        expect(state["1"]).toStrictEqual({
            selectedOption: "Custom",
            customText: "abc",
            selectedVersionIndex: undefined,
        });
    });

    test("works before anything is chosen for the item", () => {
        expect(reduceAll([text("1", "abc")])["1"]).toStrictEqual({
            customText: "abc",
        });
    });

    test("stores the text as typed, whitespace included", () => {
        expect(reduceAll([text("1", "  x  ")])["1"].customText).toBe("  x  ");
    });
});

describe("scheduleSelectionsReducer: purity", () => {
    test("returns a new state and leaves the previous one untouched", () => {
        const before = reduceAll([choose("1", "Custom"), text("2", "b")]);
        const snapshot = JSON.parse(JSON.stringify(before));
        const after = scheduleSelectionsReducer(before, text("1", "a"));
        expect(after).not.toBe(before);
        expect(after["1"]).not.toBe(before["1"]);
        expect(JSON.parse(JSON.stringify(before))).toEqual(snapshot);
    });

    test("other items' selections are kept as they are", () => {
        const before = reduceAll([choose("2", undefined, 1)]);
        const after = scheduleSelectionsReducer(before, choose("1", "Custom"));
        expect(after["2"]).toBe(before["2"]);
    });
});

describe("defaultSelection", () => {
    test("a song starts on its first hymn version", () => {
        expect(defaultSelection({ itemType: "song" })).toStrictEqual({
            selectedVersionIndex: 0,
        });
    });

    test("other item types (only exactly 'song' counts) have no selections", () => {
        for (const itemType of ["header", "media", "item", "Song", ""]) {
            expect(defaultSelection({ itemType })).toStrictEqual({});
        }
    });
});

describe("mergeScheduleSelections", () => {
    const items = [
        planItem("10", "Welcome", "header", 1),
        planItem("11", "Amazing Grace", "song", 2),
        planItem("12", "Holy, Holy, Holy", "song", 3),
    ];

    test("with no selections, songs get version 0 and other items are copied as they are", () => {
        const merged = mergeScheduleSelections(items, {});
        expect(merged).toStrictEqual([
            { ...items[0] },
            { ...items[1], selectedVersionIndex: 0 },
            { ...items[2], selectedVersionIndex: 0 },
        ]);
    });

    test("an item's selections override its defaults; other items keep theirs", () => {
        const merged = mergeScheduleSelections(
            items,
            reduceAll([choose("12", undefined, 2)])
        );
        expect(merged[1].selectedVersionIndex).toBe(0);
        expect(merged[2].selectedVersionIndex).toBe(2);
    });

    test("an explicit undefined index overrides the default version 0", () => {
        const merged = mergeScheduleSelections(
            items,
            reduceAll([choose("11", "Leave blank")])
        );
        expect(Object.keys(merged[1])).toContain("selectedVersionIndex");
        expect(merged[1].selectedVersionIndex).toBeUndefined();
    });

    test("keeps every item field and the item order, and modifies nothing", () => {
        const selections = reduceAll([text("11", "x")]);
        const itemsBefore = JSON.stringify(items);
        const selectionsBefore = JSON.stringify(selections);
        const merged = mergeScheduleSelections(items, selections);
        expect(merged.map((item) => item.id)).toEqual(["10", "11", "12"]);
        expect(merged[1]).toMatchObject(items[1]);
        expect(merged[1]).not.toBe(items[1]);
        expect(JSON.stringify(items)).toBe(itemsBefore);
        expect(JSON.stringify(selections)).toBe(selectionsBefore);
    });

    test("selections for items that are not in the list are ignored", () => {
        const merged = mergeScheduleSelections(items, reduceAll([text("99", "x")]));
        expect(merged).toStrictEqual(mergeScheduleSelections(items, {}));
    });
});

// What the Schedule tab did before the selections moved into the reducer, copied
// from PlanItems.tsx and ServiceSchedule.tsx. The merged view must match it.
type LegacyItem = PlanItem & ScheduleSelection;

/** PlanItems.tsx: how the container set up the items it fetched. */
function legacyInit(items: PlanItem[]): LegacyItem[] {
    return items.map((item) => ({
        ...item,
        selectedVersionIndex: item.itemType === "song" ? 0 : undefined,
    }));
}

/** ServiceSchedule.tsx: onChooseOption. */
function legacyChooseOption(
    items: LegacyItem[],
    itemId: string,
    option: ScheduleOption | undefined,
    versionIndex?: number
): LegacyItem[] {
    return items.map((i) =>
        i.id === itemId
            ? {
                  ...i,
                  selectedOption: option,
                  customText:
                      option === "Custom" ? i.customText || "" : undefined,
                  selectedVersionIndex: versionIndex,
              }
            : i
    );
}

/** ServiceSchedule.tsx: CustomTextInput's debounced update. */
function legacySetCustomText(
    items: LegacyItem[],
    itemId: string,
    value: string
): LegacyItem[] {
    return items.map((i) => (i.id === itemId ? { ...i, customText: value } : i));
}

function legacyApply(
    items: PlanItem[],
    actions: ScheduleSelectionsAction[]
): LegacyItem[] {
    return actions.reduce(
        (current, action) =>
            action.type === "chooseOption"
                ? legacyChooseOption(
                      current,
                      action.itemId,
                      action.option,
                      action.versionIndex
                  )
                : legacySetCustomText(current, action.itemId, action.text),
        legacyInit(items)
    );
}

describe("the merged view matches what the Schedule tab did before", () => {
    const items = [
        planItem("1", "Welcome", "header", 1),
        planItem("2", "Holy, Holy, Holy", "song", 2),
        planItem("3", "Unknown Song", "song", 3),
        planItem("4", "Amazing Grace", "song", 4),
    ];

    const sequences: [string, ScheduleSelectionsAction[]][] = [
        ["nothing chosen", []],
        ["a version", [choose("2", undefined, 1)]],
        ["Custom, then text", [choose("2", "Custom"), text("2", "x")]],
        ["text, then Custom", [text("2", "x"), choose("2", "Custom")]],
        [
            "Custom with text, then a version, then Custom again",
            [
                choose("2", "Custom"),
                text("2", "x"),
                choose("2", undefined, 0),
                choose("2", "Custom"),
            ],
        ],
        [
            "Leave blank and Custom on a song with no hymn",
            [
                choose("3", "Custom"),
                text("3", "free"),
                choose("3", "Leave blank"),
                text("3", "again"),
            ],
        ],
        [
            "several items at once",
            [
                choose("4", undefined, 2),
                text("2", "a"),
                choose("3", "Custom"),
                text("3", "b"),
                choose("2", "Custom"),
                text("2", ""),
            ],
        ],
    ];

    test.each(sequences)("%s", (_name, actions) => {
        const legacy = legacyApply(items, actions);
        const merged = mergeScheduleSelections(items, reduceAll(actions));

        // Song items match exactly, down to keys that hold undefined.
        const songs = (list: LegacyItem[]) =>
            list.filter((item) => item.itemType === "song");
        expect(songs(merged)).toStrictEqual(songs(legacy));
        // Other items only differ in that the old code also gave them a
        // `selectedVersionIndex: undefined` key; nothing reads it.
        expect(merged).toEqual(legacy);
    });
});

describe("copy text through the merged view", () => {
    const BOTH = { rejoice_hymns_number: "12", great_hymns_number: "34" };
    const RJ_ONLY = { rejoice_hymns_number: "56", great_hymns_number: "-1" };
    const GR_ONLY = { rejoice_hymns_number: "-1", great_hymns_number: "78" };
    const hymnData: ScheduleHymn[] = [
        { song_title: "Multi", versions: [BOTH, RJ_ONLY, GR_ONLY] },
        { song_title: "Single", versions: [BOTH] },
    ];
    const items = [
        planItem("1", "Welcome", "header", 1),
        planItem("2", "Multi", "song", 2),
        planItem("3", "Single", "song", 3),
        planItem("4", "No Hymn", "song", 4),
    ];

    function copyText(actions: ScheduleSelectionsAction[]): string {
        return buildScheduleCopyText({
            items: mergeScheduleSelections(items, reduceAll(actions)),
            hymnData,
            serviceTypeName: "Sunday Morning",
            planDate: "2025-06-15",
        });
    }

    /** The line for one song. */
    function lineFor(title: string, actions: ScheduleSelectionsAction[]): string {
        const line = copyText(actions)
            .split("\n")
            .find((l) => l === title || l.startsWith(`${title} (`));
        if (line === undefined) {
            throw new Error(`no line for ${title}`);
        }
        return line;
    }

    test("with nothing chosen every hymn shows its first version", () => {
        expect(copyText([])).toBe(
            "Sunday AM 6/15/25\n\nMulti (R-12/G-34)\nSingle (R-12/G-34)\nNo Hymn"
        );
    });

    test("picking another version shows its numbers", () => {
        expect(lineFor("Multi", [choose("2", undefined, 1)])).toBe("Multi (R-56)");
        expect(lineFor("Multi", [choose("2", undefined, 2)])).toBe("Multi (G-78)");
        expect(
            lineFor("Multi", [choose("2", undefined, 2), choose("2", undefined, 0)])
        ).toBe("Multi (R-12/G-34)");
    });

    test("Custom with no text yet is just the title; typing adds the text", () => {
        expect(lineFor("Multi", [choose("2", "Custom")])).toBe("Multi");
        expect(lineFor("Multi", [choose("2", "Custom"), text("2", "x")])).toBe(
            "Multi (x)"
        );
    });

    test("text typed before choosing Custom shows once Custom is chosen", () => {
        expect(lineFor("Single", [text("3", "x")])).toBe("Single (R-12/G-34)");
        expect(lineFor("Single", [text("3", "x"), choose("3", "Custom")])).toBe(
            "Single (x)"
        );
    });

    test("going back to a version drops the custom text for good", () => {
        const backToVersion = [
            choose("2", "Custom"),
            text("2", "x"),
            choose("2", undefined, 1),
        ];
        expect(lineFor("Multi", backToVersion)).toBe("Multi (R-56)");
        expect(lineFor("Multi", [...backToVersion, choose("2", "Custom")])).toBe(
            "Multi"
        );
    });

    test("a song with no hymn: Custom adds its text, Leave blank drops it", () => {
        const custom = [choose("4", "Custom"), text("4", "free")];
        expect(lineFor("No Hymn", custom)).toBe("No Hymn (free)");
        expect(lineFor("No Hymn", [...custom, choose("4", "Leave blank")])).toBe(
            "No Hymn"
        );
        expect(
            lineFor("No Hymn", [...custom, choose("4", "Leave blank"), choose("4", "Custom")])
        ).toBe("No Hymn");
    });

    test("each song keeps its own choices", () => {
        expect(
            copyText([
                choose("2", undefined, 2),
                choose("3", "Custom"),
                text("3", "mine"),
                choose("4", "Custom"),
                text("4", "free"),
            ])
        ).toBe(
            "Sunday AM 6/15/25\n\nMulti (G-78)\nSingle (mine)\nNo Hymn (free)"
        );
    });
});
