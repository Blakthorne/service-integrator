"use client";

import { useState, useEffect } from "react";
import { SongDetailsType } from "../SongDetails";
import ServiceSchedule from "./ServiceSchedule";
import CopyrightInformation from "./CopyrightInformation";

export interface PlanItem {
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
    selectedOption?: "Leave blank" | "Custom";
    customText?: string;
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

export interface HymnVersion {
    id: string;
    tune_name: string;
    rejoice_hymns_number: string;
    great_hymns_number: string;
    selected: boolean;
}

export interface HymnData {
    song_title: string;
    versions: HymnVersion[];
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
    const [activeTab, setActiveTab] = useState<"copyright" | "schedule">(
        "copyright"
    );
    const [hymnData, setHymnData] = useState<HymnData[]>([]);

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

                // After fetching items, get the hymn data for songs
                const songTitles: string[] = (data.items as PlanItem[])
                    .filter((item: PlanItem) => item.itemType === "song")
                    .map((item: PlanItem) => item.title);

                if (songTitles.length > 0) {
                    try {
                        const hymnResponse = await fetch("/api/hymns", {
                            method: "POST",
                            headers: {
                                "Content-Type": "application/json",
                            },
                            body: JSON.stringify({ titles: songTitles }),
                        });
                        if (!hymnResponse.ok) {
                            throw new Error(
                                `Failed to fetch hymn data: ${hymnResponse.status}`
                            );
                        }
                        const hymnData = await hymnResponse.json();
                        // Ensure each hymn has at least one version selected
                        const processedHymnData = hymnData.hymns.map(
                            (hymn: HymnData) => ({
                                ...hymn,
                                versions: hymn.versions.map(
                                    (version: HymnVersion, index: number) => ({
                                        ...version,
                                        selected: index === 0, // Select first version by default
                                    })
                                ),
                            })
                        );
                        setHymnData(processedHymnData);
                    } catch (err) {
                        console.error("Error fetching hymn data:", err);
                    }
                }
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

    // TabButton component for tab selection
    const TabButton = ({
        onClick,
        isActive,
        children,
    }: {
        onClick: () => void;
        isActive: boolean;
        children: React.ReactNode;
    }) => (
        <button
            onClick={onClick}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors cursor-pointer ${
                isActive
                    ? "bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white"
                    : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
            }`}
        >
            {children}
        </button>
    );

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

            {/* Tabbed Interface */}
            <div className="mt-12 pt-8 border-t border-gray-200 dark:border-gray-700">
                <div className="flex space-x-4 mb-6">
                    <TabButton
                        onClick={() => setActiveTab("copyright")}
                        isActive={activeTab === "copyright"}
                    >
                        Copyright Information
                    </TabButton>
                    <TabButton
                        onClick={() => setActiveTab("schedule")}
                        isActive={activeTab === "schedule"}
                    >
                        Service Schedule
                    </TabButton>
                </div>

                {/* Copyright Information Tab */}
                {activeTab === "copyright" && (
                    <CopyrightInformation
                        items={items}
                        includedSongs={includedSongs}
                    />
                )}
                {activeTab === "schedule" && (
                    <ServiceSchedule
                        items={items}
                        setItems={setItems}
                        hymnData={hymnData}
                    />
                )}
            </div>
        </div>
    );
}
