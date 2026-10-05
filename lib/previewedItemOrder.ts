import "server-only";
import { MAX_ORDERED_ITEMS, checkItemOrder } from "@/lib/planItemOrder";
import { parsePcoId } from "@/lib/pco";

/**
 * The reorder a plan page previewed, as its dialog sends it back with
 * Confirm: the order of the plan's items it showed and the order the person
 * made. It comes from a browser, so the confirm action parses it before
 * `reorderItems` holds the write to it: every id through `parsePcoId`, the
 * lists' lengths against `MAX_ORDERED_ITEMS`, and the two lists against each
 * other (`checkItemOrder`), so a forged or oversized body is refused before
 * Planning Center is read.
 */
export interface PreviewedItemOrder {
    /** The ids of the plan's items in the order the page showed. */
    shown: string[];
    /** The same ids in the order the person made, to be written. */
    order: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A list of at most `MAX_ORDERED_ITEMS` Planning Center ids, or null for anything else. */
function parseIds(value: unknown): string[] | null {
    if (!Array.isArray(value) || value.length > MAX_ORDERED_ITEMS) {
        return null;
    }
    const ids: string[] = [];
    for (const item of value) {
        const id = parsePcoId(item);
        if (id === null) {
            return null;
        }
        ids.push(id);
    }
    return ids;
}

/**
 * What a browser sent back as the previewed order, rebuilt from its checked
 * ids alone, or null when it is not a reorder `reorderItems` could write:
 * not an object with two lists of Planning Center ids, or lists that are
 * not of the same items, each once (`checkItemOrder`).
 */
export function parsePreviewedItemOrder(value: unknown): PreviewedItemOrder | null {
    if (!isRecord(value)) {
        return null;
    }
    const shown = parseIds(value.shown);
    const order = parseIds(value.order);
    if (shown === null || order === null || checkItemOrder(shown, order) !== null) {
        return null;
    }
    return { shown, order };
}
