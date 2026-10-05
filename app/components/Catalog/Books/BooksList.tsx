"use client";

import Link from "next/link";
import { moveBookAction } from "@/app/(app)/catalog/books/actions";
import EmptyState from "@/app/components/ui/EmptyState";
import { formatEntryCount } from "@/lib/catalog/bookText";
import type { MoveDirection } from "@/lib/catalog/validation";
import type { BookSummary } from "@/lib/domain";
import { routes } from "@/lib/routes";
import MoveButtons from "./MoveButtons";
import ReorderNotices from "./ReorderNotices";
import { TEXT_LINK_CLASS } from "./styles";
import { useReorder } from "./useReorder";

interface BooksListProps {
    /** Every book, in book order. */
    books: BookSummary[];
}

/** The DOM id of the button that moves book `id` in `direction`. */
function moveButtonId(id: number, direction: MoveDirection): string {
    return `move-book-${id}-${direction}`;
}

/**
 * The catalog's books in the order they are listed in, which is also the
 * order a song's labels come in: each with its code, name, whether it is
 * numbered and in use, how many entries it has, and Move up and Move down.
 * A row's name is a real link stretched over the row, so it works from the
 * keyboard and with cmd-click; the buttons sit above it.
 *
 * It is a client component for the buttons (`useReorder`): a move calls
 * `moveBookAction` from the click, the page is revalidated, and the rows
 * come back in their new order.
 */
export default function BooksList({ books }: BooksListProps) {
    const reorder = useReorder({
        noun: "book",
        idField: "bookId",
        move: moveBookAction,
        rows: books,
        buttonId: moveButtonId,
    });

    if (books.length === 0) {
        return (
            <EmptyState
                title="No books yet"
                description="A book is a hymnal or songbook the catalog places songs in."
                action={
                    <Link href={routes.catalogBookAdd()} className={TEXT_LINK_CLASS}>
                        Add the first book
                    </Link>
                }
            />
        );
    }

    return (
        <div>
            <ul className="bg-white dark:bg-gray-800 rounded-lg shadow-sm overflow-hidden divide-y divide-gray-200 dark:divide-gray-700">
                {books.map((book, index) => (
                    <li
                        key={book.id}
                        className="relative flex items-center gap-3 sm:gap-4 px-4 sm:px-6 py-4 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors cursor-pointer"
                    >
                        <span className="inline-flex h-10 min-w-10 shrink-0 items-center justify-center rounded-md bg-gray-100 px-2 text-sm font-semibold text-gray-700 dark:bg-gray-700 dark:text-gray-200">
                            {book.code}
                        </span>
                        <div className="min-w-0 flex-1">
                            {/* No prefetch: a book's page lists every one of its entries. */}
                            <Link
                                prefetch={false}
                                href={routes.catalogBook(book.code)}
                                className="font-medium text-gray-900 dark:text-gray-100 after:absolute after:inset-0"
                            >
                                {book.name}
                            </Link>
                            <p className="text-sm text-gray-500 dark:text-gray-400">
                                {book.numbered ? "Numbered" : "Not numbered"} ·{" "}
                                {formatEntryCount(book.entryCount)}
                                {!book.active && " · Not in use"}
                            </p>
                        </div>
                        <MoveButtons
                            name={book.name}
                            upId={moveButtonId(book.id, "up")}
                            downId={moveButtonId(book.id, "down")}
                            first={index === 0}
                            last={index === books.length - 1}
                            pending={reorder.pending}
                            onMove={(direction) => reorder.moveItem(book.id, book.name, direction)}
                        />
                    </li>
                ))}
            </ul>
            <ReorderNotices reorder={reorder} />
        </div>
    );
}
