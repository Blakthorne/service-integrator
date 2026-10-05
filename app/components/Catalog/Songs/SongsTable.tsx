import Link from "next/link";
import { SONG_MARK_LABELS } from "@/lib/catalog/marks";
import { songUseLines } from "@/lib/catalog/songUse";
import type { CatalogSongSummary } from "@/lib/domain";
import { routes } from "@/lib/routes";
import EntryLabels from "../EntryLabels";

const HEADER_CELL =
    "px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider";

interface SongsTableProps {
    rows: readonly CatalogSongSummary[];
    /** Names the table for screen readers, such as "Songs". */
    caption: string;
    /** Whether to show each song's tune: the songs list does, a tune's page does not. */
    showTune: boolean;
    /**
     * Whether to show each song's Planning Center link and when it was last
     * scheduled: the songs list does. Off by default.
     */
    showLink?: boolean;
    /**
     * Whether the plan history has been read, so that a linked song's row can
     * say when it was last sung (or that it never was). Off by default and
     * before the history's first sync, when the rows say only when the song
     * was last scheduled.
     */
    historyRead?: boolean;
    /** What the table says when there are no rows. */
    emptyMessage: string;
}

/** A song's tune: a link to the tune's page, or a dash when it is unknown. */
function TuneName({ song }: { song: CatalogSongSummary }) {
    if (song.tuneId === null) {
        return (
            <>
                <span aria-hidden="true" className="text-gray-400 dark:text-gray-500">
                    —
                </span>
                <span className="sr-only">No tune</span>
            </>
        );
    }
    // `relative z-10` lifts it above the title link stretched over the row.
    return (
        <Link
            href={routes.catalogTune(song.tuneId)}
            className="relative z-10 text-blue-600 hover:text-blue-800 hover:underline dark:text-blue-400 dark:hover:text-blue-300"
        >
            {song.tuneName}
        </Link>
    );
}

/**
 * A song's link to Planning Center: a "PCO" badge, with "auto" beside it when
 * the sync made the link, and under it when the song was last sung (once the
 * history is read) and last scheduled, or that it never was (`songUseLines`).
 * A song that is not linked shows a dash.
 */
function PcoLink({ song, historyRead }: { song: CatalogSongSummary; historyRead: boolean }) {
    if (song.pcoSongId === null) {
        return (
            <>
                <span aria-hidden="true" className="text-gray-400 dark:text-gray-500">
                    —
                </span>
                <span className="sr-only">Not linked to Planning Center</span>
            </>
        );
    }
    return (
        <>
            <span className="inline-flex items-center gap-1.5">
                <span
                    title="Linked to a Planning Center song"
                    className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900/40 dark:text-blue-200"
                >
                    PCO
                </span>
                {song.linkedBy === "auto" && (
                    <span
                        title="Linked automatically, by a sync"
                        className="text-xs text-gray-500 dark:text-gray-400"
                    >
                        auto
                    </span>
                )}
            </span>
            {songUseLines(song, historyRead).map((line) => (
                <span key={line} className="block mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                    {line}
                </span>
            ))}
        </>
    );
}

/**
 * Songs as table rows: the title with a badge for each of the song's marks
 * ("To learn"), the tune (unless `showTune` is off), the entry labels with
 * their variant notes and, with `showLink`, the Planning Center link. A row's title is a real link to the song, stretched over the
 * row; the tune is its own link above it. On phones the tune and the link
 * move under the title instead of taking columns.
 *
 * Links keep the default prefetch: song and tune pages read the local
 * database, and a song's page asks Planning Center for nothing but the
 * service types' names (one request, cached for five minutes), so prefetching
 * the rows on screen costs at most that one (the budget convention 13
 * protects).
 */
export default function SongsTable({
    rows,
    caption,
    showTune,
    showLink = false,
    historyRead = false,
    emptyMessage,
}: SongsTableProps) {
    return (
        <table className="w-full">
            <caption className="sr-only">{caption}</caption>
            <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                    <th scope="col" className={HEADER_CELL}>
                        Title
                    </th>
                    {showTune && (
                        <th scope="col" className={`${HEADER_CELL} hidden sm:table-cell`}>
                            Tune
                        </th>
                    )}
                    <th scope="col" className={HEADER_CELL}>
                        Numbers
                    </th>
                    {showLink && (
                        <th scope="col" className={`${HEADER_CELL} hidden sm:table-cell`}>
                            Planning Center
                        </th>
                    )}
                </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {rows.length === 0 ? (
                    <tr>
                        <td
                            colSpan={2 + (showTune ? 1 : 0) + (showLink ? 1 : 0)}
                            className="px-6 py-12 text-center text-sm text-gray-500 dark:text-gray-400"
                        >
                            {emptyMessage}
                        </td>
                    </tr>
                ) : (
                    rows.map((song) => (
                        // `relative` makes the row the box the link's overlay
                        // fills; `transform-gpu` does the same in Safari, which
                        // ignored `relative` on table rows until 2026 (WebKit
                        // bug 240961).
                        <tr
                            key={song.id}
                            className="relative transform-gpu hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors cursor-pointer"
                        >
                            <td className="px-3 sm:px-6 py-3 text-sm align-top">
                                <Link
                                    href={routes.catalogSong(song.id)}
                                    className="font-medium text-gray-900 dark:text-gray-100 after:absolute after:inset-0"
                                >
                                    {song.title}
                                </Link>
                                {song.marks.map((mark) => (
                                    <span
                                        key={mark}
                                        className="ml-2 inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
                                    >
                                        {SONG_MARK_LABELS[mark]}
                                    </span>
                                ))}
                                {showTune && (
                                    <span className="block sm:hidden mt-0.5 text-xs">
                                        <TuneName song={song} />
                                    </span>
                                )}
                                {showLink && (
                                    <span className="block sm:hidden mt-1">
                                        <PcoLink song={song} historyRead={historyRead} />
                                    </span>
                                )}
                            </td>
                            {showTune && (
                                <td className="hidden sm:table-cell px-6 py-3 text-sm align-top">
                                    <TuneName song={song} />
                                </td>
                            )}
                            <td className="px-3 sm:px-6 py-3 text-sm text-gray-700 dark:text-gray-300 align-top">
                                <EntryLabels entries={song.entries} />
                            </td>
                            {showLink && (
                                <td className="hidden sm:table-cell px-6 py-3 text-sm align-top">
                                    <PcoLink song={song} historyRead={historyRead} />
                                </td>
                            )}
                        </tr>
                    ))
                )}
            </tbody>
        </table>
    );
}
