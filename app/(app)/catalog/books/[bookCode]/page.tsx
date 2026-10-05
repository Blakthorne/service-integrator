import type { Metadata } from "next";
import { notFound } from "next/navigation";
import BookEntriesTable from "@/app/components/Catalog/Books/BookEntriesTable";
import EditBookCard from "@/app/components/Catalog/Books/EditBookCard";
import GoToNumber from "@/app/components/Catalog/Books/GoToNumber";
import PageHeader from "@/app/components/ui/PageHeader";
import { toBookRows } from "@/lib/catalog/bookRows";
import {
    NOT_IN_USE_NOTICE,
    UNNUMBERED_ORDER_NOTE,
    formatEntryCount,
} from "@/lib/catalog/bookText";
import { parseBookCode } from "@/lib/catalog/ids";
import { getCatalogBook, getCatalogBookLabel } from "@/lib/queries/catalog";
import { routes } from "@/lib/routes";

/**
 * The tab title is the book's name. `getCatalogBookLabel` never throws and
 * falls back to "Book" for a code that is invalid or unknown (convention 12).
 */
export async function generateMetadata({
    params,
}: Pick<PageProps<"/catalog/books/[bookCode]">, "params">): Promise<Metadata> {
    const { bookCode } = await params;
    return { title: getCatalogBookLabel(bookCode) };
}

/**
 * One book with all its entries in browse order: the front cover first, then
 * by number (or by position in an unnumbered book, whose entries can be moved
 * up and down). Its Edit form changes its name, label and whether it is in
 * use; a book not in use stays browsable, and says what it leaves out. A
 * code that is not a book code, or one no book has, ends in `not-found.tsx`.
 * The table gets the rows as one lean prop (`toBookRows`), not as
 * server-rendered elements.
 */
export default async function BookPage({
    params,
}: PageProps<"/catalog/books/[bookCode]">) {
    const raw = await params;
    const code = parseBookCode(raw.bookCode) ?? notFound();
    const book = getCatalogBook(code) ?? notFound();
    const rows = toBookRows(book);
    const hasNumbers = rows.some((row) => row.number !== null);

    return (
        <div className="font-sans w-full max-w-4xl mx-auto">
            <PageHeader
                title={book.name}
                description={`${book.code} · ${book.numbered ? "Numbered" : "Not numbered"} · ${formatEntryCount(rows.length)}${book.active ? "" : " · Not in use"}`}
                breadcrumbs={[
                    { label: "Catalog", href: routes.catalog() },
                    { label: "Books", href: routes.catalogBooks() },
                    { label: book.name },
                ]}
            />
            <div className="w-full max-w-4xl mx-auto space-y-6">
                {!book.active && (
                    <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
                        {NOT_IN_USE_NOTICE}
                    </p>
                )}
                <EditBookCard book={book} />
                {!book.numbered && rows.length > 1 && (
                    <p className="text-sm text-gray-600 dark:text-gray-300">
                        {UNNUMBERED_ORDER_NOTE}
                    </p>
                )}
                {hasNumbers && (
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4">
                        <GoToNumber bookCode={book.code} />
                    </div>
                )}
                <BookEntriesTable
                    rows={rows}
                    numbered={book.numbered}
                    bookName={book.name}
                />
            </div>
        </div>
    );
}
