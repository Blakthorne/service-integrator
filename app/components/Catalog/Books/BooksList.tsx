import Link from "next/link";
import EmptyState from "@/app/components/ui/EmptyState";
import type { BookSummary } from "@/lib/domain";
import { routes } from "@/lib/routes";
import { formatEntryCount } from "./bookText";

interface BooksListProps {
    /** Every book, in book order. */
    books: BookSummary[];
}

/**
 * The catalog's books: each with its code, name, whether it is numbered and
 * how many entries it has. A row's name is a real link stretched over the
 * row, so it works from the keyboard and with cmd-click.
 */
export default function BooksList({ books }: BooksListProps) {
    if (books.length === 0) {
        return (
            <EmptyState
                title="No books yet"
                description="The catalog's books come from the seed import."
                action={
                    <Link
                        href={routes.catalogImport()}
                        className="text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300"
                    >
                        Go to Import
                    </Link>
                }
            />
        );
    }

    return (
        <ul className="bg-white dark:bg-gray-800 rounded-lg shadow-sm overflow-hidden divide-y divide-gray-200 dark:divide-gray-700">
            {books.map((book) => (
                <li
                    key={book.id}
                    className="relative flex items-center gap-4 px-4 sm:px-6 py-4 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors cursor-pointer"
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
                            {!book.active && " · Inactive"}
                        </p>
                    </div>
                </li>
            ))}
        </ul>
    );
}
