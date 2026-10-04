"use client";

import Segmented, { type SegmentedOption } from "@/app/components/ui/Segmented";
import type { CatalogSort } from "@/lib/catalog/filter";
import type { Book } from "@/lib/domain";
import SearchBox from "../SearchBox";

/** What the book filter needs of a book. */
export type CatalogBookOption = Pick<Book, "code" | "name" | "shortName">;

/** The book filter's value for every book: never a book code, which starts with a letter. */
export const ALL_BOOKS = "";

const SORT_OPTIONS: readonly SegmentedOption<CatalogSort>[] = [
    { value: "title", label: "Title" },
    { value: "number", label: "Number", title: "By number in the chosen book" },
];

interface CatalogSongsControlsProps {
    /** The search as the URL has it. */
    query: string;
    /** The chosen book's code, or `ALL_BOOKS`. */
    book: string;
    sort: CatalogSort;
    books: readonly CatalogBookOption[];
    /** The count line, such as "12 of 921 songs". */
    summary: string;
    onQueryChange: (query: string) => void;
    onBookChange: (book: string) => void;
    onSortChange: (sort: CatalogSort) => void;
}

const GROUP_LABEL =
    "block text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400";

/** The songs list's search, book filter and sort order, and the count of what they leave. */
export default function CatalogSongsControls({
    query,
    book,
    sort,
    books,
    summary,
    onQueryChange,
    onBookChange,
    onSortChange,
}: CatalogSongsControlsProps) {
    const bookOptions: SegmentedOption<string>[] = [
        { value: ALL_BOOKS, label: "All" },
        ...books.map((option) => ({
            value: option.code,
            label: option.shortName,
            title: option.name,
        })),
    ];

    return (
        <div
            role="search"
            aria-label="Songs"
            className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4 space-y-4"
        >
            <SearchBox
                value={query}
                onChange={onQueryChange}
                label="Search songs"
                placeholder="Title, tune or number"
            />
            <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
                {books.length > 0 && (
                    <div className="max-w-full space-y-1">
                        <span className={GROUP_LABEL}>Book</span>
                        <Segmented
                            value={book}
                            options={bookOptions}
                            onChange={onBookChange}
                            ariaLabel="Filter by book"
                        />
                    </div>
                )}
                <div className="max-w-full space-y-1">
                    <span className={GROUP_LABEL}>Sort</span>
                    <Segmented
                        value={sort}
                        options={SORT_OPTIONS}
                        onChange={onSortChange}
                        ariaLabel="Sort order"
                    />
                </div>
            </div>
            <p
                aria-live="polite"
                className="border-t border-gray-100 dark:border-gray-700 pt-3 text-sm font-medium text-gray-900 dark:text-gray-100"
            >
                {summary}
            </p>
        </div>
    );
}
