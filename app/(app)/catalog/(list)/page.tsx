import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import CatalogSongsView from "@/app/components/Catalog/Songs/CatalogSongsView";
import EmptyState from "@/app/components/ui/EmptyState";
import LoadingState from "@/app/components/ui/LoadingState";
import PageHeader from "@/app/components/ui/PageHeader";
import { getCatalogBooks, getCatalogSongs } from "@/lib/queries/catalog";
import { routes } from "@/lib/routes";

export const metadata: Metadata = { title: "Catalog" };

/**
 * The catalog's home: every song, which the view searches, filters, sorts
 * and pages in the browser. The server reads the local database once; the
 * client gets the list rows and, of each book, only what the book filter
 * shows. Before the seed import the catalog is empty, and the page points
 * at Import. It sits in the `(list)` route group so that its `loading.tsx`
 * covers this list and not the song, tune, book and import pages beside it.
 */
export default function CatalogPage() {
    const songs = getCatalogSongs();
    const books = getCatalogBooks().map(({ code, name, shortName }) => ({
        code,
        name,
        shortName,
    }));

    return (
        <>
            <PageHeader
                title="Catalog"
                description="Every song in the hymnals: search by title, tune or number."
            />
            {songs.length === 0 ? (
                <EmptyState
                    title="The catalog is empty"
                    description="Import the hymnals to fill it."
                    action={
                        <Link
                            href={routes.catalogImport()}
                            className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                        >
                            Go to Import
                        </Link>
                    }
                />
            ) : (
                // The view reads the query string, which needs a Suspense boundary.
                <Suspense fallback={<LoadingState label="Loading songs…" />}>
                    <CatalogSongsView songs={songs} books={books} />
                </Suspense>
            )}
        </>
    );
}
