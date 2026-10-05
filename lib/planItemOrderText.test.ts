import { describe, expect, test } from "vitest";
import { MAX_ORDERED_ITEMS } from "./planItemOrder";
import {
    REORDER_NO_ANSWER_MESSAGE,
    canReorderItems,
    describeMove,
    itemTypeLabel,
    moveLabel,
    movedSummary,
    moveWords,
    orderRows,
    reorderOutcomeView,
    type OrderItem,
    type ReorderOutcome,
} from "./planItemOrderText";

describe("canReorderItems", () => {
    test("needs at least two items, since one cannot be put in another place", () => {
        expect(canReorderItems([])).toBe(false);
        expect(canReorderItems(["1"])).toBe(false);
        expect(canReorderItems(["1", "2"])).toBe(true);
    });

    test("takes up to the most a reorder takes, and no more", () => {
        const ids = (count: number) => Array.from({ length: count }, (_, index) => String(index + 1));
        expect(canReorderItems(ids(MAX_ORDERED_ITEMS))).toBe(true);
        expect(canReorderItems(ids(MAX_ORDERED_ITEMS + 1))).toBe(false);
    });

    test("does not offer a plan that lists an item twice", () => {
        expect(canReorderItems(["1", "2", "1"])).toBe(false);
    });
});

describe("itemTypeLabel", () => {
    test.each([
        ["song", "Song"],
        ["header", "Header"],
        ["media", "Media"],
        ["item", "Item"],
        ["", "Item"],
        ["arrangement", "Arrangement"],
    ])("%j is %j", (type, label) => {
        expect(itemTypeLabel(type)).toBe(label);
    });
});

describe("describeMove", () => {
    test("says which item moved, which way and where it is now", () => {
        expect(describeMove("Opening Hymn", 2, 12, "up")).toBe("Opening Hymn moved up to place 2 of 12.");
        expect(describeMove("Offering", 11, 12, "down")).toBe("Offering moved down to place 11 of 12.");
    });

    test("groups thousands as the catalog's counts do", () => {
        expect(describeMove("x", 1200, 1234, "down")).toBe("x moved down to place 1,200 of 1,234.");
    });
});

describe("movedSummary", () => {
    test("says nothing has moved yet", () => {
        expect(movedSummary(0, 12)).toBe("No item has moved yet.");
    });

    test("says how many of the plan's items moved", () => {
        expect(movedSummary(2, 12)).toBe("2 of 12 items moved.");
        expect(movedSummary(1, 1)).toBe("1 of 1 item moved.");
    });
});

describe("orderRows", () => {
    const items: OrderItem[] = [
        { id: "1", title: "Welcome", itemType: "header" },
        { id: "2", title: "Amazing Grace", itemType: "song" },
        { id: "3", title: "Announcements", itemType: "item" },
        { id: "4", title: "Holy, Holy, Holy", itemType: "song" },
    ];
    const shown = ["1", "2", "3", "4"];

    test("lists the items in the new order, with each place and how far it moved", () => {
        // Holy, Holy, Holy goes up two places; Amazing Grace and Announcements go down one.
        expect(orderRows(items, shown, ["1", "4", "2", "3"])).toEqual([
            { id: "1", title: "Welcome", typeLabel: "Header", place: 1, from: 1, move: null },
            { id: "4", title: "Holy, Holy, Holy", typeLabel: null, place: 2, from: 4, move: { direction: "up", by: 2 } },
            { id: "2", title: "Amazing Grace", typeLabel: null, place: 3, from: 2, move: { direction: "down", by: 1 } },
            { id: "3", title: "Announcements", typeLabel: "Item", place: 4, from: 3, move: { direction: "down", by: 1 } },
        ]);
    });

    test("has no move for an order that is the order shown", () => {
        expect(orderRows(items, shown, shown).every(({ move }) => move === null)).toBe(true);
    });

    test("tags every kind of item but a song with its type", () => {
        expect(orderRows(items, shown, shown).map(({ typeLabel }) => typeLabel)).toEqual([
            "Header",
            null,
            "Item",
            null,
        ]);
    });

    test("calls an item the plan does not list by its id, rather than throw", () => {
        expect(orderRows(items.slice(0, 1), ["1", "9"], ["9", "1"])).toEqual([
            { id: "9", title: "Item 9", typeLabel: null, place: 1, from: 2, move: { direction: "up", by: 1 } },
            { id: "1", title: "Welcome", typeLabel: "Header", place: 2, from: 1, move: { direction: "down", by: 1 } },
        ]);
    });

    test("has no rows for no order", () => {
        expect(orderRows(items, shown, [])).toEqual([]);
    });
});

describe("moveLabel and moveWords", () => {
    test("say how far and which way, short and in words", () => {
        expect(moveLabel({ direction: "up", by: 2 })).toBe("Up 2");
        expect(moveLabel({ direction: "down", by: 1 })).toBe("Down 1");
        expect(moveWords({ direction: "up", by: 2 })).toBe("moved up 2 places");
        expect(moveWords({ direction: "down", by: 1 })).toBe("moved down 1 place");
    });
});

describe("reorderOutcomeView", () => {
    const fail = (reason: "changed" | "busy" | "refused" | "failed" | "unknown", message: string): ReorderOutcome => ({
        ok: false,
        reason,
        message,
    });

    test("a reorder that was made says how many items moved, and closing ends the mode", () => {
        expect(reorderOutcomeView({ ok: true, moved: 3 }, 12)).toEqual({
            tone: "success",
            summary: "The items are in the new order in Planning Center. 3 of 12 items moved.",
            alert: false,
            endsMode: true,
            canTryAgain: false,
            linkToPlanningCenter: false,
        });
    });

    test("an order that was the order shown says nothing was written", () => {
        const view = reorderOutcomeView({ ok: true, moved: 0 }, 12);
        expect(view.summary).toBe("Nothing was changed: the items were in this order already.");
        expect(view).toMatchObject({ tone: "success", alert: false, endsMode: true });
    });

    test("a plan that changed gives the reason, nothing was written, and closing ends the mode", () => {
        const view = reorderOutcomeView(fail("changed", "Items were added to or removed from this plan."), 12);
        expect(view).toMatchObject({
            tone: "warning",
            alert: true,
            endsMode: true,
            canTryAgain: false,
            linkToPlanningCenter: false,
        });
        expect(view.summary).toBe(
            "Items were added to or removed from this plan. Close this to see the plan as Planning Center has it now."
        );
    });

    test("a reorder under way says so, and the order can be tried again", () => {
        expect(reorderOutcomeView(fail("busy", "Being put in order already."), 12)).toEqual({
            tone: "warning",
            summary: "Being put in order already.",
            alert: true,
            endsMode: false,
            canTryAgain: true,
            linkToPlanningCenter: false,
        });
    });

    test.each(["refused", "failed"] as const)("a %s reorder gives its message and can be tried again", (reason) => {
        expect(reorderOutcomeView(fail(reason, "It did not work."), 12)).toEqual({
            tone: "error",
            summary: "It did not work.",
            alert: true,
            endsMode: false,
            canTryAgain: true,
            linkToPlanningCenter: false,
        });
    });

    test("an answer that never came says it is not known, links to the plan and offers no retry", () => {
        expect(reorderOutcomeView(fail("unknown", REORDER_NO_ANSWER_MESSAGE), 12)).toEqual({
            tone: "error",
            summary: REORDER_NO_ANSWER_MESSAGE,
            alert: true,
            endsMode: false,
            canTryAgain: false,
            linkToPlanningCenter: true,
        });
        expect(REORDER_NO_ANSWER_MESSAGE).toMatch(/not known/);
    });
});
