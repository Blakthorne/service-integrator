import Link from "next/link";
import {
    HISTORY_STATS_TEXT,
    historyStats,
    type CoverageRowView,
    type ShareView,
} from "@/lib/dashboard";
import type { DashboardHistory } from "@/lib/queries/dashboard";
import { routes } from "@/lib/routes";
import SyncRunStatus from "../Settings/SyncRunStatus";
import { CARD_CLASS, LINK_CLASS, SECTION_HEADING_CLASS } from "./styles";

const LABEL_CLASS = "text-sm font-medium text-gray-500 dark:text-gray-400";
const HEADER_CELL =
    "px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider";

/**
 * A share of a book's entries: its percent and its counts, with a bar that
 * shows it. The bar is decoration (hidden from screen readers): the words
 * say all it does.
 */
function Share({ share }: { share: ShareView }) {
    return (
        <>
            <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                <span className="text-sm font-medium tabular-nums text-gray-900 dark:text-gray-100">
                    {share.percent === null ? "—" : `${share.percent}%`}
                </span>
                <span className="text-xs tabular-nums text-gray-600 dark:text-gray-400">{share.text}</span>
            </div>
            <div
                aria-hidden="true"
                className="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700"
            >
                <div
                    className="h-full rounded-full bg-blue-600 dark:bg-blue-400"
                    style={{ width: `${share.percent ?? 0}%` }}
                />
            </div>
        </>
    );
}

/** An active book's row: its name and how many entries it has, then its two shares. */
function CoverageRow({ row }: { row: CoverageRowView }) {
    return (
        <tr>
            <th
                scope="row"
                title={row.name}
                className="px-3 sm:px-6 py-3 text-left align-top text-sm font-medium text-gray-900 dark:text-gray-100"
            >
                {row.label}
                <span className="block text-xs font-normal text-gray-600 dark:text-gray-400">{row.entries}</span>
            </th>
            <td className="px-3 sm:px-6 py-3 align-top">
                <Share share={row.recently} />
            </td>
            <td className="px-3 sm:px-6 py-3 align-top">
                <Share share={row.ever} />
            </td>
        </tr>
    );
}

interface HistoryStatsProps {
    history: DashboardHistory;
}

/**
 * The dashboard's song history card: how many different songs were sung this
 * year, how much of each active book's entries were sung in the last five
 * years and ever (the share of its entries whose song is linked to Planning
 * Center and was in a past plan), and when the history was last synced, with
 * how it went. Before the first sync, and when no song in it was sung, it
 * says so in place of figures, never "0%" of everything. A link leads to the
 * reports.
 */
export default function HistoryStats({ history }: HistoryStatsProps) {
    const stats = historyStats(history);
    return (
        <section aria-labelledby="history-stats-heading">
            <h2 id="history-stats-heading" className={SECTION_HEADING_CLASS}>
                Song history
            </h2>
            <div className={CARD_CLASS}>
                <dl className="grid gap-4 px-4 sm:px-6 py-4 sm:grid-cols-2">
                    {stats.kind === "figures" && (
                        <div>
                            <dt className={LABEL_CLASS}>Songs sung in {stats.year}</dt>
                            <dd className="mt-1 text-2xl font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                                {stats.songsSungThisYear}
                            </dd>
                        </div>
                    )}
                    <div>
                        <dt className={LABEL_CLASS}>History last synced</dt>
                        <dd className="mt-1 text-gray-900 dark:text-gray-100">
                            <SyncRunStatus run={history.lastSync} />
                        </dd>
                    </div>
                </dl>
                {stats.kind === "figures" ? (
                    stats.coverage.length > 0 && (
                        <div className="border-t border-gray-200 dark:border-gray-700">
                            <table className="w-full">
                                <caption className="sr-only">
                                    The share of each book&apos;s entries that were sung
                                </caption>
                                <thead className="bg-gray-50 dark:bg-gray-700">
                                    <tr>
                                        <th scope="col" className={HEADER_CELL}>
                                            Book
                                        </th>
                                        <th scope="col" className={HEADER_CELL}>
                                            {stats.recentlyLabel}
                                        </th>
                                        <th scope="col" className={HEADER_CELL}>
                                            Ever
                                        </th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                                    {stats.coverage.map((row) => (
                                        <CoverageRow key={row.bookId} row={row} />
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )
                ) : (
                    <p className="px-4 sm:px-6 pb-4 text-sm text-gray-600 dark:text-gray-300">
                        {HISTORY_STATS_TEXT[stats.kind]}
                    </p>
                )}
                <div className="px-4 sm:px-6 py-3 border-t border-gray-200 dark:border-gray-700">
                    <Link
                        href={routes.reports()}
                        className={`text-sm font-medium ${LINK_CLASS}`}
                    >
                        {stats.kind === "unread" ? "Sync it on Reports" : "Reports"}
                        <span aria-hidden="true"> →</span>
                    </Link>
                </div>
            </div>
        </section>
    );
}
