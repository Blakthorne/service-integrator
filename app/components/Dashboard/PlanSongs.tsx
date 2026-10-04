import Link from "next/link";
import {
    hymnNoteBadge,
    songNumbersView,
    type DashboardHref,
    type HymnNoteBadge,
    type SongNumbersView,
} from "@/lib/dashboard";
import type { HymnNoteState } from "@/lib/hymnNotes";
import type { DashboardSong } from "@/lib/queries/dashboard";

/** Each hymnal note state's badge colours: green in sync, amber otherwise. */
const BADGE_CLASSES: Readonly<Record<HymnNoteState, string>> = {
    "in-sync":
        "bg-green-50 text-green-800 ring-green-200 dark:bg-green-950 dark:text-green-200 dark:ring-green-900",
    differs:
        "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-900",
    missing:
        "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-900",
};

/** A song's hymnal-note badge: "Note in sync", "Note differs", "Note missing". */
function NoteBadge({ badge }: { badge: HymnNoteBadge }) {
    return (
        <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset ${
                BADGE_CLASSES[badge.state]
            }`}
        >
            {badge.label}
        </span>
    );
}

/**
 * Where a song row's numbers go: its numbers; "Not in the catalog" as a
 * link to the plan's Schedule tab, where it is linked; or why it has none.
 */
function SongNumbers({ view, scheduleHref }: { view: SongNumbersView; scheduleHref: DashboardHref }) {
    switch (view.kind) {
        case "numbers":
            return (
                <span className="font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                    {view.text}
                </span>
            );
        case "fix":
            return (
                // No prefetch: a plan page loads the plan from Planning Center.
                <Link
                    prefetch={false}
                    href={scheduleHref}
                    className="text-sm font-medium text-amber-700 underline underline-offset-2 hover:text-amber-900 dark:text-amber-300 dark:hover:text-amber-200"
                >
                    {view.text}
                    <span className="sr-only"> (link it on the Schedule tab)</span>
                </Link>
            );
        case "note":
            return <span className="text-sm text-gray-500 dark:text-gray-400">{view.text}</span>;
    }
}

interface PlanSongsProps {
    /** The plan's song items, in order. */
    songs: readonly DashboardSong[];
    /** The plan's Schedule tab, where a song not in the catalog is linked. */
    scheduleHref: DashboardHref;
}

/**
 * A next plan's song items, in order: each one's title, its numbers (or
 * why it has none) and its hymnal note's badge. On phones the numbers and
 * the badge go under the title; from `sm` they sit at its right.
 */
export default function PlanSongs({ songs, scheduleHref }: PlanSongsProps) {
    if (songs.length === 0) {
        return (
            <p className="px-4 sm:px-6 py-4 text-sm text-gray-600 dark:text-gray-300">
                No songs in this plan yet.
            </p>
        );
    }
    return (
        <ol aria-label="Songs" className="divide-y divide-gray-200 dark:divide-gray-700">
            {songs.map((song) => {
                const badge = hymnNoteBadge(song);
                return (
                    <li
                        key={song.itemId}
                        className="px-4 sm:px-6 py-3 flex flex-wrap items-baseline gap-x-4 gap-y-1"
                    >
                        <span className="basis-full sm:basis-0 sm:flex-1 min-w-0 text-gray-900 dark:text-gray-100">
                            {song.title}
                        </span>
                        <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                            <SongNumbers view={songNumbersView(song)} scheduleHref={scheduleHref} />
                            {badge && <NoteBadge badge={badge} />}
                        </span>
                    </li>
                );
            })}
        </ol>
    );
}
