"use client";

import { useMemo, useRef } from "react";
import Pagination from "@/app/components/ui/Pagination";
import { useUrlState } from "@/app/hooks/useUrlState";
import {
    parseCatalogSongsQuery,
    selectCatalogSongs,
    type CatalogSort,
} from "@/lib/catalog/filter";
import { formatMatchCount } from "@/lib/catalog/summary";
import type { CatalogSongSummary } from "@/lib/domain";
import CatalogSongsControls, {
    ALL_BOOKS,
    type CatalogBookOption,
} from "./CatalogSongsControls";
import SongsTable from "./SongsTable";

const SONG = { one: "song", other: "songs" };

interface CatalogSongsViewProps {
    /** Every song, by title (`getCatalogSongs`). */
    songs: CatalogSongSummary[];
    /** The catalog's books, in book order. */
    books: CatalogBookOption[];
}

/**
 * The songs list: search, book filter, sort and pages over every song, in
 * the browser, with `lib/catalog/filter.ts`. The search (`?q=`), book
 * (`?book=`), sort (`?sort=`) and page (`?page=`) live in the URL, so a view
 * can be linked to and survives Back. Filters replace the history entry;
 * pages push one, so Back steps through them. A value at its default (no
 * search, every book, by title, page 1) leaves the URL.
 */
export default function CatalogSongsView({ songs, books }: CatalogSongsViewProps) {
    const { searchParams, setSearchParams } = useUrlState();
    const listRef = useRef<HTMLDivElement>(null);

    const bookCodes = useMemo(() => books.map((book) => book.code), [books]);
    const { q, book, sort, page } = parseCatalogSongsQuery(searchParams, bookCodes);
    const shown = useMemo(
        () => selectCatalogSongs(songs, { q, book, sort, page }, bookCodes),
        [songs, q, book, sort, page, bookCodes]
    );

    function handleQueryChange(next: string) {
        setSearchParams({ q: next === "" ? null : next, page: null }, { history: "replace" });
    }

    function handleBookChange(next: string) {
        setSearchParams(
            { book: next === ALL_BOOKS ? null : next, page: null },
            { history: "replace" }
        );
    }

    function handleSortChange(next: CatalogSort) {
        setSearchParams(
            { sort: next === "title" ? null : next, page: null },
            { history: "replace" }
        );
    }

    function handlePageChange(next: number) {
        setSearchParams({ page: next === 1 ? null : String(next) }, { history: "push" });
        // Paging from the bottom of a long page: bring the new page's first
        // rows into view.
        const list = listRef.current;
        if (list && list.getBoundingClientRect().top < 0) {
            list.scrollIntoView({ block: "start" });
        }
    }

    return (
        <div className="space-y-6">
            <CatalogSongsControls
                query={searchParams.get("q") ?? ""}
                book={book ?? ALL_BOOKS}
                sort={sort}
                books={books}
                summary={formatMatchCount(shown.total, songs.length, SONG)}
                onQueryChange={handleQueryChange}
                onBookChange={handleBookChange}
                onSortChange={handleSortChange}
            />
            <div
                ref={listRef}
                className="scroll-mt-4 bg-white dark:bg-gray-800 rounded-lg shadow-sm overflow-hidden"
            >
                <SongsTable
                    rows={shown.rows}
                    caption="Songs"
                    showTune
                    emptyMessage="No songs match."
                />
                {shown.totalPages > 1 && (
                    <div className="px-4 border-t border-gray-200 dark:border-gray-700">
                        <Pagination
                            currentPage={shown.page}
                            totalPages={shown.totalPages}
                            onPageChange={handlePageChange}
                        />
                    </div>
                )}
            </div>
        </div>
    );
}
