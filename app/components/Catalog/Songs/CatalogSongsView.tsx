"use client";

import { useMemo, useRef } from "react";
import Pagination from "@/app/components/ui/Pagination";
import { useUrlState } from "@/app/hooks/useUrlState";
import {
    arrangeCatalogSongs,
    parseCatalogSongsQuery,
    selectCatalogSongs,
    type CatalogLinked,
    type CatalogSort,
    type CatalogUsed,
} from "@/lib/catalog/filter";
import { formatMatchCount } from "@/lib/catalog/counts";
import { catalogCsvFilename, catalogSongsCsv } from "@/lib/catalog/songsCsv";
import type { CatalogSongSummary } from "@/lib/domain";
import CatalogSongsControls, {
    ALL_BOOKS,
    type CatalogBookOption,
} from "./CatalogSongsControls";
import { downloadCsv } from "./downloadCsv";
import SongsTable from "./SongsTable";

interface CatalogSongsViewProps {
    /** Every song, by title (`getCatalogSongs`). */
    songs: CatalogSongSummary[];
    /** The catalog's books, in book order. */
    books: CatalogBookOption[];
}

/**
 * The songs list: search, filters, sort and pages over every song, in the
 * browser, with `lib/catalog/filter.ts`. The search (`?q=`), book (`?book=`),
 * Planning Center link (`?linked=`), usage (`?used=`), sort (`?sort=`) and
 * page (`?page=`) live in the URL, so a view can be linked to and survives
 * Back. Filters replace the history entry and send the list back to page 1;
 * pages push one, so Back steps through them. A value at its default (no
 * search, every book, linked or not, used or not, by title, page 1) leaves
 * the URL. "Export CSV" downloads every song the filters leave, not just the
 * page shown.
 */
export default function CatalogSongsView({ songs, books }: CatalogSongsViewProps) {
    const { searchParams, setSearchParams } = useUrlState();
    const listRef = useRef<HTMLDivElement>(null);

    const bookCodes = useMemo(() => books.map((book) => book.code), [books]);
    const { q, book, linked, used, sort, page } = parseCatalogSongsQuery(
        searchParams,
        bookCodes
    );
    const shown = useMemo(
        () => selectCatalogSongs(songs, { q, book, linked, used, sort, page }, bookCodes),
        [songs, q, book, linked, used, sort, page, bookCodes]
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

    function handleLinkedChange(next: CatalogLinked) {
        setSearchParams(
            { linked: next === "all" ? null : next, page: null },
            { history: "replace" }
        );
    }

    function handleUsedChange(next: CatalogUsed) {
        setSearchParams(
            { used: next === "all" ? null : next, page: null },
            { history: "replace" }
        );
    }

    function handleSortChange(next: CatalogSort) {
        setSearchParams(
            { sort: next === "title" ? null : next, page: null },
            { history: "replace" }
        );
    }

    function handleExport() {
        // Every row the filters leave, in the order shown, from the same
        // function as the page: what is exported is what is listed.
        const matching = arrangeCatalogSongs(
            songs,
            { q, book, linked, used, sort },
            bookCodes
        );
        downloadCsv(
            catalogCsvFilename({ q, book, linked, used }, new Date()),
            catalogSongsCsv(matching, books)
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
                linked={linked}
                used={used}
                sort={sort}
                books={books}
                summary={formatMatchCount(shown.total, songs.length, "song")}
                exportCount={shown.total}
                onQueryChange={handleQueryChange}
                onBookChange={handleBookChange}
                onLinkedChange={handleLinkedChange}
                onUsedChange={handleUsedChange}
                onSortChange={handleSortChange}
                onExport={handleExport}
            />
            <div
                ref={listRef}
                className="scroll-mt-4 bg-white dark:bg-gray-800 rounded-lg shadow-sm overflow-hidden"
            >
                <SongsTable
                    rows={shown.rows}
                    caption="Songs"
                    showTune
                    showLink
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
