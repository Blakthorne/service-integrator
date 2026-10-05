import type { HistoryPlan } from "./db/history";
import type { SyncRun } from "./db/syncRuns";
import { addDaysToYmd } from "./format";

/**
 * Which plans the history sync reads again, and when it runs: the rules of
 * `syncPlanHistory` (lib/queries/history.ts) and the history job
 * (lib/jobs.ts), as pure functions. Pure and safe on both sides.
 *
 * A listing of Planning Center's plans says when each plan was updated, but
 * the spike found that edits made through the API do not move `updated_at`
 * (the app's own "add to a plan" is one), so a plan that looks unchanged may
 * not be. The sync therefore reads, beyond the plans a listing shows
 * changed, every plan that is upcoming or recent, each time it runs, and
 * every other plan once a week.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Plans dated within this many weeks before today, and every plan after, are read on every sync. */
export const RECENT_PLAN_WEEKS = 8;

/** A plan whose items were read this many days ago or more is read again: the weekly pass over every plan. */
export const FULL_PASS_DAYS = 7;

/** How long after a successful run the history sync is due again: it runs daily. */
export const HISTORY_SYNC_INTERVAL_MS = DAY_MS;

/**
 * Why a plan's items are read, the first that applies:
 * - "unread": the history has not read them since the plan was added or
 *   changed (`items_synced_at` is null), or a read failed;
 * - "recent": the plan is upcoming or from the last `RECENT_PLAN_WEEKS` weeks;
 * - "weekly": they were last read `FULL_PASS_DAYS` days ago or more.
 */
export type PlanReadReason = "unread" | "recent" | "weekly";

/** A plan to read, and why. */
export interface PlanToRead {
    plan: HistoryPlan;
    reason: PlanReadReason;
}

/**
 * The plans whose items to read, at `now`, when `today` (`YYYY-MM-DD`) is
 * the church's date: each with its reason (`PlanReadReason`), the latest
 * date first, so that a sync that stops early has read what matters most.
 * `plans` are the history's plans as the listing left them, so a plan the
 * listing showed changed is already unread.
 */
export function choosePlansToRead(
    plans: readonly HistoryPlan[],
    now: Date,
    today: string
): PlanToRead[] {
    const recentFrom = addDaysToYmd(today, -7 * RECENT_PLAN_WEEKS);
    const staleBefore = new Date(now.getTime() - FULL_PASS_DAYS * DAY_MS).toISOString();
    const chosen: PlanToRead[] = [];
    for (const plan of plans) {
        if (plan.itemsSyncedAt === null) {
            chosen.push({ plan, reason: "unread" });
        } else if (plan.planDate >= recentFrom) {
            chosen.push({ plan, reason: "recent" });
        } else if (plan.itemsSyncedAt <= staleBefore) {
            chosen.push({ plan, reason: "weekly" });
        }
    }
    return chosen.sort(
        (a, b) =>
            (a.plan.planDate === b.plan.planDate ? 0 : a.plan.planDate < b.plan.planDate ? 1 : -1) ||
            (a.plan.planId === b.plan.planId ? 0 : a.plan.planId < b.plan.planId ? 1 : -1)
    );
}

/**
 * Whether a scheduled check should run the history sync at `now`, given its
 * latest run (null when it never ran): when it never ran, when the latest
 * run did not succeed (it failed, or a restart interrupted it), or when the
 * latest success is a day old. A run still in progress is not due: it is
 * running. As for the backup, the job is checked often and asks this each
 * time, so a restart (every deploy is one) never stretches the gap much past
 * a day.
 */
export function isHistorySyncDue(
    latest: Pick<SyncRun, "ok" | "startedAt" | "finishedAt"> | null,
    now: Date
): boolean {
    if (latest === null || latest.ok === false) {
        return true;
    }
    if (latest.ok === null) {
        return false;
    }
    return now.getTime() - Date.parse(latest.finishedAt ?? latest.startedAt) >= HISTORY_SYNC_INTERVAL_MS;
}
