import Link from "next/link";
import type { HistorySyncStatus } from "@/lib/queries/system";
import { routes } from "@/lib/routes";
import HistorySyncDetails from "./HistorySyncDetails";

interface HistorySyncCardProps {
    status: HistorySyncStatus;
}

/**
 * The plan history sync card of the Settings page, beside the song sync's:
 * when the history last synced and how it went, what the history holds, and
 * Sync history now. When the database cannot be read, it says so and leaves
 * the reason to the Database card below it.
 */
export default function HistorySyncCard({ status }: HistorySyncCardProps) {
    return (
        <section
            aria-labelledby="history-sync-heading"
            className="max-w-3xl mx-auto bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6"
        >
            <h2
                id="history-sync-heading"
                className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2"
            >
                Plan history sync
            </h2>
            <p className="mb-4 text-sm text-gray-600 dark:text-gray-300">
                The app keeps a copy of which songs each plan held, read from Planning Center once
                a day. It feeds the{" "}
                <Link
                    href={routes.reports()}
                    // In a line of text, blue against the grey around it is under the 3:1
                    // a link needs to be told apart by colour alone, so it is underlined.
                    className="text-blue-600 underline underline-offset-2 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                >
                    reports
                </Link>
                , each song&apos;s history, the dashboard&apos;s figures and the repeat warnings. The
                first sync reads every plan and takes a minute or two; later ones read only the
                plans that may have changed.
            </p>
            {status.ok ? (
                <HistorySyncDetails lastRun={status.lastRun} counts={status.counts} />
            ) : (
                <p className="text-sm text-gray-700 dark:text-gray-300">
                    Unavailable: the database cannot be read.
                </p>
            )}
        </section>
    );
}
