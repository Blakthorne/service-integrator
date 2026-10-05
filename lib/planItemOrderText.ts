import { countOf, formatCount } from "./catalog/counts";
import { checkItemOrder, type MoveDirection } from "./planItemOrder";

/**
 * The words and rows of "Reorder items" on the plan page: what the mode
 * says, the preview of the new order, and what a confirmed reorder came to.
 * The order itself (moving an item, counting what moved, what a write may
 * rely on) is lib/planItemOrder.ts. Pure and safe on both sides: the dialog
 * is built from what these return, so they are tested here.
 */

/** What the plan page says under "Reorder items", before and while the mode is on. */
export const REORDER_INTRO =
    "Move the items with the arrows, then review the new order. Nothing is written to Planning Center until you confirm.";

/** What the confirmation dialog says about what Confirm does. */
export const REORDER_DIALOG_DESCRIPTION =
    "Planning Center will list this plan's items in the order below. Nothing else about them changes.";

/** What the dialog's status line says while the order is written. */
export const REORDER_PENDING_TEXT = "Putting the items in order in Planning Center…";

/**
 * What the dialog says when the confirm's action never answered (the network
 * failed, or the session ended). The write may have gone through, so it
 * says to look before choosing the order again.
 */
export const REORDER_NO_ANSWER_MESSAGE =
    "The server did not answer, so it is not known whether the items were put in order. Look at the plan in Planning Center, or reload this page, before choosing the order again.";

/**
 * Whether the plan page offers "Reorder items" for these item ids: at least
 * two items (one cannot be put in another place), each once, and no more
 * than a reorder takes (`checkItemOrder`).
 */
export function canReorderItems(ids: readonly string[]): boolean {
    return ids.length >= 2 && checkItemOrder(ids, ids) === null;
}

/** An item type, in words: Planning Center sends "song", "header", "media" and "item". */
export function itemTypeLabel(itemType: string): string {
    switch (itemType) {
        case "song":
            return "Song";
        case "header":
            return "Header";
        case "media":
            return "Media";
        case "item":
            return "Item";
        default:
            return itemType === "" ? "Item" : itemType.charAt(0).toUpperCase() + itemType.slice(1);
    }
}

/**
 * What the page announces after an item was moved: its title and its new
 * place, "Opening Hymn moved up to place 2 of 12."
 */
export function describeMove(
    title: string,
    place: number,
    total: number,
    direction: MoveDirection
): string {
    return `${title} moved ${direction} to place ${formatCount(place)} of ${formatCount(total)}.`;
}

/**
 * How much the order has changed, as the toolbar and the dialog say it: "No
 * item has moved yet.", "2 of 12 items moved." (a swap moves two). `moved`
 * is `movedCount(shown, order)`.
 */
export function movedSummary(moved: number, total: number): string {
    return moved === 0
        ? "No item has moved yet."
        : `${formatCount(moved)} of ${countOf(total, "item")} moved.`;
}

/** What an item of a plan shows of itself in the reorder list and its preview. */
export interface OrderItem {
    id: string;
    title: string;
    itemType: string;
}

/** How far an item moved, and which way. */
export interface RowMove {
    direction: MoveDirection;
    /** How many places, at least 1. */
    by: number;
}

/** The preview's row for an item. */
export interface OrderRow {
    id: string;
    title: string;
    /** "Song", "Header"…; null for a song, which needs no tag. */
    typeLabel: string | null;
    /** Its place in the new order, from 1. */
    place: number;
    /** Its place in the order shown, from 1. */
    from: number;
    /** How far it moved; null when it stays in its place. */
    move: RowMove | null;
}

/**
 * The preview's rows: the items in the new order (`order`), each with its
 * place in the order shown (`shown`) and how far it moved. An id the items
 * do not have (it cannot be, for an order made of them) reads "Item <id>".
 */
