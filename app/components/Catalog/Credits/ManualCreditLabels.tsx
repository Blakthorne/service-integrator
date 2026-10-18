import Link from "next/link";
import { CREDIT_LABEL_MANUAL_WORDS, type ManualCreditLabelRow } from "@/lib/creditLabels";
import { routes } from "@/lib/routes";
import { LINK_CLASS } from "../CatalogCard";
import PcoSongWebLink from "../Reconcile/PcoSongWebLink";

interface ManualCreditLabelsProps {
    /** The songs left for a person, by title. */
    rows: ManualCreditLabelRow[];
}

/**
 * The songs whose authors the app cannot label without losing or guessing
 * something, each with its author, why, and where to fix it: the credit
 * editor on its catalog song's page, or, for a song not in the catalog,
 * Planning Center itself. Folded under their count, as there may be many.
 */
export default function ManualCreditLabels({ rows }: ManualCreditLabelsProps) {
    if (rows.length === 0) {
        return <p className="text-sm text-gray-500 dark:text-gray-400">No songs.</p>;
    }
    return (
        <details className="group rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-gray-900 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 dark:text-gray-100 dark:hover:bg-gray-700 [&::-webkit-details-marker]:hidden">
                <span className="group-open:hidden">Show the {rows.length} songs</span>
                <span className="hidden group-open:inline">Hide the songs</span>
            </summary>
            <ul className="divide-y divide-gray-100 border-t border-gray-100 dark:divide-gray-700 dark:border-gray-700">
                {rows.map((row) => (
                    <li key={row.pcoSongId} className="space-y-1 px-4 py-3 text-sm">
                        <p className="font-medium text-gray-900 dark:text-gray-100">{row.title}</p>
                        <p className="break-words text-gray-700 dark:text-gray-300">
                            {row.author === null || row.author.trim() === "" ? (
                                <span className="text-gray-500 dark:text-gray-400">No author</span>
                            ) : (
                                row.author
                            )}
                        </p>
                        <p className="text-gray-600 dark:text-gray-400">
                            {CREDIT_LABEL_MANUAL_WORDS[row.reason]}
                        </p>
                        {/* On a line of its own, so the link stands alone (convention 20). */}
                        <p>
                            {row.catalogSongId !== null ? (
                                // No prefetch: the list may run to hundreds of songs.
                                <Link
                                    href={routes.catalogSong(row.catalogSongId)}
                                    prefetch={false}
                                    className={LINK_CLASS}
                                >
                                    Edit its credits<span className="sr-only"> ({row.title})</span>
                                </Link>
                            ) : (
                                <PcoSongWebLink pcoSongId={row.pcoSongId}>
                                    Edit it in Planning Center<span className="sr-only"> ({row.title})</span>
                                </PcoSongWebLink>
                            )}
                        </p>
                    </li>
                ))}
            </ul>
        </details>
    );
}
