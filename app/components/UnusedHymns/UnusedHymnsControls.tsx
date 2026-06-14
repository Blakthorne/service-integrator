"use client";

export type BookFilter = "all" | "rejoice" | "great";
export type SortKey = "title" | "number";

interface UnusedHymnsControlsProps {
    book: BookFilter;
    sort: SortKey;
    summary: string;
    computedAt: string | null;
    refreshing: boolean;
    onBookChange: (book: BookFilter) => void;
    onSortChange: (sort: SortKey) => void;
    onRefresh: () => void;
}

const BOOK_OPTIONS: { value: BookFilter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "rejoice", label: "Rejoice Hymns" },
    { value: "great", label: "Great Hymns" },
];

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
    { value: "title", label: "Title (A–Z)" },
    { value: "number", label: "Hymn number" },
];

function Segmented<T extends string>({
    value,
    options,
    onChange,
    ariaLabel,
}: {
    value: T;
    options: { value: T; label: string }[];
    onChange: (next: T) => void;
    ariaLabel: string;
}) {
    return (
        <div
            role="group"
            aria-label={ariaLabel}
            className="inline-flex rounded-md border border-gray-300 dark:border-gray-600 overflow-hidden"
        >
            {options.map((option) => {
                const isActive = option.value === value;
                return (
                    <button
                        key={option.value}
                        type="button"
                        aria-pressed={isActive}
                        onClick={() => onChange(option.value)}
                        className={`px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                            isActive
                                ? "bg-blue-500 text-white"
                                : "bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600"
                        }`}
                    >
                        {option.label}
                    </button>
                );
            })}
        </div>
    );
}

export default function UnusedHymnsControls({
    book,
    sort,
    summary,
    computedAt,
    refreshing,
    onBookChange,
    onSortChange,
    onRefresh,
}: UnusedHymnsControlsProps) {
    const asOf = computedAt
        ? new Date(computedAt).toLocaleString("en-US", {
              dateStyle: "medium",
              timeStyle: "short",
          })
        : null;

    return (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4 mb-6 space-y-4">
            <div className="flex flex-wrap items-center gap-4">
                <div className="space-y-1">
                    <span className="block text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                        Hymnbook
                    </span>
                    <Segmented
                        value={book}
                        options={BOOK_OPTIONS}
                        onChange={onBookChange}
                        ariaLabel="Filter by hymnbook"
                    />
                </div>
                <div className="space-y-1">
                    <span className="block text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                        Sort
                    </span>
                    <Segmented
                        value={sort}
                        options={SORT_OPTIONS}
                        onChange={onSortChange}
                        ariaLabel="Sort order"
                    />
                </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 dark:border-gray-700 pt-3">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {summary}
                </p>
                <div className="flex items-center gap-3">
                    {asOf && (
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                            As of {asOf}
                        </span>
                    )}
                    <button
                        type="button"
                        onClick={onRefresh}
                        disabled={refreshing}
                        className="px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        {refreshing ? "Refreshing…" : "Refresh"}
                    </button>
                </div>
            </div>
        </div>
    );
}