export function orderRows(
    items: readonly OrderItem[],
    shown: readonly string[],
    order: readonly string[]
): OrderRow[] {
    const byId = new Map(items.map((item) => [item.id, item]));
    const before = new Map(shown.map((id, index) => [id, index + 1]));
    return order.map((id, index) => {
        const place = index + 1;
        const from = before.get(id) ?? place;
        const item = byId.get(id);
        return {
            id,
            title: item?.title ?? `Item ${id}`,
            typeLabel: item === undefined || item.itemType === "song" ? null : itemTypeLabel(item.itemType),
            place,
            from,
            move: from === place ? null : { direction: place < from ? "up" : "down", by: Math.abs(place - from) },
        };
    });
}

/** A row's move, short, for its tag: "Up 2", "Down 1". */
export function moveLabel({ direction, by }: RowMove): string {
    return `${direction === "up" ? "Up" : "Down"} ${by}`;
}

/** A row's move, in words for a screen reader: "moved up 2 places", "moved down 1 place". */
export function moveWords({ direction, by }: RowMove): string {
    return `moved ${direction} ${by} ${by === 1 ? "place" : "places"}`;
}

/** Why a reorder was not made, as the dialog tells it ("unknown" is the browser's: no answer came). */
export type ReorderFailure = "changed" | "busy" | "refused" | "failed" | "unknown";

/** What a confirmed reorder came to, as the dialog tells it. */
export type ReorderOutcome =
    | {
          ok: true;
          /** How many items changed place; 0 when the order was the order shown, and nothing was written. */
          moved: number;
      }
    | { ok: false; reason: ReorderFailure; message: string };

/** What the dialog shows of an outcome, and which buttons it offers. */
export interface ReorderOutcomeView {
    /** The colour of the summary: the words say the same. */
    tone: "success" | "warning" | "error";
    /** The summary, which takes focus. */
    summary: string;
    /** The summary is an alert (anything but a success). */
    alert: boolean;
    /**
     * Closing the dialog ends the mode: the plan was reread (a reorder that
     * was made, or one refused because the plan had changed), so the page
     * shows what Planning Center has now and the order chosen is no longer
     * of that plan.
     */
    endsMode: boolean;
    /** Offer "Try again", back to the preview with the order chosen. */
    canTryAgain: boolean;
    /** Offer a link to the plan in Planning Center, to look: it is not known what happened. */
    linkToPlanningCenter: boolean;
}

/**
 * The dialog's view of an outcome:
 *
 * - made: the items are in the new order, and how many moved; closing ends
 *   the mode, the page showing the new order;
 * - the order was the order shown: nothing was written;
 * - "changed": items were added or removed, or put in another order, since
 *   the page showed them, so nothing was written; the page was refreshed and
 *   shows what Planning Center has, and closing ends the mode;
 * - "busy", "refused" and "failed": the message, and Try again, which
 *   previews the same order, still held to the order the page showed;
 * - "unknown" (no answer came): it is not known whether the order was
 *   written, so it offers a link to look, and no retry.
 *
 * `total` is how many items the plan has.
 */
export function reorderOutcomeView(outcome: ReorderOutcome, total: number): ReorderOutcomeView {
    if (outcome.ok) {
        return {
            tone: "success",
            summary:
                outcome.moved === 0
                    ? "Nothing was changed: the items were in this order already."
                    : `The items are in the new order in Planning Center. ${movedSummary(outcome.moved, total)}`,
            alert: false,
            endsMode: true,
            canTryAgain: false,
            linkToPlanningCenter: false,
        };
    }
    switch (outcome.reason) {
        case "changed":
            return {
                tone: "warning",
                summary: `${outcome.message} Close this to see the plan as Planning Center has it now.`,
                alert: true,
                endsMode: true,
                canTryAgain: false,
                linkToPlanningCenter: false,
            };
        case "busy":
            return {
                tone: "warning",
                summary: outcome.message,
                alert: true,
                endsMode: false,
                canTryAgain: true,
                linkToPlanningCenter: false,
            };
        case "refused":
        case "failed":
            return {
                tone: "error",
                summary: outcome.message,
                alert: true,
                endsMode: false,
                canTryAgain: true,
                linkToPlanningCenter: false,
            };
        case "unknown":
            return {
                tone: "error",
                summary: outcome.message,
                alert: true,
                endsMode: false,
                canTryAgain: false,
                linkToPlanningCenter: true,
            };
    }
}
