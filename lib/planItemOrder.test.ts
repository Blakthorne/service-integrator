import { describe, expect, test } from "vitest";
import {
    MAX_ORDERED_ITEMS,
    checkItemOrder,
    compareToShown,
    moveItem,
    movedCount,
} from "./planItemOrder";

describe("moveItem", () => {
    const ids = ["1", "2", "3", "4"];

    test("moves an item one place up or down", () => {
        expect(moveItem(ids, "3", "up")).toEqual(["1", "3", "2", "4"]);
        expect(moveItem(ids, "2", "down")).toEqual(["1", "3", "2", "4"]);
        expect(moveItem(ids, "2", "up")).toEqual(["2", "1", "3", "4"]);
        expect(moveItem(ids, "3", "down")).toEqual(["1", "2", "4", "3"]);
    });

    test("leaves the list as it is for the first item up, the last down, and an item that is not in it", () => {
        expect(moveItem(ids, "1", "up")).toEqual(ids);
        expect(moveItem(ids, "4", "down")).toEqual(ids);
        expect(moveItem(ids, "9", "up")).toEqual(ids);
        expect(moveItem(ids, "9", "down")).toEqual(ids);
        expect(moveItem(["1"], "1", "up")).toEqual(["1"]);
        expect(moveItem([], "1", "down")).toEqual([]);
    });

    test("gives a new list, never changing the one it is given", () => {
        const before = [...ids];
        const moved = moveItem(ids, "2", "down");
        expect(ids).toEqual(before);
        expect(moved).not.toBe(ids);
        expect(moveItem(ids, "1", "up")).not.toBe(ids);
    });

    test("moves an item to any place with enough moves", () => {
        let order = ids;
        for (let i = 0; i < 3; i++) {
            order = moveItem(order, "4", "up");
        }
        expect(order).toEqual(["4", "1", "2", "3"]);
    });
});

describe("movedCount", () => {
    test("counts the items in another place", () => {
        expect(movedCount(["1", "2", "3"], ["1", "2", "3"])).toBe(0);
        expect(movedCount(["1", "2", "3"], ["2", "1", "3"])).toBe(2);
        expect(movedCount(["1", "2", "3"], ["3", "1", "2"])).toBe(3);
        expect(movedCount([], [])).toBe(0);
    });
});

describe("checkItemOrder", () => {
    test("is null for the same items in another order, or the same order", () => {
        expect(checkItemOrder(["1", "2", "3"], ["3", "1", "2"])).toBeNull();
        expect(checkItemOrder(["1", "2", "3"], ["1", "2", "3"])).toBeNull();
        expect(checkItemOrder(["1"], ["1"])).toBeNull();
    });

    test("refuses no items", () => {
        expect(checkItemOrder([], [])).toBe("There are no items to put in order.");
        expect(checkItemOrder(["1"], [])).toBe("There are no items to put in order.");
        expect(checkItemOrder([], ["1"])).toBe("There are no items to put in order.");
    });

    test("refuses an item twice, in either list", () => {
        expect(checkItemOrder(["1", "2"], ["1", "1"])).toBe("An item is listed twice.");
        expect(checkItemOrder(["1", "1"], ["1", "2"])).toBe("An item is listed twice.");
    });

    test("refuses a new order of other items, or of more or fewer", () => {
        const message = "The new order is not of the items that were shown.";
        expect(checkItemOrder(["1", "2"], ["1", "3"])).toBe(message);
        expect(checkItemOrder(["1", "2"], ["1"])).toBe(message);
        expect(checkItemOrder(["1", "2"], ["1", "2", "3"])).toBe(message);
    });

    test("takes at most MAX_ORDERED_ITEMS items", () => {
        const many = (n: number) => Array.from({ length: n }, (_, i) => String(i + 1));
        expect(checkItemOrder(many(MAX_ORDERED_ITEMS), many(MAX_ORDERED_ITEMS))).toBeNull();
        expect(checkItemOrder(many(MAX_ORDERED_ITEMS + 1), many(MAX_ORDERED_ITEMS + 1))).toBe(
            `A plan's items can be put in order up to ${MAX_ORDERED_ITEMS} at a time.`
        );
    });
});

describe("compareToShown", () => {
    const shown = ["1", "2", "3"];

    test("is the same for the same items in the same order", () => {
        expect(compareToShown(["1", "2", "3"], shown)).toBe("same");
        expect(compareToShown([], [])).toBe("same");
    });

    test("is reordered for the same items in another order", () => {
        expect(compareToShown(["2", "1", "3"], shown)).toBe("reordered");
    });

    test("is items-changed when an item was added or removed, or replaced", () => {
        expect(compareToShown(["1", "2", "3", "4"], shown)).toBe("items-changed");
        expect(compareToShown(["1", "2"], shown)).toBe("items-changed");
        expect(compareToShown(["1", "2", "4"], shown)).toBe("items-changed");
        expect(compareToShown([], shown)).toBe("items-changed");
    });
});
