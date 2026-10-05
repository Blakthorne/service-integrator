import "server-only";
import { databasePath, getDb } from "@/lib/db";
import { finishInterruptedRuns } from "@/lib/db/syncRuns";
import { startJobs } from "@/lib/jobs";

/**
 * Start-up work for a server process, run once by `register()` in
 * `instrumentation.ts`: open and migrate the database now, so a problem shows
 * in the log at once rather than on the first page that needs it; finish the
 * runs the last process left in progress, as interrupted; then schedule the
 * background jobs.
 *
 * Never throws. A failure is logged and the app keeps serving: plan pages do
 * not need the database, Settings shows the error, and the next `getDb()`
 * (from a page or a job) tries again.
 */
export function boot(): void {
    try {
        const db = getDb();
        console.log(`Database ready at ${databasePath()}`);
        const interrupted = finishInterruptedRuns(db);
        if (interrupted > 0) {
            console.warn(
                `Finished ${interrupted} background run(s) the last server left in progress, as interrupted`
            );
        }
    } catch (error) {
        console.error("Database unavailable:", error);
    }
    try {
        startJobs();
    } catch (error) {
        console.error("Could not start the background jobs:", error);
    }
}
