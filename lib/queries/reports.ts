import "server-only";
import { historyJob, runJob, type RunJobResult } from "@/lib/jobs";

/**
 * The reports of what the church sang, for the Reports page, and its "Sync
 * history now". They are built from the plan history (`syncPlanHistory`,
 * lib/queries/history.ts).
 */

export type { RunJobResult } from "@/lib/jobs";

/**
 * "Sync history now": run the plan history sync through `runJob`, so that a
 * run already in progress (the daily one) is joined rather than doubled,
 * and give that run as recorded, with `ok` false and the reason when the
 * sync failed; or `run: null` and why, when no run could be recorded at all
 * (the database could not be opened or written). Never an older run, and
 * never throws.
 */
export function syncPlanHistoryNow(): Promise<RunJobResult> {
    return runJob(historyJob);
}
