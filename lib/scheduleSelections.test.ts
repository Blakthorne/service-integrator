import { describe, expect, test } from "vitest";
import type { PlanItem } from "./domain";
import {
    defaultOption,
    hasNumbers,
    mergeScheduleSelections,
    scheduleSelectionsReducer,
    type ScheduleOption,
    type ScheduleSelections,
    type ScheduleSelectionsAction,
} from "./scheduleSelections";
import { buildScheduleCopyText, type ScheduleCatalog } from "./serviceSchedule";

function planItem(
    id: string,
    title: string,
    itemType: string,
    sequence: number,
    songId: string | null = null
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
        songId,
    };
}

function choose(itemId: string, option: ScheduleOption): ScheduleSelectionsAction {
    return { type: "chooseOption", itemId, option };
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

const BOTH = [
    { label: "R-12", variantNote: null },
    { label: "G-34", variantNote: null },
];

/**
 * Planning Center song 20 is linked to a catalog song at R-12 and G-34, and
 * song 50 to one in no book; songs 30 and 40 are not linked.
 */
const CATALOG: ScheduleCatalog = {
    "20": { entries: BOTH },
    "50": { entries: [] },
};

describe("scheduleSelectionsReducer: chooseOption", () => {
    test("Numbers stores the option and drops the custom text", () => {
        const state = reduceAll([text("1", "x"), choose("1", "numbers")]);
        expect(state["1"]).toStrictEqual({ option: "numbers" });
    });

    test("Custom starts the custom text at '' and keeps text already typed", () => {
        expect(reduceAll([choose("1", "custom")])["1"]).toStrictEqual({
            option: "custom",
            customText: "",
        });
        expect(reduceAll([text("1", "x"), choose("1", "custom")])["1"]).toStrictEqual({
            option: "custom",
            customText: "x",
        });
    });

    test("Leave blank drops the custom text", () => {
        expect(reduceAll([text("1", "x"), choose("1", "blank")])["1"]).toStrictEqual({
            option: "blank",
        });
    });

    test("a later choice replaces an earlier one", () => {
        expect(
            reduceAll([choose("1", "custom"), choose("1", "numbers")])["1"]
        ).toStrictEqual({ option: "numbers" });
        expect(
            reduceAll([choose("1", "numbers"), choose("1", "blank")])["1"]
        ).toStrictEqual({ option: "blank" });
    });

    test("an empty custom text is not kept: Custom turns it back into ''", () => {
        expect(reduceAll([text("1", ""), choose("1", "custom")])["1"].customText).toBe("");
    });
});

describe("scheduleSelectionsReducer: setCustomText", () => {
    test("sets only the custom text, keeping the option", () => {
        const state = reduceAll([choose("1", "custom"), text("1", "abc")]);
        expect(state["1"]).toStrictEqual({ option: "custom", customText: "abc" });
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
        const before = reduceAll([choose("1", "custom"), text("2", "b")]);
        const snapshot = JSON.parse(JSON.stringify(before));
        const after = scheduleSelectionsReducer(before, text("1", "a"));
        expect(after).not.toBe(before);
        expect(after["1"]).not.toBe(before["1"]);
        expect(JSON.parse(JSON.stringify(before))).toEqual(snapshot);
    });

    test("other items' selections are kept as they are", () => {
        const before = reduceAll([choose("2", "numbers")]);
        const after = scheduleSelectionsReducer(before, choose("1", "custom"));
        expect(after["2"]).toBe(before["2"]);
    });
});

describe("hasNumbers and defaultOption", () => {
    test("a song linked to a catalog song in a book has numbers, and starts on them", () => {
        const item = { itemType: "song", songId: "20" };
        expect(hasNumbers(item, CATALOG)).toBe(true);
        expect(defaultOption(item, CATALOG)).toBe("numbers");
    });

    test.each([
        ["not linked", "30"],
        ["linked to a song in no book", "50"],
        ["without a Planning Center song", null],
    ])("a song %s has none, and starts blank", (_name, songId) => {
        const item = { itemType: "song", songId };
        expect(hasNumbers(item, CATALOG)).toBe(false);
        expect(defaultOption(item, CATALOG)).toBe("blank");
    });

    test("other item types (only exactly 'song' counts) have none, and start blank", () => {
        for (const itemType of ["header", "media", "item", "Song", ""]) {
            const item = { itemType, songId: "20" };
            expect(hasNumbers(item, CATALOG)).toBe(false);
            expect(defaultOption(item, CATALOG)).toBe("blank");
        }
    });
});

describe("mergeScheduleSelections", () => {
    const items = [
        planItem("10", "Welcome", "header", 1),
        planItem("11", "Amazing Grace", "song", 2, "20"),
        planItem("12", "Holy, Holy, Holy", "song", 3, "30"),
    ];

    test("with no selections, a song with numbers starts on them and every other item on Leave blank", () => {
        const merged = mergeScheduleSelections(items, {}, CATALOG);
        expect(merged).toStrictEqual([
            { ...items[0], option: "blank" },
            { ...items[1], option: "numbers" },
            { ...items[2], option: "blank" },
        ]);
    });

    test("an item's choice overrides its default; other items keep theirs", () => {
        const merged = mergeScheduleSelections(
            items,
            reduceAll([choose("11", "blank"), choose("12", "custom"), text("12", "x")]),
            CATALOG
        );
        expect(merged.map(({ option }) => option)).toEqual(["blank", "blank", "custom"]);
        expect(merged[2].customText).toBe("x");
    });

    test("custom text typed before anything is chosen comes with the default option", () => {
        const merged = mergeScheduleSelections(items, reduceAll([text("11", "x")]), CATALOG);
        expect(merged[1]).toStrictEqual({ ...items[1], option: "numbers", customText: "x" });
    });

    test("a song linked while the tab is open turns to its numbers, unless something was chosen", () => {
        const linkedNow: ScheduleCatalog = { ...CATALOG, "30": { entries: BOTH } };
        expect(mergeScheduleSelections(items, {}, linkedNow)[2].option).toBe("numbers");
        expect(
            mergeScheduleSelections(items, reduceAll([choose("12", "blank")]), linkedNow)[2]
                .option
        ).toBe("blank");
    });

    test("Numbers needs numbers: a song chosen as Numbers that has none shows Leave blank", () => {
        const selections = reduceAll([choose("11", "numbers"), choose("12", "numbers")]);
        const unlinked: ScheduleCatalog = {};
        expect(
            mergeScheduleSelections(items, selections, unlinked).map(({ option }) => option)
        ).toEqual(["blank", "blank", "blank"]);
        // The choice is kept, so the numbers come back with the link.
        expect(mergeScheduleSelections(items, selections, CATALOG)[1].option).toBe(
            "numbers"
        );
    });

    test("keeps every item field and the item order, and modifies nothing", () => {
        const selections = reduceAll([text("11", "x")]);
        const itemsBefore = JSON.stringify(items);
        const selectionsBefore = JSON.stringify(selections);
        const merged = mergeScheduleSelections(items, selections, CATALOG);
        expect(merged.map((item) => item.id)).toEqual(["10", "11", "12"]);
        expect(merged[1]).toMatchObject(items[1]);
        expect(merged[1]).not.toBe(items[1]);
        expect(JSON.stringify(items)).toBe(itemsBefore);
        expect(JSON.stringify(selections)).toBe(selectionsBefore);
    });

    test("selections for items that are not in the list are ignored", () => {
        const merged = mergeScheduleSelections(items, reduceAll([text("99", "x")]), CATALOG);
        expect(merged).toStrictEqual(mergeScheduleSelections(items, {}, CATALOG));
    });
});

describe("copy text through the merged view", () => {
    // Multi and Single schedule Planning Center songs 20 and 21, both linked
    // to catalog songs at R-12 and G-34; No Hymn's song 40 is not linked.
    const catalog: ScheduleCatalog = {
        "20": { entries: BOTH },
        "21": { entries: BOTH },
    };
    const items = [
        planItem("1", "Welcome", "header", 1),
        planItem("2", "Multi", "song", 2, "20"),
        planItem("3", "Single", "song", 3, "21"),
        planItem("4", "No Hymn", "song", 4, "40"),
    ];

    function copyText(actions: ScheduleSelectionsAction[]): string {
        return buildScheduleCopyText({
            items: mergeScheduleSelections(items, reduceAll(actions), catalog),
            catalog,
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

    test("with nothing chosen every linked song shows its numbers", () => {
        expect(copyText([])).toBe(
            "Sunday AM 6/15/25\n\nMulti (R-12 / G-34)\nSingle (R-12 / G-34)\nNo Hymn"
        );
    });

    test("Leave blank drops a linked song's numbers, and Numbers brings them back", () => {
        expect(lineFor("Multi", [choose("2", "blank")])).toBe("Multi");
        expect(lineFor("Multi", [choose("2", "blank"), choose("2", "numbers")])).toBe(
            "Multi (R-12 / G-34)"
        );
    });

    test("Custom with no text yet is just the title; typing adds the text", () => {
        expect(lineFor("Multi", [choose("2", "custom")])).toBe("Multi");
        expect(lineFor("Multi", [choose("2", "custom"), text("2", "x")])).toBe(
            "Multi (x)"
        );
    });

    test("text typed before choosing Custom shows once Custom is chosen", () => {
        expect(lineFor("Single", [text("3", "x")])).toBe("Single (R-12 / G-34)");
        expect(lineFor("Single", [text("3", "x"), choose("3", "custom")])).toBe(
            "Single (x)"
        );
    });

    test("going back to the numbers drops the custom text for good", () => {
        const backToNumbers = [choose("2", "custom"), text("2", "x"), choose("2", "numbers")];
        expect(lineFor("Multi", backToNumbers)).toBe("Multi (R-12 / G-34)");
        expect(lineFor("Multi", [...backToNumbers, choose("2", "custom")])).toBe("Multi");
    });

    test("a song that is not linked: Custom adds its text, Leave blank drops it", () => {
        const custom = [choose("4", "custom"), text("4", "free")];
        expect(lineFor("No Hymn", custom)).toBe("No Hymn (free)");
        expect(lineFor("No Hymn", [...custom, choose("4", "blank")])).toBe("No Hymn");
        expect(
            lineFor("No Hymn", [...custom, choose("4", "blank"), choose("4", "custom")])
        ).toBe("No Hymn");
    });

    test("each song keeps its own choices", () => {
        expect(
            copyText([
                choose("2", "blank"),
                choose("3", "custom"),
                text("3", "mine"),
                choose("4", "custom"),
                text("4", "free"),
            ])
        ).toBe("Sunday AM 6/15/25\n\nMulti\nSingle (mine)\nNo Hymn (free)");
    });
});
