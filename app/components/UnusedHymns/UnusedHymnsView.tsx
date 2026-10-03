"use client";

import { useCallback, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Route } from "next";
import { refreshUnusedHymns } from "@/app/(app)/unused-hymns/actions";
import type { HymnEntry, ReviewEntry, UnusedHymnsResult } from "@/lib/unusedHymns";
import UnusedHymnsControls, {
    type BookFilter,
    type SortKey,
} from "./UnusedHymnsControls";
import UnusedHymnsTable from "./UnusedHymnsTable";

const ITEMS_PER_PAGE = 25;

function parseBook(value: string | null): BookFilter {
    return value === "rejoice" || value === "great" ? value : "all";
}

function parseSort(value: string | null): SortKey {
    return value === "number" ? "number" : "title";
}

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
 * paging happen here, in the browser, on the result the server loaded.
 */
export default function UnusedHymnsView({
    initialResult,
}: UnusedHymnsViewProps) {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    const book = parseBook(searchParams.get("book"));
    const sort = parseSort(searchParams.get("sort"));

    const [result, setResult] = useState(initialResult);
    const [refreshError, setRefreshError] = useState<string | null>(null);
    const [refreshing, startRefresh] = useTransition();
    const [page, setPage] = useState(1);

    function handleRefresh() {
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
                setPage(1);
            });
        });
    }

    const updateParam = useCallback(
        (key: string, value: string) => {
            const params = new URLSearchParams(searchParams.toString());
            params.set(key, value);
            router.replace(`${pathname}?${params.toString()}` as Route);
            setPage(1);
        },
        [pathname, router, searchParams]
    );

    const filteredUnused: HymnEntry[] = result.unused.filter((entry) =>
        inBook(entry, book)
    );
    const sortedUnused = sortEntries(filteredUnused, book, sort);
    const filteredReview: ReviewEntry[] = result.review.filter((entry) =>
        inBook(entry, book)
    );

    const totalPages = Math.max(1, Math.ceil(sortedUnused.length / ITEMS_PER_PAGE));
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * ITEMS_PER_PAGE;
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
                onBookChange={(next) => updateParam("book", next)}
                onSortChange={(next) => updateParam("sort", next)}
                onRefresh={handleRefresh}
            />
            <UnusedHymnsTable
                rows={pageRows}
                review={filteredReview}
                book={book}
                currentPage={safePage}
                totalPages={totalPages}
                onPageChange={setPage}
            />
        </div>
    );
}
