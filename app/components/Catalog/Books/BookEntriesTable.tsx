"use client";

import Link from "next/link";
import EmptyState from "@/app/components/ui/EmptyState";
import { entryRowId } from "@/lib/catalog/bookText";
import type { BookRow } from "@/lib/catalog/bookRows";
import { routes } from "@/lib/routes";

interface BookEntriesTableProps {
    /** The book's rows, in browse order (`toBookRows`). */
    rows: readonly BookRow[];
    /** Whether the book has numbers, which names the first column. */
    numbered: boolean;
    bookName: string;
}

const HEADER_CELL =
    "px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider";

/**
 * Every entry of a book: its label (or position), the hymn, the tune and any
 * note. A row's hymn title is a real link to the song, stretched over the
 * row. On phones the tune and note move under the title instead of
 * scrolling the table sideways.
 *
 * It is a client component so that the page hands it the rows as one prop.
 * Rendered on the server, its hundreds of rows would each stream as chunks
 * of their own, which `next start` compresses one by one (see `BookRow`).
 */
export default function BookEntriesTable({
    rows,
    numbered,
    bookName,
}: BookEntriesTableProps) {
    if (rows.length === 0) {
        return (
            <EmptyState
                title="No entries yet"
                description="No hymn has been placed in this book."
            />
        );
    }

    return (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm overflow-hidden">
            <table className="w-full">
                <caption className="sr-only">Entries of {bookName}</caption>
                <thead className="bg-gray-50 dark:bg-gray-700">
                    <tr>
                        <th scope="col" className={HEADER_CELL}>
                            {numbered ? "Number" : "Position"}
                        </th>
                        <th scope="col" className={HEADER_CELL}>
                            Hymn
                        </th>
                        <th
                            scope="col"
                            className={`${HEADER_CELL} hidden sm:table-cell`}
                        >
                            Tune
                        </th>
                        <th
                            scope="col"
                            className={`${HEADER_CELL} hidden sm:table-cell`}
                        >
                            Note
                        </th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {rows.map((row, index) => (
                        // `relative` makes the row the box the link's
                        // overlay fills; `transform-gpu` does the same in
                        // Safari, which ignored `relative` on table rows
                        // until 2026 (WebKit bug 240961). The id is where
                        // "Go to number" scrolls to, and `focus-within` is
                        // its highlight. The rows never reorder, so their
                        // position is their key.
                        <tr
                            key={index}
                            id={row.number === null ? undefined : entryRowId(row.number)}
                            className="relative transform-gpu hover:bg-gray-50 focus-within:bg-blue-50 dark:hover:bg-gray-700 dark:focus-within:bg-blue-950 transition-colors cursor-pointer"
                        >
                            <td className="px-3 sm:px-6 py-3 text-sm font-medium text-gray-900 dark:text-gray-100 whitespace-nowrap tabular-nums align-top">
                                {row.placement}
                            </td>
                            <td className="px-3 sm:px-6 py-3 text-sm align-top">
                                {/* No prefetch: a book has hundreds of rows. */}
                                <Link
                                    prefetch={false}
                                    href={routes.catalogSong(row.songId)}
                                    className="font-medium text-gray-900 dark:text-gray-100 after:absolute after:inset-0"
                                >
                                    {row.title}
                                </Link>
                                <span className="block sm:hidden mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                                    {[row.tune ?? "No tune", row.note]
                                        .filter(Boolean)
                                        .join(" · ")}
                                </span>
                            </td>
                            <td className="hidden sm:table-cell px-6 py-3 text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap align-top">
                                {row.tune ?? (
                                    <>
                                        <span
                                            aria-hidden="true"
                                            className="text-gray-400 dark:text-gray-500"
                                        >
                                            —
                                        </span>
                                        <span className="sr-only">No tune</span>
                                    </>
                                )}
                            </td>
                            <td className="hidden sm:table-cell px-6 py-3 text-sm text-gray-600 dark:text-gray-400 align-top">
                                {row.note}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
