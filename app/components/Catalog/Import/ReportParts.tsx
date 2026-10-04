import type { ReactNode } from "react";
import { formatCount } from "@/lib/catalog/counts";

/**
 * The parts the import reports are built from, shared by the seed's report
 * and a book's CSV file's: a number with a line of detail, a collapsible
 * section, a table of rows, and a coloured label for an outcome.
 */

interface StatProps {
    label: string;
    value: number;
    note?: string;
}

/** One number of the summary, with a line of detail under it. */
export function Stat({ label, value, note }: StatProps) {
    return (
        <div>
            <dt className="text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                {label}
            </dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                {formatCount(value)}
            </dd>
            {note && (
                <dd className="text-xs text-gray-500 dark:text-gray-400">{note}</dd>
            )}
        </div>
    );
}

interface SectionProps {
    title: string;
    /** How many rows it lists. */
    count: number;
    /** What the rows are, and what to do about them. */
    description: string;
    /** Whether it starts expanded. Long lists start closed. */
    open?: boolean;
    children: ReactNode;
}

/**
 * A collapsible part of the report, on the native `<details>`: it works
 * without script and keeps its own open state.
 */
export function Section({ title, count, description, open = true, children }: SectionProps) {
    return (
        <details
            open={open}
            className="group bg-white dark:bg-gray-800 rounded-lg shadow-sm overflow-hidden"
        >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 bg-gray-50 px-4 py-4 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 dark:bg-gray-700 dark:hover:bg-gray-600 sm:px-6 [&::-webkit-details-marker]:hidden">
                <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                    {title}
                </h2>
                <span className="flex items-center gap-3 text-sm text-gray-500 dark:text-gray-300">
                    <span className="tabular-nums">{formatCount(count)}</span>
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        aria-hidden="true"
                        className="h-4 w-4 transition-transform group-open:rotate-180"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                    >
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M19 9l-7 7-7-7"
                        />
                    </svg>
                </span>
            </summary>
            <div className="space-y-4 px-4 py-4 sm:px-6">
                <p className="text-sm text-gray-600 dark:text-gray-300">
                    {description}
                </p>
                {children}
            </div>
        </details>
    );
}

export interface Column<T> {
    header: string;
    cell: (row: T) => ReactNode;
}

interface ReportTableProps<T> {
    /** Names the table for screen readers. */
    caption: string;
    rows: T[];
    columns: Column<T>[];
    /** What to say when there are no rows. */
    empty: string;
}

/**
 * A table of report rows. On a narrow screen it keeps a minimum width and
 * scrolls sideways inside its card, rather than squeezing its columns until
 * their words break apart.
 */
export function ReportTable<T>({ caption, rows, columns, empty }: ReportTableProps<T>) {
    if (rows.length === 0) {
        return <p className="text-sm text-gray-500 dark:text-gray-400">{empty}</p>;
    }
    return (
        <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-left">
                <caption className="sr-only">{caption}</caption>
                <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700">
                        {columns.map((column, index) => (
                            <th
                                key={index}
                                scope="col"
                                className="px-3 py-2 text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-300 whitespace-nowrap"
                            >
                                {column.header}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {rows.map((row, rowIndex) => (
                        <tr key={rowIndex}>
                            {columns.map((column, columnIndex) => (
                                <td
                                    key={columnIndex}
                                    className="px-3 py-2 align-top text-sm text-gray-900 dark:text-gray-100"
                                >
                                    {column.cell(row)}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

interface PillProps {
    tone: "green" | "amber" | "red" | "gray";
    children: ReactNode;
}

const PILL_COLOURS = {
    green: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200",
    amber: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
    red: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
    gray: "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200",
} as const;

/** A small coloured label, for an outcome. */
export function Pill({ tone, children }: PillProps) {
    const colours = PILL_COLOURS[tone];
    return (
        <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${colours}`}
        >
            {children}
        </span>
    );
}
