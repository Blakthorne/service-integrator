"use client";

import React from "react";
import CopyButton from "./ui/CopyButton";
import SongCopyright from "./SongCopyright";
import { formatCopyrightText } from "@/lib/copyright";
import type { PlanItem, Song } from "@/lib/domain";

interface SongDetailsProps {
    item: PlanItem;
    songDetails: Song | undefined;
    onBack: () => void;
}

export default function SongDetails({
    item,
    songDetails,
    onBack,
}: SongDetailsProps): React.ReactElement {
    return (
        <div className="w-full">
            <div className="mb-6">
                {/* Mobile Header */}
                <div className="sm:hidden">
                    <button
                        onClick={onBack}
                        className="flex items-center gap-2 px-4 py-2 mb-4 text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-100 transition-colors cursor-pointer"
                    >
                        ← Back to Plan Items
                    </button>
                    <div className="flex flex-col gap-4 px-4">
                        <div className="flex items-baseline justify-center gap-2">
                            <span className="text-gray-600 dark:text-gray-300">
                                {item.title}
                            </span>
                        </div>
                        {songDetails && (
                            <a
                                href={
                                    "https://services.planningcenteronline.com/songs/" +
                                    songDetails.id
                                }
                                target="_blank"
                                rel="noopener noreferrer"
                                className="w-full px-4 py-2 bg-gray-500 text-white text-center rounded-lg hover:bg-gray-600 transition-colors"
                            >
                                View in Planning Center
                            </a>
                        )}
                    </div>
                </div>

                {/* Desktop Header */}
                <div className="hidden sm:flex items-center justify-between">
                    <button
                        onClick={onBack}
                        className="flex items-center gap-2 px-4 py-2 text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-100 transition-colors cursor-pointer"
                    >
                        ← Back to Plan Items
                    </button>
                    <div className="flex items-center gap-6">
                        <div className="flex items-baseline gap-2">
                            <span className="text-gray-600 dark:text-gray-300">
                                {item.title}
                            </span>
                        </div>
                        {songDetails && (
                            <a
                                href={
                                    "https://services.planningcenteronline.com/songs/" +
                                    songDetails.id
                                }
                                target="_blank"
                                rel="noopener noreferrer"
                                className="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors whitespace-nowrap"
                            >
                                View in Planning Center
                            </a>
                        )}
                    </div>
                </div>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden p-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">
                            Song Details
                        </h2>
                        <dl className="space-y-4">
                            <div>
                                <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                                    Title
                                </dt>
                                <dd className="mt-1 text-gray-900 dark:text-gray-100">
                                    {item.title}
                                </dd>
                            </div>
                            {songDetails && (
                                <>
                                    <div>
                                        <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                                            Author
                                        </dt>
                                        <dd className="mt-1 text-gray-900 dark:text-gray-100">
                                            {songDetails.author}
                                        </dd>
                                    </div>
                                    <div>
                                        <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                                            CCLI Number
                                        </dt>
                                        <dd className="mt-1 text-gray-900 dark:text-gray-100">
                                            {songDetails.ccliNumber || "-"}
                                        </dd>
                                    </div>
                                    <div>
                                        <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                                            Copyright
                                        </dt>
                                        <dd className="mt-1 text-gray-900 dark:text-gray-100">
                                            {songDetails.copyright || "-"}
                                        </dd>
                                    </div>
                                    <div>
                                        <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                                            Administration
                                        </dt>
                                        <dd className="mt-1 text-gray-900 dark:text-gray-100">
                                            {songDetails.admin || "-"}
                                        </dd>
                                    </div>
                                </>
                            )}
                        </dl>
                    </div>

                    {songDetails && (
                        <div>
                            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">
                                Additional Information
                            </h2>
                            <dl className="space-y-4">
                                <div>
                                    <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                                        Notes
                                    </dt>
                                    <dd className="mt-1 text-gray-900 dark:text-gray-100 whitespace-pre-wrap">
                                        {songDetails.notes || "-"}
                                    </dd>
                                </div>
                                <div>
                                    <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                                        Themes
                                    </dt>
                                    <dd className="mt-1 text-gray-900 dark:text-gray-100">
                                        {songDetails.themes || "-"}
                                    </dd>
                                </div>
                            </dl>
                        </div>
                    )}
                </div>

                {songDetails && (
                    <div className="mt-8 pt-8 border-t border-gray-200 dark:border-gray-700">
                        <div className="flex items-center justify-between mb-6">
                            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                                Copyright Information
                            </h2>
                            <div className="flex items-center gap-4">
                                <CopyButton
                                    label="Copy"
                                    text={formatCopyrightText({
                                        title: songDetails.title,
                                        author: songDetails.author,
                                        admin: songDetails.admin,
                                        copyright: songDetails.copyright,
                                    })}
                                />
                            </div>
                        </div>
                        <SongCopyright
                            title={songDetails.title}
                            author={songDetails.author}
                            copyright={songDetails.copyright}
                            admin={songDetails.admin}
                        />
                    </div>
                )}
            </div>
        </div>
    );
}
