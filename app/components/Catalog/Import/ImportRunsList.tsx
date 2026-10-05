import Link from "next/link";
import LocalTime from "@/app/components/ui/LocalTime";
import type { ImportRunSummary } from "@/lib/domain";
import { routes } from "@/lib/routes";
import ImportStatusBadge from "./ImportStatusBadge";
import { countOf } from "@/lib/catalog/counts";
import { importRunLabel, PLANNED_VERBS } from "@/lib/catalog/importText";

interface ImportRunsListProps {
    /** Every run, newest first. */
    runs: ImportRunSummary[];
}

/**
 * The import runs, a book's CSV file's or the seed's: each with its status,
 * what it read, when it was previewed and what it adds. A row's name is a real link stretched over the
 * row, so it works from the keyboard and with cmd-click.
 */
export default function ImportRunsList({ runs }: ImportRunsListProps) {
    if (runs.length === 0) {
        // Not `EmptyState`, whose heading is an h2: this one sits under the
        // page's "Import runs" h2, so it is an h3.
        return (
            <div className="text-center py-12">
                <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">
                    No import runs yet
                </h3>
                <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                    Preview a CSV file to create the first one.
                </p>
            </div>
        );
    }

    return (
        <ul className="bg-white dark:bg-gray-800 rounded-lg shadow-sm overflow-hidden divide-y divide-gray-200 dark:divide-gray-700">
            {runs.map((run) => (
                <li
                    key={run.id}
                    className="relative px-4 sm:px-6 py-4 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors cursor-pointer"
                >
                    <div className="flex items-start justify-between gap-3">
                        {/* No prefetch: a run's page loads its whole report. */}
                        <Link
                            prefetch={false}
                            href={routes.catalogImportRun(run.id)}
                            className="font-medium text-gray-900 dark:text-gray-100 after:absolute after:inset-0"
                        >
                            {importRunLabel(run)}
                        </Link>
                        <ImportStatusBadge status={run.status} />
                    </div>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                        {run.sourceName} · <LocalTime iso={run.at} />
                    </p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                        {PLANNED_VERBS[run.status]}{" "}
                        {countOf(run.planned.songs, "song")} and{" "}
                        {countOf(run.planned.entries, "entry", "entries")}
                    </p>
                </li>
            ))}
        </ul>
    );
}
