"use client";

import ExportCsvButton from "@/app/components/ui/ExportCsvButton";
import Segmented, { type SegmentedOption } from "@/app/components/ui/Segmented";
import { formatCount } from "@/lib/catalog/counts";
import type { CatalogLinked, CatalogMark, CatalogSort, CatalogUsed } from "@/lib/catalog/filter";
import type { Book, PcoTag, PcoTagGroup } from "@/lib/domain";
import SearchBox from "../SearchBox";

/** What the book filter needs of a book. */
export type CatalogBookOption = Pick<Book, "code" | "name" | "shortName">;

/** The book filter's value for every book: never a book code, which starts with a letter. */
export const ALL_BOOKS = "";

/** What the tag filter needs of a song tag group: its name, and its tags' ids and names. */
export type CatalogTagGroupOption = Pick<PcoTagGroup, "id" | "name"> & {
    tags: Pick<PcoTag, "id" | "name">[];
};

/** The tag filter's value for any tag: never a tag's id, which is digits. */
export const ANY_TAG = "";

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
    mark: CatalogMark;
    /** How many songs are marked to learn, of every song: the count beside the mark filter. */
    toLearnCount: number;
    /** The chosen tag's id, or `ANY_TAG`. */
    tag: string;
    sort: CatalogSort;
    books: readonly CatalogBookOption[];
    /** The song tag groups that have tags, by name; with none, there is no tag filter. */
    tagGroups: readonly CatalogTagGroupOption[];
    /** The count line, such as "12 of 921 songs". */
    summary: string;
    /** How many songs "Export CSV" would write: every song the filters leave, on every page. */
    exportCount: number;
    onQueryChange: (query: string) => void;
    onBookChange: (book: string) => void;
    onLinkedChange: (linked: CatalogLinked) => void;
    onUsedChange: (used: CatalogUsed) => void;
    onMarkChange: (mark: CatalogMark) => void;
    onTagChange: (tag: string) => void;
    onSortChange: (sort: CatalogSort) => void;
    /** Called to download the songs the filters leave as a CSV file. */
    onExport: () => void;
}

const GROUP_LABEL =
    "block text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400";

interface TagFilterProps {
    tag: string;
    tagGroups: readonly CatalogTagGroupOption[];
    onTagChange: (tag: string) => void;
}

/**
 * The tag filter: a list of Planning Center's song tags, grouped as
 * Planning Center groups them, with "Any tag" first. A list rather than a
 * row of buttons, since a church may have many tags in several groups.
 * Only a song linked to Planning Center has tags, which its label says.
 */
function TagFilter({ tag, tagGroups, onTagChange }: TagFilterProps) {
    return (
        <div className="max-w-full space-y-1">
            <label htmlFor="catalog-tag-filter" className={GROUP_LABEL}>
                Planning Center tag
            </label>
            <select
                id="catalog-tag-filter"
                value={tag}
                onChange={(event) => onTagChange(event.target.value)}
                // The height of the Segmented rows beside it; the ring is the
                // one they draw, 3:1 against the page.
                className="block max-w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:focus-visible:ring-blue-400"
            >
                <option value={ANY_TAG}>Any tag</option>
                {tagGroups.map((group) => (
                    <optgroup key={group.id} label={group.name}>
                        {group.tags.map((option) => (
                            <option key={option.id} value={option.id}>
                                {option.name}
                            </option>
                        ))}
                    </optgroup>
                ))}
            </select>
        </div>
    );
}

/** The mark filter's choices: every song, or the "to learn" shelf, with how many are on it. */
function markOptions(toLearnCount: number): SegmentedOption<CatalogMark>[] {
    return [
        { value: "all", label: "All" },
        {
            value: "to-learn",
            label: `To learn (${formatCount(toLearnCount)})`,
            title: "Songs marked to learn on their pages",
        },
    ];
}

/**
 * The songs list's search, book, Planning Center link, usage, mark and tag
 * filters and sort order, the count of what they leave, and the Export CSV
 * button. The mark filter says how many songs are marked to learn. The tag
 * filter shows only once the tags sync has brought some tags.
 */
export default function CatalogSongsControls({
    query,
    book,
    linked,
    used,
    mark,
    toLearnCount,
    tag,
    sort,
    books,
    tagGroups,
    summary,
    exportCount,
    onQueryChange,
    onBookChange,
    onLinkedChange,
    onUsedChange,
    onMarkChange,
    onTagChange,
    onSortChange,
    onExport,
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
                    <span className={GROUP_LABEL}>Shelf</span>
                    <Segmented
                        value={mark}
                        options={markOptions(toLearnCount)}
                        onChange={onMarkChange}
                        ariaLabel="Filter by mark"
                    />
                </div>
                {tagGroups.length > 0 && (
                    <TagFilter tag={tag} tagGroups={tagGroups} onTagChange={onTagChange} />
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
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-gray-100 dark:border-gray-700 pt-3">
                <p
                    aria-live="polite"
                    className="text-sm font-medium text-gray-900 dark:text-gray-100"
                >
                    {summary}
                </p>
                <ExportCsvButton
                    canExport={exportCount > 0}
                    title="Download every song the filters leave, on every page, as a CSV file"
                    emptyTitle="No songs to export"
                    onExport={onExport}
                />
            </div>
        </div>
    );
}
