"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
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

export default function UnusedHymnsView() {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    const book = parseBook(searchParams.get("book"));
    const sort = parseSort(searchParams.get("sort"));

    const [result, setResult] = useState<UnusedHymnsResult | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [page, setPage] = useState(1);

    const mountedRef = useRef(true);
    const controllerRef = useRef<AbortController | null>(null);

    const runLoad = useCallback((refresh: boolean) => {
        controllerRef.current?.abort();
        const controller = new AbortController();
        controllerRef.current = controller;
        if (refresh) {
            setRefreshing(true);
        } else {
            setLoading(true);
        }

        const baseUrl =
            process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
        const url = `${baseUrl}/api/unused-hymns${refresh ? "?refresh=1" : ""}`;

        fetch(url, { signal: controller.signal })
            .then(async (response) => {
                if (!response.ok) {
                    throw new Error(
                        `Failed to load unused hymns: ${response.status}`
                    );
                }
                return (await response.json()) as UnusedHymnsResult;
            })
            .then((data) => {
                if (!mountedRef.current) return;
                setResult(data);
                setError(null);
                setPage(1);
            })
            .catch((err: unknown) => {
                if ((err as Error).name === "AbortError") return;
                if (!mountedRef.current) return;
                console.error("Error loading unused hymns:", err);
                setError(
                    refresh
                        ? "Failed to refresh unused hymns"
                        : "Failed to load unused hymns"
                );
            })
            .finally(() => {
                if (!mountedRef.current) return;
                if (refresh) {
                    setRefreshing(false);
                } else {
                    setLoading(false);
                }
            });
    }, []);

    useEffect(() => {
        mountedRef.current = true;
        runLoad(false);
        return () => {
            mountedRef.current = false;
            controllerRef.current?.abort();
        };
    }, [runLoad]);

    const handleRefresh = useCallback(() => {
        runLoad(true);
    }, [runLoad]);

    const updateParam = useCallback(
        (key: string, value: string) => {
            const params = new URLSearchParams(searchParams.toString());
            params.set(key, value);
            router.replace(`${pathname}?${params.toString()}`);
            setPage(1);
        },
        [pathname, router, searchParams]
    );

    if (loading) {
        return (
            <div className="text-center py-12">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
                <p className="text-gray-600 dark:text-gray-300">
                    Loading unused hymns…
                </p>
            </div>
        );
    }

    if (error || !result) {
        return (
            <div className="text-center py-12">
                <p className="text-red-600 dark:text-red-400 mb-4">
                    {error ?? "No data"}
                </p>
                <button
                    onClick={() => runLoad(false)}
                    className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
                >
                    Try Again
                </button>
            </div>
        );
    }

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
