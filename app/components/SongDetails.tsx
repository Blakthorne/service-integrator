"use client";

import React from "react";
import SongCopyright from "./SongCopyright";

interface SongDetails {
    id: string;
    title: string;
    author: string;
    ccliNumber: number;
    copyright: string;
    notes: string;
    themes: string;
    createdAt: string;
    updatedAt: string;
    planningCenterUrl: string;
}

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

interface SongDetailsProps {
    item: PlanItem;
    songDetails: SongDetails | undefined;
    onBack: () => void;
}

export default function SongDetails({
    item,
    songDetails,
    onBack,
}: SongDetailsProps): React.ReactElement {
    return (
        <div className="w-full">
            <div className="flex items-center justify-between mb-6">
                <button
                    onClick={onBack}
                    className="flex items-center gap-2 px-4 py-2 text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-100 transition-colors"
                >
                    ← Back to Plan Items
                </button>
                <div className="flex items-center gap-4">
                    <div className="text-right">
                        <p className="text-gray-600 dark:text-gray-300">
                            {item.title}
                        </p>
                    </div>
                    {songDetails && (
                        <a
                            href={
                                "https://services.planningcenteronline.com/songs/" +
                                songDetails.id
                            }
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors"
                        >
                            View in Planning Center
                        </a>
                    )}
                </div>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <h3 className="text-lg font-medium mb-4">
                            Basic Information
                        </h3>
                        <dl className="space-y-3">
                            <div>
                                <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                                    Title
                                </dt>
                                <dd className="text-sm text-gray-900 dark:text-gray-100">
                                    {item.title}
                                </dd>
                            </div>
                            <div>
                                <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                                    Type
                                </dt>
                                <dd className="text-sm text-gray-900 dark:text-gray-100 capitalize">
                                    {item.itemType}
                                </dd>
                            </div>
                            <div>
                                <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                                    Position
                                </dt>
                                <dd className="text-sm text-gray-900 dark:text-gray-100 capitalize">
                                    {item.servicePosition}
                                </dd>
                            </div>
                            <div>
                                <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                                    Sequence
                                </dt>
                                <dd className="text-sm text-gray-900 dark:text-gray-100">
                                    {item.sequence}
                                </dd>
                            </div>
                        </dl>
                    </div>
                    <div>
                        <h3 className="text-lg font-medium mb-4">
                            Additional Details
                        </h3>
                        <dl className="space-y-3">
                            <div>
                                <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                                    Key
                                </dt>
                                <dd className="text-sm text-gray-900 dark:text-gray-100">
                                    {item.keyName || "Not specified"}
                                </dd>
                            </div>
                            <div>
                                <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                                    Length
                                </dt>
                                <dd className="text-sm text-gray-900 dark:text-gray-100">
                                    {item.length || "Not specified"}
                                </dd>
                            </div>
                            <div>
                                <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                                    Description
                                </dt>
                                <dd className="text-sm text-gray-900 dark:text-gray-100">
                                    {item.description ||
                                        "No description available"}
                                </dd>
                            </div>
                        </dl>
                    </div>
                </div>

                {item.itemType === "song" && songDetails && (
                    <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700">
                        <h3 className="text-lg font-medium mb-4">
                            Song Details
                        </h3>
                        <dl className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-3">
                                <div>
                                    <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                                        Author
                                    </dt>
                                    <dd className="text-sm text-gray-900 dark:text-gray-100">
                                        {songDetails.author}
                                    </dd>
                                </div>
                                <div>
                                    <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                                        CCLI Number
                                    </dt>
                                    <dd className="text-sm text-gray-900 dark:text-gray-100">
                                        {songDetails.ccliNumber}
                                    </dd>
                                </div>
                                <div>
                                    <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                                        Copyright
                                    </dt>
                                    <dd className="text-sm text-gray-900 dark:text-gray-100">
                                        {songDetails.copyright}
                                    </dd>
                                </div>
                            </div>
                            <div className="space-y-3">
                                <div>
                                    <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                                        Themes
                                    </dt>
                                    <dd className="text-sm text-gray-900 dark:text-gray-100">
                                        {songDetails.themes ||
                                            "No themes specified"}
                                    </dd>
                                </div>
                                <div>
                                    <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                                        Notes
                                    </dt>
                                    <dd className="text-sm text-gray-900 dark:text-gray-100 whitespace-pre-wrap">
                                        {songDetails.notes ||
                                            "No notes available"}
                                    </dd>
                                </div>
                            </div>
                        </dl>
                    </div>
                )}

                {item.itemType === "song" && songDetails && (
                    <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700">
                        <h3 className="text-lg font-medium mb-4">
                            Copyright Information
                        </h3>
                        <div className="mt-4">
                            <SongCopyright
                                title={songDetails.title}
                                author={songDetails.author}
                                copyright={songDetails.copyright}
                                showCopyButton={true}
                            />
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
