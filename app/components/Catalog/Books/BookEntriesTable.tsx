import Link from "next/link";
import EmptyState from "@/app/components/ui/EmptyState";
import type { BookDetail, BookEntry } from "@/lib/domain";
import { routes } from "@/lib/routes";
import { entryRowId } from "./bookText";

interface BookEntriesTableProps {
    /** The book with its entries, already in browse order. */
    book: BookDetail;
}

const HEADER_CELL =
    "px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider";

/**
 * What a row says beside the hymn: the entry's variant note ("Descant, last
 * chorus only") and its location ("inside back cover"). In a numbered book
 * the label of an entry with no number already says where it is
 * ("G-Front Cover"), so its location is not repeated.
 */
function notesOf(book: BookDetail, entry: BookEntry): string[] {
    const notes: string[] = [];
    if (entry.variantNote) {
        notes.push(entry.variantNote);
    }
    const location = entry.locationLabel?.trim();
    if (location && !(book.numbered && entry.number === null)) {
        notes.push(location);
    }
    return notes;
}

/** The first cell: a numbered book's label ("R-396"), or an unnumbered book's position in it. */
function placementOf(book: BookDetail, entry: BookEntry): string {
    if (book.numbered) {
        return entry.label;
    }
    return entry.position === null ? "—" : String(entry.position);
}

/**
 * Every entry of a book: its label (or position), the hymn, the tune and any
 * note. A row's hymn title is a real link to the song, stretched over the
 * row. On phones the tune and note move under the title instead of
 * scrolling the table sideways.
 */
export default function BookEntriesTable({ book }: BookEntriesTableProps) {
    if (book.entries.length === 0) {
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
                <caption className="sr-only">Entries of {book.name}</caption>
                <thead className="bg-gray-50 dark:bg-gray-700">
                    <tr>
                        <th scope="col" className={HEADER_CELL}>
                            {book.numbered ? "Number" : "Position"}
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
                    {book.entries.map((entry) => {
                        const notes = notesOf(book, entry);
                        return (
                            // `relative` makes the row the box the link's
                            // overlay fills; `transform-gpu` does the same in
                            // Safari, which ignored `relative` on table rows
                            // until 2026 (WebKit bug 240961). The id is where
                            // "Go to number" scrolls to, and `focus-within`
                            // is its highlight.
                            <tr
                                key={entry.id}
                                id={
                                    entry.number === null
                                        ? undefined
                                        : entryRowId(entry.number)
                                }
                                className="relative transform-gpu hover:bg-gray-50 focus-within:bg-blue-50 dark:hover:bg-gray-700 dark:focus-within:bg-blue-950 transition-colors cursor-pointer"
                            >
                                <td className="px-3 sm:px-6 py-3 text-sm font-medium text-gray-900 dark:text-gray-100 whitespace-nowrap tabular-nums align-top">
                                    {placementOf(book, entry)}
                                </td>
                                <td className="px-3 sm:px-6 py-3 text-sm align-top">
                                    {/* No prefetch: a book has hundreds of rows. */}
                                    <Link
                                        prefetch={false}
                                        href={routes.catalogSong(entry.songId)}
                                        className="font-medium text-gray-900 dark:text-gray-100 after:absolute after:inset-0"
                                    >
                                        {entry.title}
                                    </Link>
                                    <span className="block sm:hidden mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                                        {[entry.tuneName ?? "No tune", ...notes].join(
                                            " · "
                                        )}
                                    </span>
                                </td>
                                <td className="hidden sm:table-cell px-6 py-3 text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap align-top">
                                    {entry.tuneName ?? (
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
                                    {notes.join(" · ")}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
