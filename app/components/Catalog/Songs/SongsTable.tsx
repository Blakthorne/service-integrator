import Link from "next/link";
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
 * Songs as table rows: the title, the tune (unless `showTune` is off) and
 * the entry labels with their variant notes. A row's title is a real link to
 * the song, stretched over the row; the tune is its own link above it. On
 * phones the tune moves under the title instead of taking a column.
 *
 * Links keep the default prefetch: song and tune pages read only the local
 * database, so prefetching the rows on screen costs no Planning Center
 * requests (the budget convention 13 protects).
 */
export default function SongsTable({
    rows,
    caption,
    showTune,
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
                </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {rows.length === 0 ? (
                    <tr>
                        <td
                            colSpan={showTune ? 3 : 2}
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
                                {showTune && (
                                    <span className="block sm:hidden mt-0.5 text-xs">
                                        <TuneName song={song} />
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
                        </tr>
                    ))
                )}
            </tbody>
        </table>
    );
}
