import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { getDb } from "@/lib/db";
import { errorMessage } from "@/lib/db/errors";
import { recordWrite, type NewWriteLogEntry } from "@/lib/db/writeLog";
import { checkItemOrder, compareToShown, movedCount } from "@/lib/planItemOrder";
import {
    PcoError,
    PcoValidationError,
    fetchPlanItems,
    parsePcoId,
    reorderPlanItems,
} from "@/lib/pco";
import type { PreviewedItemOrder } from "@/lib/previewedItemOrder";
import type { PcoWriteRefusal } from "./pcoSongs";

/**
 * The order of a plan's items in Planning Center, which a person changes
 * from the plan page ("Reorder items": up and down, a preview, then
 * Confirm). It reads afresh before it writes (refresh-before-write), writes
 * only the order the person previewed and never over what the page did not
 * show, runs one reorder per plan at a time, and records a `write_log` row
 * (kind `item`) for each write it sends, made or refused. The database is
 * opened before anything is sent, and a write refused by the app (the plan
 * changed, one is under way) comes back as a value with a message fit to
 * show, as `lib/queries/pcoSongs.ts` does. It revalidates nothing: its
 * caller, a server action, does.
 */

const NO_SUCH_PLAN = "There is no such plan.";

/** What `reorderItems` says to a second reorder of the same plan while the first is under way. */
export const REORDER_IN_PROGRESS_MESSAGE =
    "This plan's items are being put in order already, so this changed nothing. Wait for that to finish, then look at the plan.";

/** What `reorderItems` says when items were added to or removed from the plan since the page showed it. */
export const ITEMS_CHANGED_MESSAGE =
    "Items were added to or removed from this plan since you chose the order, so nothing was reordered. Reload the plan and choose the order again.";

/** What `reorderItems` says when the plan's items were put in another order since the page showed it. */
export const ITEMS_REORDERED_MESSAGE =
    "The order of this plan's items was changed in Planning Center since you chose the new one, so nothing was reordered. Reload the plan and choose the order again.";

/**
 * What `reorderItems` did: the order written, or why it was refused (see
 * `PcoWriteRefusal`; the reasons are "invalid", "not-found", "busy",
 * "changed" and "refused").
 */
export type ReorderItemsResult =
    | {
          ok: true;
          /** The ids of the plan's items in the order Planning Center now has them. */
          itemIds: string[];
          /** How many items changed place. 0 when the order asked for was the order shown: nothing is written then. */
          moved: number;
      }
    | PcoWriteRefusal;

function refusal(reason: PcoWriteRefusal["reason"], message: string): PcoWriteRefusal {
    return { ok: false, reason, message };
}

/** What the write log records of a write that failed: why, Planning Center's status, and its reasons for a 422. */
function writeError(error: unknown): { error: string; status?: number; details?: string[] } {
    if (error instanceof PcoValidationError) {
        return {
            error: error.details.length > 0 ? error.details.join("; ") : error.message,
            status: error.status,
            details: [...error.details],
        };
    }
    if (error instanceof PcoError) {
        return { error: error.message, status: error.status };
    }
    return { error: errorMessage(error) };
}

/** Record a write at `at`; a failure to record it is logged, and does not undo or stop anything. */
function logWrite(db: DatabaseSync, entry: NewWriteLogEntry, at: Date): void {
    try {
        recordWrite(db, entry, at);
    } catch (error) {
        console.error(`Failed to record a write to Planning Center (${entry.target}):`, error);
    }
}

/**
 * The reorders in progress, by plan id (unique across service types). They
 * live on globalThis, not in a module constant, because a server action's
 * copy of this module is not the page's (convention 15), and two tabs
 * confirming at once must still see each other. Bump the version if what is
 * stored here changes.
 */
const REORDERING_GLOBAL = Symbol.for("service-integrator.planItems.reordering.v1");

function reordersInProgress(): Set<string> {
    const scope = globalThis as unknown as { [REORDERING_GLOBAL]?: Set<string> };
    return (scope[REORDERING_GLOBAL] ??= new Set());
}

