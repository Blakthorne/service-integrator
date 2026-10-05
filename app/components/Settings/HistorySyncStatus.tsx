import type { HistoryCounts } from "@/lib/db/history";
import type { SyncRun } from "@/lib/db/syncRuns";
import { describeHistory } from "@/lib/reportsView";
import SyncNowButton from "./SyncNowButton";
import SyncRunStatus from "./SyncRunStatus";

interface HistorySyncStatusProps {
    /** The latest run of the history sync, finished or not, or null before the first. */
    lastRun: SyncRun | null;
    /** What the history holds. */
    counts: HistoryCounts;
}

const LABEL_CLASS = "text-sm font-medium text-gray-500 dark:text-gray-400";
const VALUE_CLASS = "mt-1 text-gray-900 dark:text-gray-100";

/**
 * The plan history sync's status, shared by Settings and Reports: when it
 * last ran and how it went, what the history holds, and "Sync history now".
 */
export default function HistorySyncStatus({ lastRun, counts }: HistorySyncStatusProps) {
    return (
        <>
            <dl className="mb-4 space-y-3">
                <div>
                    <dt className={LABEL_CLASS}>Last history sync</dt>
                    <dd className={VALUE_CLASS}>
                        <SyncRunStatus run={lastRun} />
                    </dd>
                </div>
                <div>
                    <dt className={LABEL_CLASS}>In the history</dt>
                    <dd className={VALUE_CLASS}>{describeHistory(counts)}</dd>
                </div>
            </dl>
            <SyncNowButton kind="history" />
        </>
    );
}
