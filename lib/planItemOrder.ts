/**
 * The order of a plan's items, for "Reorder items" on the plan page: moving
 * an item up or down, and what a write may rely on. The page lists every
 * item of the plan (headers too), changes the order in the browser, and on
 * Confirm sends back the order it showed (`shown`) and the order the person
 * made (`order`); `reorderItems` (lib/queries/planItems.ts) holds the write
 * to them. Pure and safe on both sides.
 */

/** The most items a reorder takes: far more than a service has. */
export const MAX_ORDERED_ITEMS = 500;

export type MoveDirection = "up" | "down";

/**
 * `ids` with `id` one place earlier ("up") or later ("down"), as a new
 * list. A list is unchanged when `id` is already first (up) or last (down),
 * or is not in it.
 */
export function moveItem(ids: readonly string[], id: string, direction: MoveDirection): string[] {
    const moved = [...ids];
    const from = moved.indexOf(id);
    const to = direction === "up" ? from - 1 : from + 1;
    if (from === -1 || to < 0 || to >= moved.length) {
        return moved;
    }
    [moved[from], moved[to]] = [moved[to], moved[from]];
    return moved;
}

/** How many items are in a different place in `order` than in `shown`, which hold the same items. */
export function movedCount(shown: readonly string[], order: readonly string[]): number {
    return order.filter((id, place) => shown[place] !== id).length;
}

/**
 * Why a reorder is not one that can be written, in words fit to show; null
 * when it is: `shown` and `order` list the same items, at least one and at
 * most `MAX_ORDERED_ITEMS`, each once. (A list of the same length with
 * every id in it, and none twice, holds the same items.)
 */
export function checkItemOrder(shown: readonly string[], order: readonly string[]): string | null {
    if (shown.length === 0 || order.length === 0) {
        return "There are no items to put in order.";
    }
    if (shown.length > MAX_ORDERED_ITEMS || order.length > MAX_ORDERED_ITEMS) {
        return `A plan's items can be put in order up to ${MAX_ORDERED_ITEMS} at a time.`;
    }
    if (new Set(shown).size !== shown.length || new Set(order).size !== order.length) {
        return "An item is listed twice.";
    }
    const known = new Set(shown);
    if (shown.length !== order.length || order.some((id) => !known.has(id))) {
        return "The new order is not of the items that were shown.";
    }
    return null;
}

/** How the plan's items are now, against the order the page showed. */
export type ShownComparison =
    /** The same items in the same order: nothing changed since. */
    | "same"
    /** The same items in another order: someone reordered them. */
    | "reordered"
    /** Items were added or removed. */
    | "items-changed";

/** Compare the plan's items as Planning Center has them now (`fresh`, in order) with the order the page `shown`. */
export function compareToShown(fresh: readonly string[], shown: readonly string[]): ShownComparison {
    const known = new Set(shown);
    if (fresh.length !== shown.length || fresh.some((id) => !known.has(id))) {
        return "items-changed";
    }
    return fresh.every((id, place) => id === shown[place]) ? "same" : "reordered";
}