/**
 * Put plan `planId`'s items in the order `previewed.order`, which the person
 * previewed after the page showed them in the order `previewed.shown` (both
 * list every item of the plan, headers too, by id: the dialog sends back
 * what it showed, and the confirm action parses it, `parsePreviewedItemOrder`).
 *
 * It reads the plan's items afresh first (`fetchPlanItems`, never the
 * request's `cache()`d read) and goes ahead only when they are exactly what
 * the page showed: the same items in the same order. Items added or removed
 * since ("changed"), or put in another order by someone else ("changed",
 * with its own words), are refused, writing nothing, since the new order
 * was made from a plan that has changed and would put an item added since
 * after the rest, or lose the other person's order unseen. Then it sends
 * every id in the new order (`reorderPlanItems`, unpaced: someone is
 * waiting; a partial list would move only the items it names) and logs a
 * `write_log` row (kind `item`, action "reorder": the order before and
 * after, the items' titles, how many moved), whether Planning Center made
 * the change or refused it. An order that is the order shown writes
 * nothing, and `moved` is 0.
 *
 * One reorder per plan runs at a time: a second while the first is under
 * way, from another tab say, is refused as "busy", never joined or queued.
 *
 * Refused when an id is not a Planning Center id or the lists are not of
 * the same items ("invalid"), Planning Center has no such plan
 * ("not-found"), the plan changed ("changed"), another reorder of it is
 * under way ("busy"), or Planning Center refuses the order as invalid (a
 * 422: "refused", with its reasons). Throws when Planning Center or the
 * database fails (a write that failed is logged first).
 */
export async function reorderItems(
    serviceTypeId: string,
    planId: string,
    previewed: PreviewedItemOrder,
    now: Date = new Date()
): Promise<ReorderItemsResult> {
    const st = parsePcoId(serviceTypeId);
    const plan = parsePcoId(planId);
    if (st === null || plan === null) {
        return refusal("not-found", NO_SUCH_PLAN);
    }
    const problem =
        checkItemOrder(previewed.shown, previewed.order) ??
        ([...previewed.shown, ...previewed.order].some((id) => parsePcoId(id) === null)
            ? "An item is not one of Planning Center's."
            : null);
    if (problem !== null) {
        return refusal("invalid", problem);
    }
    const running = reordersInProgress();
    if (running.has(plan)) {
        return refusal("busy", REORDER_IN_PROGRESS_MESSAGE);
    }
    // Set before the first await, so a call that comes in while this one
    // waits on Planning Center finds it.
    running.add(plan);
    try {
        return await reorder(st, plan, previewed, now);
    } finally {
        running.delete(plan);
    }
}

/** The plan's items, read afresh, or null when Planning Center answers 404: it has no such plan. */
async function readItems(st: string, plan: string) {
    try {
        return (await fetchPlanItems(st, plan)).items;
    } catch (error) {
        if (error instanceof PcoError && error.status === 404) {
            return null;
        }
        throw error;
    }
}

/** The work of `reorderItems`, one at a time for a plan. */
async function reorder(
    st: string,
    plan: string,
    { shown, order }: PreviewedItemOrder,
    now: Date
): Promise<ReorderItemsResult> {
    const db = getDb();
    const items = await readItems(st, plan);
    if (items === null) {
        return refusal("not-found", NO_SUCH_PLAN);
    }
    const fresh = items.map(({ id }) => id);
    switch (compareToShown(fresh, shown)) {
        case "items-changed":
            return refusal("changed", ITEMS_CHANGED_MESSAGE);
        case "reordered":
            return refusal("changed", ITEMS_REORDERED_MESSAGE);
        case "same":
            break;
    }
    const moved = movedCount(shown, order);
    if (moved === 0) {
        return { ok: true, itemIds: [...order], moved: 0 };
    }
    const target = `plan ${plan}`;
    const payload = {
        action: "reorder",
        serviceTypeId: st,
        planId: plan,
        count: fresh.length,
        moved,
        from: fresh,
        to: [...order],
        titles: Object.fromEntries(items.map(({ id, title }) => [id, title])),
    };
    try {
        await reorderPlanItems(st, plan, order);
    } catch (error) {
        logWrite(db, { kind: "item", target, ok: false, payload, result: writeError(error) }, now);
        if (error instanceof PcoValidationError) {
            const reasons = error.details.length > 0 ? `: ${error.details.join("; ")}` : ".";
            return {
                ok: false,
                reason: "refused",
                message: `Planning Center refused the new order${reasons}`,
                details: [...error.details],
            };
        }
        throw error;
    }
    logWrite(db, { kind: "item", target, ok: true, payload, result: { itemIds: [...order] } }, now);
    return { ok: true, itemIds: [...order], moved };
}
