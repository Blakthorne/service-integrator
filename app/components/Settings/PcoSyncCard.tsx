import Link from "next/link";
import type { PcoSongsSyncStatus } from "@/lib/queries/system";
import { routes } from "@/lib/routes";
import SyncNowButton from "./SyncNowButton";
import SyncRunStatus from "./SyncRunStatus";

interface PcoSyncCardProps {
    status: PcoSongsSyncStatus;
}

/**
 * The Planning Center sync card of the Settings page: when the song sync
 * last ran and how it went, and Sync now. When the database cannot be read,
 * it says so and leaves the reason to the Database card above it.
 */
export default function PcoSyncCard({ status }: PcoSyncCardProps) {
    return (
        <section
            aria-labelledby="pco-sync-heading"
            className="max-w-3xl mx-auto bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6"
        >
            <h2
                id="pco-sync-heading"
                className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2"
            >
                Planning Center sync
            </h2>
            <p className="mb-4 text-sm text-gray-600 dark:text-gray-300">
                The app keeps a copy of the Planning Center song library, read every hour and
                a minute after the server starts. Each sync links the songs whose titles
                match one catalog song;{" "}
                <Link
                    href={routes.catalogReconcile()}
                    className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:underline"
                >
                    Reconcile
                </Link>{" "}
                lists the rest.
            </p>
            {status.ok ? (
                <>
                    <dl className="mb-4">
                        <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                            Last song sync
                        </dt>
                        <dd className="mt-1 text-gray-900 dark:text-gray-100">
                            <SyncRunStatus run={status.lastRun} />
                        </dd>
                    </dl>
                    <SyncNowButton />
                </>
            ) : (
                <p className="text-sm text-gray-700 dark:text-gray-300">
                    Unavailable: the database cannot be read.
                </p>
            )}
        </section>
    );
}
