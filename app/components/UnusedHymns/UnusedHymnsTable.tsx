"use client";

import { useState } from "react";
import Pagination from "../ui/Pagination";
import type { HymnEntry, ReviewEntry } from "@/lib/unusedHymns";
import type { BookFilter } from "./UnusedHymnsControls";

interface UnusedHymnsTableProps {
    rows: HymnEntry[];
    review: ReviewEntry[];
    book: BookFilter;
    currentPage: number;
    totalPages: number;
    onPageChange: (page: number) => void;
}

function numberCell(value: number | null) {
    return (
        <td className="px-6 py-4 text-sm text-gray-900 dark:text-gray-100 tabular-nums">
            {value ?? ""}
        </td>
    );
}

export default function UnusedHymnsTable({
    rows,
    review,
    book,
    currentPage,
    totalPages,
    onPageChange,
}: UnusedHymnsTableProps) {
    const [reviewOpen, setReviewOpen] = useState(false);
    const showRejoice = book !== "great";
    const showGreat = book !== "rejoice";

    return (
        <div className="space-y-6">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead className="bg-gray-50 dark:bg-gray-700">
                            <tr>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                                    Title
                                </th>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                                    Tune
                                </th>
                                {showRejoice && (
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                                        Rejoice
                                    </th>
                                )}
                                {showGreat && (
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                                        Great Hymns
                                    </th>
                                )}
                            </tr>
                        </thead>
                        <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                            {rows.length === 0 ? (
                                <tr>
                                    <td
                                        colSpan={2 + (showRejoice ? 1 : 0) + (showGreat ? 1 : 0)}
                                        className="px-6 py-12 text-center text-sm text-gray-500 dark:text-gray-400"
                                    >
                                        No unused hymns for this filter.
                                    </td>
                                </tr>
                            ) : (
                                rows.map((row) => (
                                    <tr
                                        key={`${row.songTitle}-${row.tuneName}-${row.rejoiceNumber ?? ""}-${row.greatHymnsNumber ?? ""}`}
                                        className="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                                    >
                                        <td className="px-6 py-4 text-sm font-medium text-gray-900 dark:text-gray-100">
                                            {row.songTitle}
                                        </td>
                                        <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">
                                            {row.tuneName || "—"}
                                        </td>
                                        {showRejoice && numberCell(row.rejoiceNumber)}
                                        {showGreat && numberCell(row.greatHymnsNumber)}
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
                {totalPages > 1 && (
                    <div className="px-4">
                        <Pagination
                            currentPage={currentPage}
                            totalPages={totalPages}
                            onPageChange={onPageChange}
                        />
                    </div>
                )}
            </div>

            {review.length > 0 && (
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm overflow-hidden">
                    <button
                        type="button"
                        onClick={() => setReviewOpen((open) => !open)}
                        aria-expanded={reviewOpen}
                        aria-controls="unused-hymns-review"
                        className="w-full flex items-center justify-between px-6 py-4 bg-gray-50 dark:bg-gray-700 text-left focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                            Possible matches — review ({review.length})
                        </span>
                        <span className="text-gray-500 dark:text-gray-400 text-sm">
                            {reviewOpen ? "Hide" : "Show"}
                        </span>
                    </button>
                    {reviewOpen && (
                        <ul id="unused-hymns-review" className="divide-y divide-gray-200 dark:divide-gray-700">
                            {review.map((entry) => (
                                <li
                                    key={`${entry.songTitle}-${entry.tuneName}-${entry.rejoiceNumber ?? ""}-${entry.greatHymnsNumber ?? ""}`}
                                    className="px-6 py-3 text-sm"
                                >
                                    <span className="font-medium text-gray-900 dark:text-gray-100">
                                        {entry.songTitle}
                                    </span>
                                    {entry.tuneName && (
                                        <span className="text-gray-500 dark:text-gray-400">
                                            {" "}
                                            · {entry.tuneName}
                                        </span>
                                    )}
                                    <span className="block text-xs text-gray-500 dark:text-gray-400 mt-1">
                                        {entry.reason === "ambiguous-tune"
                                            ? `Title scheduled in PCO ("${entry.matchedPcoTitle}") — confirm which tune.`
                                            : `Close to a scheduled PCO song ("${entry.matchedPcoTitle}") — confirm if same.`}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
        </div>
    );
}
