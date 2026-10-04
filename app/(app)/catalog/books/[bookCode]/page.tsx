import type { Metadata } from "next";
import { notFound } from "next/navigation";
import BookEntriesTable from "@/app/components/Catalog/Books/BookEntriesTable";
import { formatEntryCount } from "@/lib/catalog/bookText";
import GoToNumber from "@/app/components/Catalog/Books/GoToNumber";
import PageHeader from "@/app/components/ui/PageHeader";
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
 * by number (or by position in an unnumbered book). A code that is not a book
 * code, or one no book has, ends in `not-found.tsx`.
 */
export default async function BookPage({
    params,
}: PageProps<"/catalog/books/[bookCode]">) {
    const raw = await params;
    const code = parseBookCode(raw.bookCode) ?? notFound();
    const book = getCatalogBook(code) ?? notFound();
    const hasNumbers = book.entries.some((entry) => entry.number !== null);

    return (
        <div className="font-sans">
            <PageHeader
                title={book.name}
                description={`${book.code} · ${book.numbered ? "Numbered" : "Not numbered"} · ${formatEntryCount(book.entries.length)}`}
                breadcrumbs={[
                    { label: "Catalog", href: routes.catalog() },
                    { label: "Books", href: routes.catalogBooks() },
                    { label: book.name },
                ]}
            />
            <div className="w-full max-w-4xl mx-auto space-y-6">
                {hasNumbers && (
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4">
                        <GoToNumber bookCode={book.code} />
                    </div>
                )}
                <BookEntriesTable book={book} />
            </div>
        </div>
    );
}
