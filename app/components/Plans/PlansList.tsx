"use client";

import Link from "next/link";
import Pagination from "../ui/Pagination";
import { useUrlState } from "@/app/hooks/useUrlState";
import { formatPlanDateHeading } from "@/lib/format";
import { routes } from "@/lib/routes";
import { parsePage } from "@/lib/urlState";
import type { PlanSummary } from "@/lib/domain";

/** How many dates each page of the list shows. */
const DATES_PER_PAGE = 25;

interface PlansListProps {
    /** The dates (`YYYY-MM-DD`) that have plans, newest first. */
    dates: string[];
    /** The plans on each date, in service-type order. */
    plansByDate: Record<string, PlanSummary[]>;
}

/**
 * Every plan, grouped by date, 25 dates a page. The server loads the plans;
 * this only pages through them. The page number lives in `?page=` (page 1
 * has none), changed without a server round trip, and each page change adds a
 * history entry, so Back returns to the previous page. Each row links to the
 * plan's page: the service type is a real link stretched over the row.
 */
export default function PlansList({
    dates,
    plansByDate,
}: PlansListProps): React.ReactElement {
    const { searchParams, setSearchParams } = useUrlState();

    const totalPages = Math.ceil(dates.length / DATES_PER_PAGE);
    const currentPage = parsePage(searchParams.get("page"), totalPages);

    const startIndex = (currentPage - 1) * DATES_PER_PAGE;
    const endIndex = startIndex + DATES_PER_PAGE;
    const currentDates = dates.slice(startIndex, endIndex);

    function handlePageChange(page: number) {
        setSearchParams(
            { page: page === 1 ? null : String(page) },
            { history: "push" }
        );
    }

    return (
        <div className="w-full space-y-8">
            {totalPages > 1 && (
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm overflow-hidden px-4">
                    <Pagination
                        currentPage={currentPage}
                        totalPages={totalPages}
                        onPageChange={handlePageChange}
                    />
                </div>
            )}

            {currentDates.map((date) => (
                <div
                    key={date}
                    className="bg-white dark:bg-gray-800 rounded-lg shadow-sm overflow-hidden"
                >
                    <div className="px-6 py-4 bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600">
                        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">
                            {formatPlanDateHeading(date)}
                        </h3>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-gray-50 dark:bg-gray-700">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-2/3">
                                        Service Type
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-1/3">
                                        Items
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                                {plansByDate[date].map((plan: PlanSummary) => (
                                    // `relative` makes the row the box the
                                    // link's overlay fills; `transform-gpu`
                                    // does the same in Safari, which ignored
                                    // `relative` on table rows until 2026
                                    // (WebKit bug 240961).
                                    <tr
                                        key={plan.id}
                                        className="relative transform-gpu hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors cursor-pointer"
                                    >
                                        <td className="px-6 py-4 text-sm text-gray-900 dark:text-gray-100">
                                            {/* No prefetch: a page of rows would each load a plan from PCO. */}
                                            <Link
                                                prefetch={false}
                                                href={routes.plan(
                                                    plan.serviceType.id,
                                                    plan.id
                                                )}
                                                className="after:absolute after:inset-0"
                                            >
                                                {plan.serviceType.name}
                                            </Link>
                                        </td>
                                        <td className="px-6 py-4 text-sm text-gray-900 dark:text-gray-100">
                                            {plan.itemsCount} items
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            ))}

            {totalPages > 1 && (
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm overflow-hidden px-4 mt-8">
                    <Pagination
                        currentPage={currentPage}
                        totalPages={totalPages}
                        onPageChange={handlePageChange}
                    />
                </div>
            )}
        </div>
    );
}
