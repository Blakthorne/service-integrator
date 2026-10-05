import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { withTransaction } from "@/lib/db";
import {
    countHistory,
    deleteHistoryPlan,
    deleteUnlistedPlans,
    listHistoryPlans,
    replacePlanOccurrences,
    upsertListedPlans,
    type HistoryPlan,
    type ListedPlan,
    type NewOccurrence,
} from "@/lib/db/history";
import { planDateFromSortDate } from "@/lib/format";
import { choosePlansToRead } from "@/lib/historySync";
import { PcoError, fetchAllPlans, fetchPlanSongItems } from "@/lib/pco";
import { localYmd } from "@/lib/plansByDate";

/**
 * The plan history in the app: the `history` job's sync of Planning Center's
 * plans and the songs in them (`syncPlanHistory`), which the reports, the
 * song page, the songs list, the dashboard and the plan page's repeat
 * warnings read (lib/db/history.ts).
 */

/** What a sync of the plan history did, as its `sync_runs` row records it. */
export type PlanHistorySyncCounts = {
    /** Plans Planning Center listed (those without a date are left out). */
    plans: number;
    /** Plans new to the history. */
    added: number;
    /** Plans the listing showed changed since: a new `updated_at`, a moved date or service type. */
    changed: number;
    /** Plans dropped: Planning Center no longer lists them, or answered 404 when their items were read. */
    removed: number;
    /** Plans whose items were read again. */
    read: number;
    /** Of those, plans read only because it was a week since the last reading of their items. */
    weekly: number;
    /** Song items the history holds in all its plans, after the sync. */
    occurrences: number;
};

/** The song items of a plan as the history keeps them. */
function occurrencesOf(
    items: readonly { id: string; songId: string | null; sequence: number }[]
): NewOccurrence[] {
    return items.flatMap((item) =>
        item.songId === null
            ? []
            : [{ itemId: item.id, pcoSongId: item.songId, sequence: item.sequence }]
    );
}

/** A plan's song items, paced, or null when Planning Center answers 404: it deleted the plan. Any other failure throws. */
async function readSongItems(plan: Pick<HistoryPlan, "serviceTypeId" | "planId">) {
    try {
        return await fetchPlanSongItems(plan.serviceTypeId, plan.planId, { paced: true });
    } catch (error) {
        if (error instanceof PcoError && error.status === 404) {
            return null;
        }
        throw error;
    }
}

/**
 * Mirror the songs of Planning Center's plans: the work of the `history` job
 * (lib/jobs.ts), daily, at boot when it never ran, and on demand.
 *
 * It first lists every plan of every service type, paced (about four
 * requests), and only then writes, in one transaction: each plan is added,
 * or, when the listing shows it changed, given its new values and marked
 * unread (`upsertListedPlans`), and each plan the listing lacks is dropped,
 * with its songs. A failed or partial listing throws before anything is
 * written, and so does a listing with no plans at all while the history has
 * some, which is taken for a failure rather than every plan deleted at once.
 * A plan without a date has no history and is left out.
 *
 * Then it reads the items of each plan that needs it (`choosePlansToRead`,
 * `include=song`, paced, the latest date first): plans never read or
 * changed, every upcoming plan and every plan of the last 8 weeks (the spike
 * found that edits made through the API do not move `updated_at`), and any
 * other plan whose last reading is a week old, which is the weekly pass.
 * Each plan's songs replace what it held in a transaction of their own,
 * right after its read, so a sync that fails part-way keeps what it did,
 * and a plan whose read failed is still unread and is tried again by the
 * next. A read that fails stops the sync with its error, except a 404
 * (Planning Center deleted the plan since the listing), which drops the
 * plan.
 *
 * `now` says when it starts and, with the church's calendar date it gives,
 * which plans are recent.
 */
export async function syncPlanHistory(
    db: DatabaseSync,
    now: () => Date = () => new Date()
): Promise<PlanHistorySyncCounts> {
    const startedAt = now();
    const today = localYmd(startedAt);
    const listing = await fetchAllPlans({ paced: true });
    const listed: ListedPlan[] = [];
    for (const plan of listing) {
        const planDate = planDateFromSortDate(plan.sortDate);
        if (planDate !== null) {
            listed.push({
                planId: plan.id,
                serviceTypeId: plan.serviceTypeId,
                planDate,
                updatedAt: plan.updatedAt,
            });
        }
    }

    const stored = withTransaction(db, () => {
        if (listed.length === 0 && listHistoryPlans(db).length > 0) {
            throw new Error(
                "Planning Center listed no plans, though the history has some; nothing was changed"
            );
        }
        const { added, changed } = upsertListedPlans(db, listed);
        const removed = deleteUnlistedPlans(
            db,
            listed.map(({ planId }) => planId)
        );
        return { added: added.length, changed: changed.length, removed: removed.length };
    });

    let { removed } = stored;
    let read = 0;
    let weekly = 0;
    for (const { plan, reason } of choosePlansToRead(listHistoryPlans(db), startedAt, today)) {
        const items = await readSongItems(plan);
        if (items === null) {
            if (deleteHistoryPlan(db, plan.planId)) {
                removed += 1;
            }
            continue;
        }
        replacePlanOccurrences(db, plan.planId, occurrencesOf(items), now());
        read += 1;
        if (reason === "weekly") {
            weekly += 1;
        }
    }
    return {
        plans: listed.length,
        added: stored.added,
        changed: stored.changed,
        removed,
        read,
        weekly,
        occurrences: countHistory(db).occurrences,
    };
}

/** "1 plan" or "216 plans". */
function counted(count: number, singular: string, plural: string): string {
    return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * A sync's counts in words, for its run's message: "Synced 216 plans (1386
 * song items): read 21 plans (4 in the weekly pass), 2 added, 1 changed, 1
 * removed", leaving out what did not happen, or "…: nothing needed reading".
 */
export function describePlanHistorySync({
    plans,
    added,
    changed,
    removed,
    read,
    weekly,
    occurrences,
}: PlanHistorySyncCounts): string {
    const parts = [
        read === 0
            ? "nothing needed reading"
            : `read ${counted(read, "plan", "plans")}${weekly > 0 ? ` (${weekly} in the weekly pass)` : ""}`,
        ...(added > 0 ? [`${added} added`] : []),
        ...(changed > 0 ? [`${changed} changed`] : []),
        ...(removed > 0 ? [`${removed} removed`] : []),
    ];
    return `Synced ${counted(plans, "plan", "plans")} (${counted(occurrences, "song item", "song items")}): ${parts.join(", ")}`;
}
