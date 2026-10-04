"use client";

import Link from "next/link";
import type { PlanItemWithSong } from "@/lib/domain";
import { routes } from "@/lib/routes";
import { usePlan } from "./PlanProvider";

/** The author column: the song's author for a song item, "-" for anything else. */
function authorFor(item: PlanItemWithSong): string {
    if (item.itemType === "song") {
        return item.song?.author || "Unknown";
    }
    return "-";
}

/** The CCLI column: the song's CCLI number for a song item, "-" otherwise. */
function ccliNumberFor(item: PlanItemWithSong): string {
    if (item.itemType === "song") {
        return item.song?.ccliNumber?.toString() || "-";
    }
    return "-";
}

/**
 * The plan's items, with each song's author and CCLI number, and the item
 * count. Every row opens the item's page: the title is a real link stretched
 * over the whole row, so rows work from the keyboard and with cmd-click or
 * "open in new tab".
 */
export default function PlanItemsTable() {
    const { plan, serviceType, items } = usePlan();

    return (
        <>
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-x-auto">
                <table className="w-full min-w-[640px]">
                    <thead className="bg-gray-50 dark:bg-gray-700">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-1/2">
                                Title
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-1/4">
                                Author
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-1/4">
                                CCLI Number
                            </th>
                        </tr>
                    </thead>
                    <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                        {items.map((item) => (
                            // `relative` makes the row the box the link's
                            // overlay fills; `transform-gpu` does the same in
                            // Safari, which ignored `relative` on table rows
                            // until 2026 (WebKit bug 240961).
                            <tr
                                key={item.id}
                                className="relative transform-gpu hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors cursor-pointer"
                            >
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                                    <Link
                                        href={routes.planItem(
                                            serviceType.id,
                                            plan.id,
                                            item.id
                                        )}
                                        className="after:absolute after:inset-0"
                                    >
                                        {item.title}
                                    </Link>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                                    {authorFor(item)}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                                    {ccliNumberFor(item)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <div className="mt-6 text-center">
                <p className="text-sm text-gray-600 dark:text-gray-300">
                    Total Items: {items.length}
                </p>
            </div>
        </>
    );
}
