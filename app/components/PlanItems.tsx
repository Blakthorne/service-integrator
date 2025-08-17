"use client";

import { useState, useEffect } from "react";
import SongCopyright, { formatCopyrightText } from "./SongCopyright";
import { SongDetailsType } from "./SongDetails";

interface PlanItem {
    id: string;
    title: string;
    itemType: string;
    sequence: number;
    servicePosition: string;
    keyName: string | null;
    length: number;
    description: string | null;
    createdAt: string;
    updatedAt: string;
}

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
}

interface PlanItemsProps {
    plan: Plan;
    serviceTypeId: string;
    serviceTypeName: string;
    onBack: () => void;
    onItemSelect: (item: PlanItem, songDetails?: SongDetailsType) => void;
}

export default function PlanItems({
    plan,
    serviceTypeId,
    serviceTypeName,
    onBack,
    onItemSelect,
}: PlanItemsProps): React.ReactElement {
    const [items, setItems] = useState<PlanItem[]>([]);
    const [includedSongs, setIncludedSongs] = useState<SongDetailsType[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const [showCopyTooltip, setShowCopyTooltip] = useState<boolean>(false);

    useEffect(() => {
        // Fetch plan items from the API
        const fetchData = async (): Promise<void> => {
            try {
                setLoading(true);
                const baseUrl: string =
                    process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";

                const response: Response = await fetch(
                    `${baseUrl}/api/plan-items?serviceTypeId=${serviceTypeId}&planId=${plan.id}`
                );

                if (!response.ok) {
                    throw new Error(
                        `Failed to fetch plan items: ${response.status}`
                    );
                }

                const data: {
                    items: PlanItem[];
                    included: SongDetailsType[];
                    totalCount: number;
                } = await response.json();
                setItems(data.items || []);
                setIncludedSongs(data.included || []);
            } catch (err: unknown) {
                setError("Failed to fetch plan items");
                console.error("Error fetching plan items:", err);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [plan.id, serviceTypeId]);

    // Helper function to get author for an item
    const getAuthorForItem = (item: PlanItem): string => {
        if (item.itemType === "song") {
            const song = includedSongs.find(
                (song) => song.title === item.title
            );
            return song?.author || "Unknown";
        }
        return "-";
    };

    // Helper function to get CCLI number for an item
    const getCcliNumberForItem = (item: PlanItem): string => {
        if (item.itemType === "song") {
            const song = includedSongs.find(
                (song) => song.title === item.title
            );
            return song?.ccliNumber?.toString() || "-";
        }
        return "-";
    };

    // Helper function to get copyright info for an item
    const getItemCopyrightInfo = (
        item: PlanItem
    ): {
        title: string;
        author: string;
        copyright: string;
        admin: string | null;
    } | null => {
        if (item.itemType === "song") {
            const song = includedSongs.find(
                (song) => song.title === item.title
            );
            if (!song) return null;
            return {
                title: song.title,
                author: song.author,
                copyright: song.copyright,
                admin: song.admin,
            };
        }
        return null;
    };

    if (loading) {
        return (
            <div className="w-full">
                <div className="flex items-center justify-between mb-6">
                    <button
                        onClick={onBack}
                        className="flex items-center gap-2 px-4 py-2 text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-100 transition-colors cursor-pointer"
                    >
                        ← Back to Plans
                    </button>
                </div>

                <div className="text-center py-12">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
                    <p className="text-gray-600 dark:text-gray-300">
                        Loading plan items...
                    </p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="w-full">
                <div className="flex items-center justify-between mb-6">
                    <button
                        onClick={onBack}
                        className="flex items-center gap-2 px-4 py-2 text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-100 transition-colors cursor-pointer"
                    >
                        ← Back to Plans
                    </button>
                </div>

                <div className="text-center py-12">
                    <p className="text-red-600 dark:text-red-400 mb-4">
                        {error}
                    </p>
                    <button
                        onClick={() => window.location.reload()}
                        className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
                    >
                        Try Again
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="w-full">
            <div className="mb-6">
                {/* Mobile Header */}
                <div className="sm:hidden">
                    <button
                        onClick={onBack}
                        className="flex items-center gap-2 px-4 py-2 mb-4 text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-100 transition-colors cursor-pointer"
                    >
                        ← Back to Plans
                    </button>
                    <div className="flex flex-col gap-4 px-4">
                        <div className="flex items-baseline justify-center gap-2">
                            <span className="text-gray-600 dark:text-gray-300">
                                {plan.dates}
                            </span>
                            <span className="text-gray-600 dark:text-gray-300">
                                ·
                            </span>
                            <span className="text-gray-600 dark:text-gray-300">
                                {serviceTypeName}
                            </span>
                        </div>
                        <a
                            href={
                                "https://services.planningcenteronline.com/plans/" +
                                plan.id
                            }
                            target="_blank"
                            rel="noopener noreferrer"
                            className="w-full px-4 py-2 bg-gray-500 text-white text-center rounded-lg hover:bg-gray-600 transition-colors"
                        >
                            View in Planning Center
                        </a>
                    </div>
                </div>

                {/* Desktop Header */}
                <div className="hidden sm:flex items-center justify-between">
                    <button
                        onClick={onBack}
                        className="flex items-center gap-2 px-4 py-2 text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-100 transition-colors cursor-pointer"
                    >
                        ← Back to Plans
                    </button>
                    <div className="flex items-center gap-6">
                        <div className="flex items-baseline gap-2">
                            <span className="text-gray-600 dark:text-gray-300">
                                {plan.dates}
                            </span>
                            <span className="text-gray-600 dark:text-gray-300">
                                ·
                            </span>
                            <span className="text-gray-600 dark:text-gray-300">
                                {serviceTypeName}
                            </span>
                        </div>
                        <a
                            href={
                                "https://services.planningcenteronline.com/plans/" +
                                plan.id
                            }
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors whitespace-nowrap"
                        >
                            View in Planning Center
                        </a>
                    </div>
                </div>
            </div>

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
                        {items.map((item: PlanItem) => (
                            <tr
                                key={item.id}
                                className="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors cursor-pointer"
                                onClick={() => {
                                    const songDetails =
                                        item.itemType === "song"
                                            ? includedSongs.find(
                                                  (song) =>
                                                      song.title === item.title
                                              )
                                            : undefined;
                                    onItemSelect(item, songDetails);
                                }}
                            >
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                                    {item.title}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                                    {getAuthorForItem(item)}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                                    {getCcliNumberForItem(item)}
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

            {/* Copyright Information Section */}
            <div className="mt-12 pt-8 border-t border-gray-200 dark:border-gray-700">
                <div className="flex items-center justify-between mb-6">
                    <h3 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
                        Copyright Information
                    </h3>
                    <div className="flex items-center gap-4">
                        <div className="relative">
                            <button
                                onClick={async () => {
                                    const songItems = items
                                        .filter(
                                            (item) => item.itemType === "song"
                                        )
                                        .sort((a, b) => a.sequence - b.sequence)
                                        .map((item) => {
                                            const info =
                                                getItemCopyrightInfo(item);
                                            return info
                                                ? formatCopyrightText(info)
                                                : null;
                                        })
                                        .filter(
                                            (info): info is string =>
                                                info !== null
                                        );

                                    const textToCopy = songItems.join("\n\n");
                                    try {
                                        if (
                                            navigator.clipboard &&
                                            window.isSecureContext
                                        ) {
                                            // Modern API for secure contexts
                                            await navigator.clipboard.writeText(
                                                textToCopy
                                            );
                                        } else {
                                            // Fallback for older browsers or non-secure contexts
                                            const textArea =
                                                document.createElement(
                                                    "textarea"
                                                );
                                            textArea.value = textToCopy;
                                            textArea.style.position = "fixed";
                                            textArea.style.opacity = "0";
                                            document.body.appendChild(textArea);
                                            textArea.focus();
                                            textArea.select();
                                            try {
                                                document.execCommand("copy");
                                            } finally {
                                                document.body.removeChild(
                                                    textArea
                                                );
                                            }
                                        }
                                        setShowCopyTooltip(true);
                                        setTimeout(() => {
                                            setShowCopyTooltip(false);
                                        }, 2000);
                                    } catch (err) {
                                        console.error("Failed to copy:", err);
                                    }
                                }}
                                className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-100 transition-colors bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 cursor-pointer whitespace-nowrap"
                            >
                                <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    className="h-4 w-4"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                >
                                    <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2"
                                    />
                                </svg>
                                Copy All
                            </button>
                            {showCopyTooltip && (
                                <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 text-white text-xs rounded whitespace-nowrap">
                                    Copied!
                                </div>
                            )}
                        </div>
                    </div>
                </div>
                <div className="flex flex-col space-y-4 max-w-3xl mx-auto">
                    {items
                        .filter((item) => item.itemType === "song")
                        .sort((a, b) => a.sequence - b.sequence)
                        .map((item) => {
                            const songInfo = getItemCopyrightInfo(item);
                            if (!songInfo) return null;

                            return (
                                <div key={item.id}>
                                    <SongCopyright {...songInfo} />
                                </div>
                            );
                        })}
                </div>
            </div>
        </div>
    );
}
