import { describe, expect, test } from "vitest";
import { MAX_ORDERED_ITEMS } from "./planItemOrder";
import { parsePreviewedItemOrder } from "./previewedItemOrder";

describe("parsePreviewedItemOrder", () => {
    test("rebuilds the order shown and the order made from their ids", () => {
        expect(
            parsePreviewedItemOrder({ shown: ["901", "902", "903"], order: ["903", "901", "902"] })
        ).toEqual({ shown: ["901", "902", "903"], order: ["903", "901", "902"] });
    });

    test("drops any other field", () => {
        expect(
            parsePreviewedItemOrder({ shown: ["901"], order: ["901"], serviceTypeId: "x", extra: { a: 1 } })
        ).toEqual({ shown: ["901"], order: ["901"] });
    });

    test.each([
        ["nothing", undefined],
        ["null", null],
        ["text", "901"],
        ["a list", [["901"], ["901"]]],
        ["no order", { shown: ["901"] }],
        ["no order shown", { order: ["901"] }],
        ["lists that are not lists", { shown: "901", order: "901" }],
        ["a list holding a number", { shown: ["901", 902], order: ["901", "902"] }],
        ["an id that is not one", { shown: ["901", "../1"], order: ["901", "../1"] }],
        ["an id with a leading zero", { shown: ["0901"], order: ["0901"] }],
        ["no items", { shown: [], order: [] }],
        ["an item twice", { shown: ["901", "902"], order: ["901", "901"] }],
        ["other items in the new order", { shown: ["901", "902"], order: ["901", "903"] }],
        ["fewer items in the new order", { shown: ["901", "902"], order: ["901"] }],
    ])("refuses %s", (_name, value) => {
        expect(parsePreviewedItemOrder(value)).toBeNull();
    });

    test("takes up to MAX_ORDERED_ITEMS items, and refuses more", () => {
        const ids = (n: number) => Array.from({ length: n }, (_, i) => String(1000 + i));
        const max = ids(MAX_ORDERED_ITEMS);
        expect(parsePreviewedItemOrder({ shown: max, order: [...max].reverse() })).toEqual({
            shown: max,
            order: [...max].reverse(),
        });
        const over = ids(MAX_ORDERED_ITEMS + 1);
        expect(parsePreviewedItemOrder({ shown: over, order: over })).toBeNull();
    });
});
