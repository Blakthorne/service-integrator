import Link from "next/link";
import type { WriteLogEntry } from "@/lib/db/writeLog";
import { parsePcoId } from "@/lib/pco";
import { RECENT_WRITES_LIMIT, type RecentWrites } from "@/lib/queries/settings";
import { routes } from "@/lib/routes";
import {
    describeFailureLine,
    describeWrite,
    type WriteDescription,
    type WriteOutcome,
} from "@/lib/writeLogText";
import LocalTime from "../ui/LocalTime";
import SettingsCard from "./SettingsCard";

interface RecentWritesCardProps {
    recent: RecentWrites;
}

/** Whether a write was made: "ok" in green, or "Failed" in red, in words as well as colour. */
function Outcome({ outcome }: { outcome: WriteOutcome }) {
    return outcome.ok ? (
        <span className="inline-flex items-center gap-2 text-sm font-medium text-green-700 dark:text-green-400">
            <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full bg-green-500" />
            ok
        </span>
    ) : (
        <span className="inline-flex items-center gap-2 text-sm font-medium text-red-600 dark:text-red-400">
            <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full bg-red-500" />
            Failed
        </span>
    );
}

/**
 * Where a write was made: a link to the plan when the log's ids are ones
 * `parsePcoId` accepts (they come from the database, but every id is checked
 * before it reaches a route builder, convention 19), else the log's own
 * words for it. Plan pages are data-heavy, so these links do not prefetch
 * (convention 13). The link sits in a line of text, where blue against the
 * grey around it is under the 3:1 a link needs (1.4:1 in light mode, 1.0:1
 * in dark) to be told apart by colour alone, so it is underlined.
 */
function Place({ place, target }: Pick<WriteDescription, "place" | "target">) {
    if (place === null) {
        return <>{target}</>;
    }
    const serviceTypeId = parsePcoId(place.serviceTypeId);
    const planId = parsePcoId(place.planId);
    return (
        <>
            {serviceTypeId !== null && planId !== null ? (
                <Link
                    href={routes.plan(serviceTypeId, planId)}
                    prefetch={false}
                    className="text-blue-600 underline underline-offset-2 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                >
                    Plan {planId}
                </Link>
            ) : (
                <>Plan {place.planId}</>
            )}
            , item {place.itemId}
        </>
    );
}

/** One row of the log: when, what, where and how it went. */
function WriteRow({ entry }: { entry: WriteLogEntry }) {
    const { what, detail, place, target, outcome } = describeWrite(entry);
    return (
        <li className="py-3 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className="text-sm text-gray-600 dark:text-gray-400">
                    <LocalTime iso={entry.at} />
                </span>
                <Outcome outcome={outcome} />
            </div>
            <p className="mt-1 font-medium text-gray-900 dark:text-gray-100 break-words">{what}</p>
            {detail && (
                <p className="text-sm text-gray-700 dark:text-gray-300 break-words">{detail}</p>
            )}
            <p className="text-sm text-gray-600 dark:text-gray-400 break-words">
                <Place place={place} target={target} />
            </p>
            {!outcome.ok && (
                <p className="mt-1 text-sm text-red-700 dark:text-red-300 break-words">
                    {describeFailureLine(outcome)}
                </p>
            )}
        </li>
    );
}

/**
 * The "Recent writes" card of the Settings page: the latest rows of the
 * write log, newest first, each with when (in the viewer's time zone), what
 * was done and to which plan and item, and whether Planning Center made the
 * change or why it did not. The log holds the emails the app sent too (to
 * whom and with what subject, never the text), so a plan's email can be
 * checked here. It reads only the local database; when the log cannot be
 * read it says so.
 */
export default function RecentWritesCard({ recent }: RecentWritesCardProps) {
    return (
        <SettingsCard
            title="Recent writes"
            headingId="recent-writes-heading"
            description={`The last ${RECENT_WRITES_LIMIT} changes this app made in Planning Center and emails it sent, newest first.`}
        >
            {!recent.ok ? (
                <p className="text-sm text-gray-700 dark:text-gray-300 break-words">
                    The write log cannot be read: {recent.error}
                </p>
            ) : recent.writes.length === 0 ? (
                <p className="text-sm text-gray-700 dark:text-gray-300">
                    The app has not written to Planning Center or sent an email yet.
                </p>
            ) : (
                <ol role="list" className="divide-y divide-gray-200 dark:divide-gray-700">
                    {recent.writes.map((entry) => (
                        <WriteRow key={entry.id} entry={entry} />
                    ))}
                </ol>
            )}
        </SettingsCard>
    );
}
