"use client";

import Segmented, { type SegmentedOption } from "@/app/components/ui/Segmented";
import type { CatalogLinked, CatalogSort, CatalogUsed } from "@/lib/catalog/filter";
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

const LINKED_OPTIONS: readonly SegmentedOption<CatalogLinked>[] = [
    { value: "all", label: "All" },
    { value: "yes", label: "Linked", title: "Songs linked to a Planning Center song" },
    { value: "no", label: "Not linked", title: "Songs with no Planning Center song yet" },
];

const USED_OPTIONS: readonly SegmentedOption<CatalogUsed>[] = [
    { value: "all", label: "All" },
    {
        value: "never",
        label: "Never scheduled",
        title: "Not linked to a Planning Center song, or linked to one that was never scheduled",
    },
];

interface CatalogSongsControlsProps {
    /** The search as the URL has it. */
    query: string;
    /** The chosen book's code, or `ALL_BOOKS`. */
    book: string;
    linked: CatalogLinked;
    used: CatalogUsed;
    sort: CatalogSort;
    books: readonly CatalogBookOption[];
    /** The count line, such as "12 of 921 songs". */
    summary: string;
    onQueryChange: (query: string) => void;
    onBookChange: (book: string) => void;
    onLinkedChange: (linked: CatalogLinked) => void;
    onUsedChange: (used: CatalogUsed) => void;
    onSortChange: (sort: CatalogSort) => void;
}

const GROUP_LABEL =
    "block text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400";

/**
 * The songs list's search, book, Planning Center link and usage filters and
 * sort order, and the count of what they leave.
 */
export default function CatalogSongsControls({
    query,
    book,
    linked,
    used,
    sort,
    books,
    summary,
    onQueryChange,
    onBookChange,
    onLinkedChange,
    onUsedChange,
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
                hint="By title, tune or number, such as 396 or R-396."
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
                    <span className={GROUP_LABEL}>Planning Center</span>
                    <Segmented
                        value={linked}
                        options={LINKED_OPTIONS}
                        onChange={onLinkedChange}
                        ariaLabel="Filter by Planning Center link"
                    />
                </div>
                <div className="max-w-full space-y-1">
                    <span className={GROUP_LABEL}>Usage</span>
                    <Segmented
                        value={used}
                        options={USED_OPTIONS}
                        onChange={onUsedChange}
                        ariaLabel="Filter by usage"
                    />
                </div>
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
