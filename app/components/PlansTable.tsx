"use client";

import { useState, useEffect } from "react";

interface Plan {
    id: string;
    dates: string;
    shortDates: string;
    planningCenterUrl: string;
    itemsCount: number;
    title: string | null;
    sortDate: string;
    createdAt: string;
    updatedAt: string;
    serviceType: {
        id: string;
        name: string;
    };
}

interface PlansTableProps {
    onPlanSelect: (plan: Plan, serviceTypeId: string) => void;
}

interface PaginationProps {
    currentPage: number;
    totalPages: number;
    onPageChange: (page: number) => void;
}

function Pagination({
    currentPage,
    totalPages,
    onPageChange,
}: PaginationProps) {
    return (
        <div className="flex justify-between items-center py-4">
            <button
                onClick={() => onPageChange(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1}
                className="px-3 sm:px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed min-w-[80px] sm:min-w-[100px]"
            >
                Previous
            </button>
            {/* Desktop pagination */}
            <div className="hidden sm:flex items-center space-x-4">
                <div className="flex space-x-1">
                    {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                        let pageNum;
                        if (totalPages <= 5) {
                            pageNum = i + 1;
                        } else if (currentPage <= 3) {
                            pageNum = i + 1;
                        } else if (currentPage >= totalPages - 2) {
                            pageNum = totalPages - 4 + i;
                        } else {
                            pageNum = currentPage - 2 + i;
                        }
                        return (
                            <button
                                key={i}
                                onClick={() => onPageChange(pageNum)}
                                className={`px-3 py-2 text-sm font-medium rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                                    currentPage === pageNum
                                        ? "bg-blue-500 text-white"
                                        : "text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600"
                                }`}
                            >
                                {pageNum}
                            </button>
                        );
                    })}
                </div>
                <span className="text-sm text-gray-600 dark:text-gray-400">
                    of {totalPages}
                </span>
            </div>
            {/* Mobile pagination info */}
            <div className="flex sm:hidden items-center justify-center min-w-[100px]">
                <span className="text-sm text-gray-600 dark:text-gray-400">
                    {currentPage} / {totalPages}
                </span>
            </div>
            <button
                onClick={() =>
                    onPageChange(Math.min(totalPages, currentPage + 1))
                }
                disabled={currentPage === totalPages}
                className="px-3 sm:px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed min-w-[80px] sm:min-w-[100px]"
            >
                Next
            </button>
        </div>
    );
}

export default function PlansTable({
    onPlanSelect,
}: PlansTableProps): React.ReactElement {
    const [plansByDate, setPlansByDate] = useState<{ [key: string]: Plan[] }>(
        {}
    );
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const [currentPage, setCurrentPage] = useState<number>(1);
    const itemsPerPage = 25; // Fixed number of items per page for consistent UX

    useEffect(() => {
        const fetchPlans = async (): Promise<void> => {
            try {
                setLoading(true);
                const baseUrl =
                    process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
                const response = await fetch(`${baseUrl}/api/all-plans`);

                if (!response.ok) {
                    throw new Error(
                        `Failed to fetch plans: ${response.status}`
                    );
                }

                const data = await response.json();
                setPlansByDate(data.plansByDate);
                setCurrentPage(1);
            } catch (err: unknown) {
                setError("Failed to fetch plans");
                console.error("Error fetching plans:", err);
            } finally {
                setLoading(false);
            }
        };

        fetchPlans();
    }, []);

    const formatDate = (dateString: string): string => {
        return new Date(dateString + "T00:00:00").toLocaleDateString("en-US", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
        });
    };

    const dates = Object.keys(plansByDate).sort((a, b) => b.localeCompare(a));
    const totalDates = dates.length;
    const totalPages = Math.ceil(totalDates / itemsPerPage);

    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const currentDates = dates.slice(startIndex, endIndex);

    if (loading) {
        return (
            <div className="text-center py-12">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
                <p className="text-gray-600 dark:text-gray-300">
                    Loading plans...
                </p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="text-center py-12">
                <p className="text-red-600 dark:text-red-400 mb-4">{error}</p>
                <button
                    onClick={() => window.location.reload()}
                    className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
                >
                    Try Again
                </button>
            </div>
        );
    }

    return (
        <div className="w-full space-y-8">
            {totalPages > 1 && (
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm overflow-hidden px-4">
                    <Pagination
                        currentPage={currentPage}
                        totalPages={totalPages}
                        onPageChange={setCurrentPage}
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
                            {formatDate(date)}
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
                                {plansByDate[date].map((plan: Plan) => (
                                    <tr
                                        key={plan.id}
                                        onClick={() =>
                                            onPlanSelect(
                                                plan,
                                                plan.serviceType.id
                                            )
                                        }
                                        className="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors cursor-pointer"
                                    >
                                        <td className="px-6 py-4 text-sm text-gray-900 dark:text-gray-100">
                                            {plan.serviceType.name}
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
                        onPageChange={setCurrentPage}
                    />
                </div>
            )}
        </div>
    );
}
