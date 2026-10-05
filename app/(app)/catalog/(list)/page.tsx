import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import CatalogSongsView from "@/app/components/Catalog/Songs/CatalogSongsView";
import EmptyState from "@/app/components/ui/EmptyState";
import LoadingState from "@/app/components/ui/LoadingState";
import PageHeader from "@/app/components/ui/PageHeader";
import { catalogTagIdsBySong } from "@/lib/catalog/filter";
import { getActiveCatalogBooks, getCatalogSongs } from "@/lib/queries/catalog";
import { getLastHistorySync } from "@/lib/queries/system";
import { getSongTagGroups, getTagIdsBySong } from "@/lib/queries/tags";
import { routes } from "@/lib/routes";

export const metadata: Metadata = { title: "Catalog" };

/**
 * The catalog's home: every song, which the view searches, filters, sorts
 * and pages in the browser. The server reads the local database once; the
 * client gets the list rows; of each book, only what the book filter shows;
 * of Planning Center's song tags, the groups that have tags and the tags of
 * the songs the catalog links to, for the tag filter, and whether the plan
 * history has been read, for the rows' last sung dates and the not-sung-since
 * filter. Before the seed import the catalog is empty, and the page points
 * at Import. It sits in the
 * `(list)` route group so that its `loading.tsx` covers this list and not
 * the song, tune, book and import pages beside it.
 */
export default function CatalogPage() {
    const songs = getCatalogSongs();
    const books = getActiveCatalogBooks().map(({ code, name, shortName }) => ({
        code,
        name,
        shortName,
    }));
    const tagGroups = getSongTagGroups()
        .filter((group) => group.tags.length > 0)
        .map(({ id, name, tags }) => ({
            id,
            name,
            tags: tags.map((tag) => ({ id: tag.id, name: tag.name })),
        }));
    const tagIdsBySong = catalogTagIdsBySong(songs, getTagIdsBySong());
    // When the history's state cannot be read the songs list's own read has
    // failed too; say it is read, and let the rows show what they have.
    const history = getLastHistorySync();
    const historyRead = !history.ok || history.counts.plans > 0;

    return (
        <div className="w-full max-w-4xl mx-auto">
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
                    <CatalogSongsView
                        songs={songs}
                        books={books}
                        tagGroups={tagGroups}
                        tagIdsBySong={tagIdsBySong}
                        historyRead={historyRead}
                    />
                </Suspense>
            )}
        </div>
    );
}
