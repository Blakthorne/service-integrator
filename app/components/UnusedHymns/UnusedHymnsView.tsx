"use client";

import { useState, useTransition } from "react";
import { refreshUnusedHymns } from "@/app/(app)/unused-hymns/actions";
import { useUrlState } from "@/app/hooks/useUrlState";
import type { HymnEntry, ReviewEntry, UnusedHymnsResult } from "@/lib/unusedHymns";
import { parseEnum, parsePage } from "@/lib/urlState";
import UnusedHymnsControls, {
    type BookFilter,
    type SortKey,
} from "./UnusedHymnsControls";
import UnusedHymnsTable from "./UnusedHymnsTable";

const ITEMS_PER_PAGE = 25;

const BOOK_FILTERS: readonly BookFilter[] = ["all", "rejoice", "great"];
const SORT_KEYS: readonly SortKey[] = ["title", "number"];

function inBook<T extends HymnEntry>(entry: T, book: BookFilter): boolean {
    if (book === "rejoice") return entry.rejoiceNumber !== null;
    if (book === "great") return entry.greatHymnsNumber !== null;
    return true;
}

function numberFor(entry: HymnEntry, book: BookFilter): number {
    if (book === "great") return entry.greatHymnsNumber ?? Number.POSITIVE_INFINITY;
    if (book === "rejoice") return entry.rejoiceNumber ?? Number.POSITIVE_INFINITY;
    return (
        entry.rejoiceNumber ??
        entry.greatHymnsNumber ??
        Number.POSITIVE_INFINITY
    );
}

function sortEntries<T extends HymnEntry>(
    entries: T[],
    book: BookFilter,
    sort: SortKey
): T[] {
    const copy = [...entries];
    if (sort === "number") {
        copy.sort(
            (a, b) =>
                numberFor(a, book) - numberFor(b, book) ||
                a.songTitle.localeCompare(b.songTitle)
        );
    } else {
        copy.sort(
            (a, b) =>
                a.songTitle.localeCompare(b.songTitle) ||
                a.tuneName.localeCompare(b.tuneName)
        );
    }
    return copy;
}

function buildSummary(
    book: BookFilter,
    unusedCount: number,
    totals: { rejoice: number; greatHymns: number }
): string {
    if (book === "rejoice") {
        return `${unusedCount} of ${totals.rejoice} Rejoice Hymns never used`;
    }
    if (book === "great") {
        return `${unusedCount} of ${totals.greatHymns} Great Hymns of the Faith never used`;
    }
    return `${unusedCount} hymnbook entries never used`;
}

interface UnusedHymnsViewProps {
    /** The result the server rendered the page with. A refresh replaces it. */
    initialResult: UnusedHymnsResult;
}

/**
 * The controls and table of the unused hymns page. Filtering, sorting and
 * paging happen here, in the browser, on the result the server loaded. The
 * hymnbook (`?book=`), sort order (`?sort=`) and page (`?page=`) live in the
 * URL, so a view can be linked to, and changing them does not re-render the
 * page on the server.
 */
export default function UnusedHymnsView({
    initialResult,
}: UnusedHymnsViewProps) {
    const { searchParams, setSearchParams } = useUrlState();

    const book = parseEnum(searchParams.get("book"), BOOK_FILTERS, "all");
    const sort = parseEnum(searchParams.get("sort"), SORT_KEYS, "title");

    const [result, setResult] = useState(initialResult);
    const [refreshError, setRefreshError] = useState<string | null>(null);
    const [refreshing, startRefresh] = useTransition();

    function handleBookChange(next: BookFilter) {
        setSearchParams({ book: next, page: null }, { history: "replace" });
    }

    function handleSortChange(next: SortKey) {
        setSearchParams({ sort: next, page: null }, { history: "replace" });
    }

    function handlePageChange(next: number) {
        // "push", so Back returns to the previous page of results.
        setSearchParams(
            { page: next === 1 ? null : String(next) },
            { history: "push" }
        );
    }

    function handleRefresh() {
        const pathAtClick = window.location.pathname;
        setRefreshError(null);
        startRefresh(async () => {
            let next: UnusedHymnsResult;
            try {
                next = await refreshUnusedHymns();
            } catch (error) {
                // Keep showing the current results; Refresh is the retry.
                console.error("Error refreshing unused hymns:", error);
                // Updates after an await are only part of the transition if
                // they are wrapped in startRefresh again.
                startRefresh(() => {
                    setRefreshError("Failed to refresh unused hymns");
                });
                return;
            }
            startRefresh(() => {
                setResult(next);
                // The URL belongs to whichever page is showing now, so leave
                // it alone if the viewer navigated away while refreshing.
                if (window.location.pathname === pathAtClick) {
                    setSearchParams({ page: null }, { history: "replace" });
                }
            });
        });
    }

    const filteredUnused: HymnEntry[] = result.unused.filter((entry) =>
        inBook(entry, book)
    );
    const sortedUnused = sortEntries(filteredUnused, book, sort);
    const filteredReview: ReviewEntry[] = result.review.filter((entry) =>
        inBook(entry, book)
    );

    const totalPages = Math.max(1, Math.ceil(sortedUnused.length / ITEMS_PER_PAGE));
    const page = parsePage(searchParams.get("page"), totalPages);
    const start = (page - 1) * ITEMS_PER_PAGE;
    const pageRows = sortedUnused.slice(start, start + ITEMS_PER_PAGE);

    return (
        <div className="w-full">
            <UnusedHymnsControls
                book={book}
                sort={sort}
                summary={buildSummary(book, sortedUnused.length, result.meta.totals)}
                computedAt={result.meta.computedAt}
                refreshing={refreshing}
                refreshError={refreshError}
                onBookChange={handleBookChange}
                onSortChange={handleSortChange}
                onRefresh={handleRefresh}
            />
            <UnusedHymnsTable
                rows={pageRows}
                review={filteredReview}
                book={book}
                currentPage={page}
                totalPages={totalPages}
                onPageChange={handlePageChange}
            />
        </div>
    );
}
