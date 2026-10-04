"use client";

import { useMemo, useRef } from "react";
import Pagination from "@/app/components/ui/Pagination";
import { useUrlState } from "@/app/hooks/useUrlState";
import { formatMatchCount } from "@/lib/catalog/summary";
import {
    parseCatalogTunesQuery,
    selectCatalogTunes,
    type CatalogTuneRow,
} from "@/lib/catalog/tuneFilter";
import SearchBox from "../SearchBox";
import TunesTable from "./TunesTable";

const TUNE = { one: "tune", other: "tunes" };

interface CatalogTunesViewProps {
    /** Every tune, by name. */
    tunes: CatalogTuneRow[];
}

/**
 * The tunes list: search and pages over every tune, in the browser, with
 * `lib/catalog/tuneFilter.ts`. The search (`?q=`) and page (`?page=`) live
 * in the URL; the search replaces the history entry and pages push one, so
 * Back steps through them.
 */
export default function CatalogTunesView({ tunes }: CatalogTunesViewProps) {
    const { searchParams, setSearchParams } = useUrlState();
    const listRef = useRef<HTMLDivElement>(null);

    const { q, page } = parseCatalogTunesQuery(searchParams);
    const shown = useMemo(() => selectCatalogTunes(tunes, { q, page }), [tunes, q, page]);

    function handleQueryChange(next: string) {
        setSearchParams({ q: next === "" ? null : next, page: null }, { history: "replace" });
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
            <div
                role="search"
                aria-label="Tunes"
                className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4 space-y-4"
            >
                <SearchBox
                    value={searchParams.get("q") ?? ""}
                    onChange={handleQueryChange}
                    label="Search tunes"
                    placeholder="Name"
                />
                <p
                    aria-live="polite"
                    className="border-t border-gray-100 dark:border-gray-700 pt-3 text-sm font-medium text-gray-900 dark:text-gray-100"
                >
                    {formatMatchCount(shown.total, tunes.length, TUNE)}
                </p>
            </div>
            <div
                ref={listRef}
                className="scroll-mt-4 bg-white dark:bg-gray-800 rounded-lg shadow-sm overflow-hidden"
            >
                <TunesTable rows={shown.rows} emptyMessage="No tunes match." />
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
