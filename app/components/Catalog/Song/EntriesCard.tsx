import Link from "next/link";
import { entryNotes } from "@/lib/catalog/entryNotes";
import type { Book, LabelledEntry } from "@/lib/domain";
import { routes } from "@/lib/routes";
import CatalogCard, { LINK_CLASS, NoValue } from "../CatalogCard";

interface EntriesCardProps {
    /** The song's entries, in book order. */
    entries: readonly LabelledEntry[];
    /** The catalog's books, for each entry's book name and whether it is numbered. */
    books: readonly Pick<Book, "id" | "name" | "numbered">[];
}

/** The look of an entry's label, the line's first and largest text. */
const LABEL_CLASS = "min-w-20 text-lg font-semibold tabular-nums";

/**
 * Where a song is in the books: for each entry, its label ("R-396"), its
 * book (a link to the book's page) and any variant or location note. When
 * the label is the book's name, as an unnumbered book's can be ("Chorus
 * Book"), the label is the link, rather than the name twice.
 */
export default function EntriesCard({ entries, books }: EntriesCardProps) {
    const bookById = new Map(books.map((book) => [book.id, book]));

    return (
        <CatalogCard title="Books" headingId="entries-heading">
            {entries.length === 0 ? (
                <NoValue>This song is not in any book.</NoValue>
            ) : (
                <ul className="-my-2 divide-y divide-gray-200 dark:divide-gray-700">
                    {entries.map((entry) => {
                        const book = bookById.get(entry.bookId);
                        const bookName = book?.name ?? entry.bookCode;
                        // Default prefetch: a book's page reads only the local database.
                        const bookHref = routes.catalogBook(entry.bookCode);
                        const notes = entryNotes(book ?? { numbered: true }, entry);
                        return (
                            <li
                                key={entry.id}
                                className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-2"
                            >
                                {entry.label === bookName ? (
                                    <Link
                                        href={bookHref}
                                        className={`${LABEL_CLASS} ${LINK_CLASS}`}
                                    >
                                        {entry.label}
                                    </Link>
                                ) : (
                                    <>
                                        <span
                                            className={`${LABEL_CLASS} text-gray-900 dark:text-gray-100`}
                                        >
                                            {entry.label}
                                        </span>
                                        <Link href={bookHref} className={LINK_CLASS}>
                                            {bookName}
                                        </Link>
                                    </>
                                )}
                                {notes.length > 0 && (
                                    <span className="text-sm text-gray-600 dark:text-gray-400">
                                        {notes.join(" · ")}
                                    </span>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}
        </CatalogCard>
    );
}
