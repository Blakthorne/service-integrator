import "server-only";
import { databasePath, getDb } from "@/lib/db";
import { startJobs } from "@/lib/jobs";

/**
 * Start-up work for a server process, run once by `register()` in
 * `instrumentation.ts`: open and migrate the database now, so a problem shows
 * in the log at once rather than on the first page that needs it, then
 * schedule the background jobs.
 *
 * Never throws. A failure is logged and the app keeps serving: plan pages do
 * not need the database, Settings shows the error, and the next `getDb()`
 * (from a page or a job) tries again.
 */
export function boot(): void {
    try {
        getDb();
        console.log(`Database ready at ${databasePath()}`);
    } catch (error) {
        console.error("Database unavailable:", error);
    }
    try {
        startJobs();
    } catch (error) {
        console.error("Could not start the background jobs:", error);
    }
}
