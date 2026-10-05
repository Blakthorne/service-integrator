import Link from "next/link";
import { formatPlanDateHeading } from "@/lib/format";
import type { SongHistory } from "@/lib/reports";
import {
    HISTORY_NOT_READ_TEXT,
    NOT_IN_HISTORY_TEXT,
    foldHistoryRows,
    historyRows,
    type HistoryRow,
} from "@/lib/songHistoryText";
import { routes } from "@/lib/routes";
import CatalogCard, { CardField, LINK_CLASS, NoValue } from "../CatalogCard";

/** The mark of a plan that is dated today or later, in the colours of the songs list's "PCO" badge. */
function UpcomingMark() {
    return (
        <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900/40 dark:text-blue-200">
            Upcoming
        </span>
    );
}

/** One occurrence: the plan's date and service type, a link to the plan, and a mark when it is upcoming. */
function HistoryItem({ row }: { row: HistoryRow }) {
    return (
        <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2">
            {/* No prefetch (convention 13): a plan's page reads the plan from Planning Center. */}
            <Link
                prefetch={false}
                href={routes.plan(row.serviceTypeId, row.planId)}
                className={LINK_CLASS}
            >
                {row.date} · {row.serviceTypeName}
            </Link>
            {row.upcoming && <UpcomingMark />}
        </li>
    );
}

const LIST_CLASS = "divide-y divide-gray-200 dark:divide-gray-700";

interface HistoryCardProps {
    /** The song's plans, newest first, with how many it was sung in (`getSongHistory`). */
    history: SongHistory;
    /**
     * Whether the plan history holds any plan: false before its first sync,
     * when an empty history means nothing is known, not that the song was
     * never sung.
     */
    historyRead: boolean;
    /** Each service type's name by id; none when Planning Center did not answer, and the ids stand in. */
    serviceTypeNames: Readonly<Record<string, string>>;
}

/**
 * A song's History card: how many plans it was sung in, when it was last
 * sung and when it is next scheduled, then every plan it is in, newest
 * first, each a link to the plan with its date and service type, and a mark
 * on those that are upcoming. "Sung" means in a plan dated before today
 * (`lib/reports.ts`). The first ten are listed and the earlier ones folded
 * under "Show earlier" (a `<details>`, so it needs no script). Before the
 * history's first sync it says it cannot tell. A server component.
 */
export default function HistoryCard({ history, historyRead, serviceTypeNames }: HistoryCardProps) {
    const { times, lastSungOn, nextScheduledOn, entries } = history;
    const { shown, folded } = foldHistoryRows(historyRows(entries, serviceTypeNames));

    return (
        <CatalogCard title="History" headingId="history-heading">
            {!historyRead ? (
                <p className="text-gray-600 dark:text-gray-300">
                    {HISTORY_NOT_READ_TEXT}{" "}
                    {/* Underlined: in running text, its colour alone is under 3:1 against the text's. */}
                    <Link
                        href={routes.reports()}
                        className="text-blue-600 underline hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                    >
                        Sync it on Reports
                    </Link>
                    .
                </p>
            ) : (
                <>
                    <dl className="grid gap-4 sm:grid-cols-3">
                        <CardField label="Times sung">{times}</CardField>
                        <CardField label="Last sung">
                            {lastSungOn === null ? (
                                <NoValue>Never</NoValue>
                            ) : (
                                formatPlanDateHeading(lastSungOn)
                            )}
                        </CardField>
                        <CardField label="Next scheduled">
                            {nextScheduledOn === null ? (
                                <NoValue>Not scheduled</NoValue>
                            ) : (
                                formatPlanDateHeading(nextScheduledOn)
                            )}
                        </CardField>
                    </dl>
                    {entries.length === 0 ? (
                        <p className="mt-4 text-gray-600 dark:text-gray-300">{NOT_IN_HISTORY_TEXT}</p>
                    ) : (
                        <div className="mt-4">
                            <ul aria-label="Plans with this song" className={LIST_CLASS}>
                                {shown.map((row) => (
                                    <HistoryItem key={row.key} row={row} />
                                ))}
                            </ul>
                            {folded.length > 0 && (
                                <details className="group">
                                    <summary className="cursor-pointer rounded-sm py-2 text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:text-blue-400 dark:hover:text-blue-300 dark:focus-visible:outline-blue-400">
                                        <span className="group-open:hidden">
                                            Show {folded.length} earlier
                                        </span>
                                        <span className="hidden group-open:inline">
                                            Hide the {folded.length} earlier
                                        </span>
                                    </summary>
                                    <ul
                                        aria-label="Earlier plans with this song"
                                        className={`border-t border-gray-200 dark:border-gray-700 ${LIST_CLASS}`}
                                    >
                                        {folded.map((row) => (
                                            <HistoryItem key={row.key} row={row} />
                                        ))}
                                    </ul>
                                </details>
                            )}
                        </div>
                    )}
                </>
            )}
        </CatalogCard>
    );
}
