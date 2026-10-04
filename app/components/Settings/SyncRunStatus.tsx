import LocalTime from "../ui/LocalTime";
import type { SyncRun } from "@/lib/db/syncRuns";

interface SyncRunStatusProps {
    /** The latest run, finished or not, or null before the first. */
    run: SyncRun | null;
}

/**
 * How a background job's latest run went, as Settings and Reconcile show
 * the song sync's: not run yet, running since a time, failed at a time and
 * why, or finished at a time with what it did. Times render in the viewer's
 * time zone (`LocalTime`). Inline content only: it renders inside a `<p>`
 * or a `<dd>`.
 */
export default function SyncRunStatus({ run }: SyncRunStatusProps) {
    if (run === null) {
        return <>Not run yet</>;
    }
    if (run.finishedAt === null) {
        return (
            <>
                Running, since <LocalTime iso={run.startedAt} />
            </>
        );
    }
    if (!run.ok) {
        return (
            <span className="text-red-600 dark:text-red-400">
                Failed <LocalTime iso={run.finishedAt} />
                {run.message && <>: {run.message}</>}
            </span>
        );
    }
    return (
        <>
            <LocalTime iso={run.finishedAt} />
            {run.message && (
                <span className="text-gray-500 dark:text-gray-400"> · {run.message}</span>
            )}
        </>
    );
}
