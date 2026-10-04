import type { Metadata } from "next";
import AddBookCard from "@/app/components/Catalog/Books/AddBookCard";
import BooksList from "@/app/components/Catalog/Books/BooksList";
import PageHeader from "@/app/components/ui/PageHeader";
import { getCatalogBooks } from "@/lib/queries/catalog";
import { routes } from "@/lib/routes";

export const metadata: Metadata = { title: "Books" };

/**
 * The catalog's books, in the order a song's labels are listed in, each with
 * Move up and Move down, and the form that adds one. The query reads the
 * local database, so a failure falls through to the shell's error boundary.
 */
export default function BooksPage() {
    const books = getCatalogBooks();

    return (
        <div className="font-sans w-full max-w-4xl mx-auto">
            <PageHeader
                title="Books"
                description="The hymnals and other books the catalog indexes, in the order a song's labels are listed."
                breadcrumbs={[
                    { label: "Catalog", href: routes.catalog() },
                    { label: "Books" },
                ]}
            />
            <div className="w-full max-w-4xl mx-auto space-y-8">
                <BooksList books={books} />
                <AddBookCard />
            </div>
        </div>
    );
}
