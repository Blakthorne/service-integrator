import { describe, expect, test } from "vitest";
import type { HymnNoteDiff } from "./hymnNotes";
import {
    MAX_PREVIEWED_CHANGES,
    MAX_PREVIEWED_ITEMS,
    parsePreviewedHymnNotes,
} from "./previewedHymnNotes";

/** A preview's items as the dialog has them: whole diffs, titles and all. */
const PREVIEW: HymnNoteDiff[] = [
    {
        itemId: "9002",
        title: "Abide with Me",
        sequence: 2,
        content: "R-175 / G-75",
        current: null,
        action: "create",
        changes: [{ kind: "create", content: "R-175 / G-75" }],
        keep: [],
    },
    {
        itemId: "9003",
        title: "Come Thou Fount",
        sequence: 3,
        content: "R-553 / G-17",
        current: "R-553",
        action: "update",
        changes: [
            { kind: "update", noteId: "50001", from: "R-553", content: "R-553 / G-17" },
            { kind: "delete", noteId: "50002", content: "R-553", reason: "duplicate" },
        ],
        keep: [{ kind: "keep", noteId: "50003", content: "Key of D", reason: "duplicate" }],
    },
    {
        itemId: "9007",
        title: "Special Music",
        sequence: 7,
        content: null,
        current: null,
        action: "none",
        changes: [],
        keep: [],
    },
];

/** A copy of the preview with `edit` applied to a fresh copy of its items. */
function edited(edit: (items: Record<string, unknown>[]) => void): unknown {
    const items = structuredClone(PREVIEW) as unknown as Record<string, unknown>[];
    edit(items);
    return items;
}

describe("parsePreviewedHymnNotes", () => {
    test("keeps each item's id, action and writes, and drops the rest", () => {
        expect(parsePreviewedHymnNotes(PREVIEW)).toEqual([
            { itemId: "9002", action: "create", changes: [{ kind: "create", content: "R-175 / G-75" }] },
            {
                itemId: "9003",
                action: "update",
                changes: [
                    { kind: "update", noteId: "50001", from: "R-553", content: "R-553 / G-17" },
                    { kind: "delete", noteId: "50002", content: "R-553", reason: "duplicate" },
                ],
            },
            { itemId: "9007", action: "none", changes: [] },
        ]);
    });

    test("drops fields a write does not have", () => {
        const parsed = parsePreviewedHymnNotes(
            edited((items) => {
                (items[0].changes as Record<string, unknown>[])[0].noteId = "123";
                (items[0].changes as Record<string, unknown>[])[0].extra = "x".repeat(10);
            })
        );
        expect(parsed?.[0].changes).toEqual([{ kind: "create", content: "R-175 / G-75" }]);
    });

    test("takes an empty preview, of a plan with no songs", () => {
        expect(parsePreviewedHymnNotes([])).toEqual([]);
    });

    test.each([
        ["not a list", { 0: PREVIEW[0] }],
        ["a string", "[]"],
        ["null", null],
        ["an item that is not an object", [PREVIEW[0], "9003"]],
        ["an item that is a list", [[]]],
    ])("refuses %s", (_name, value) => {
        expect(parsePreviewedHymnNotes(value)).toBeNull();
    });

    test("refuses an item or note id that is not a Planning Center id", () => {
        for (const bad of ["", "abc", "0", "01", " 1", "../1", "1/2", 42, null, undefined]) {
            expect(parsePreviewedHymnNotes(edited((items) => (items[0].itemId = bad)))).toBeNull();
            expect(
                parsePreviewedHymnNotes(
                    edited((items) => ((items[1].changes as Record<string, unknown>[])[0].noteId = bad))
                )
            ).toBeNull();
            expect(
                parsePreviewedHymnNotes(
                    edited((items) => ((items[1].changes as Record<string, unknown>[])[1].noteId = bad))
                )
            ).toBeNull();
        }
    });

    test("refuses an action, kind or reason that does not exist, and a write's missing words", () => {
        const change = (items: Record<string, unknown>[], i: number) =>
            (items[1].changes as Record<string, unknown>[])[i];
        for (const value of [
            edited((items) => (items[0].action = "rewrite")),
            edited((items) => (items[0].action = "toString")),
            edited((items) => (change(items, 0).kind = "move")),
            edited((items) => (change(items, 1).reason = "stale")),
            edited((items) => delete change(items, 0).from),
            edited((items) => (change(items, 0).content = 42)),
            edited((items) => (items[0].changes = "create")),
            edited((items) => ((items[0].changes as unknown[])[0] = null)),
        ]) {
            expect(parsePreviewedHymnNotes(value)).toBeNull();
        }
    });

    test("refuses more items, or more writes in one, than a plan has", () => {
        const many = Array.from({ length: MAX_PREVIEWED_ITEMS }, (_, i) => ({
            ...PREVIEW[2],
            itemId: String(1000 + i),
        }));
        expect(parsePreviewedHymnNotes(many)).toHaveLength(MAX_PREVIEWED_ITEMS);
        expect(parsePreviewedHymnNotes([...many, PREVIEW[2]])).toBeNull();

        const writes = Array.from({ length: MAX_PREVIEWED_CHANGES }, () => ({
            kind: "create",
            content: "R-1",
        }));
        expect(parsePreviewedHymnNotes([{ ...PREVIEW[0], changes: writes }])).not.toBeNull();
        expect(
            parsePreviewedHymnNotes([{ ...PREVIEW[0], changes: [...writes, writes[0]] }])
        ).toBeNull();
    });
});
