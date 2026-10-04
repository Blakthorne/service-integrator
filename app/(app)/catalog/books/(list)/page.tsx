import type { Metadata } from "next";
import BooksList from "@/app/components/Catalog/Books/BooksList";
import PageHeader from "@/app/components/ui/PageHeader";
import { getCatalogBooks } from "@/lib/queries/catalog";
import { routes } from "@/lib/routes";

export const metadata: Metadata = { title: "Books" };

/**
 * The catalog's books. The query reads the local database, so a failure
 * falls through to the shell's error boundary.
 */
export default function BooksPage() {
    const books = getCatalogBooks();

    return (
        <div className="font-sans">
            <PageHeader
                title="Books"
                description="The hymnals and other books the catalog indexes."
                breadcrumbs={[
                    { label: "Catalog", href: routes.catalog() },
                    { label: "Books" },
                ]}
            />
            <div className="w-full max-w-4xl mx-auto">
                <BooksList books={books} />
            </div>
        </div>
    );
}
