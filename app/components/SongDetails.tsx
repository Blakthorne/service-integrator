"use client";

import React, { useState } from "react";
import SongCopyright, { formatCopyrightText } from "./SongCopyright";

export interface SongDetailsType {
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
    admin: string | null;
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
    songDetails: SongDetailsType | undefined;
    onBack: () => void;
}

export default function SongDetails({
    item,
    songDetails,
    onBack,
}: SongDetailsProps): React.ReactElement {
    const [showCopyTooltip, setShowCopyTooltip] = useState<boolean>(false);
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
                                href={songDetails.planningCenterUrl}
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
                                <div className="relative">
                                    <button
                                        onClick={async () => {
                                            const textToCopy =
                                                formatCopyrightText({
                                                    title: songDetails.title,
                                                    author: songDetails.author,
                                                    admin: songDetails.admin,
                                                    copyright:
                                                        songDetails.copyright,
                                                });
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
                                                    textArea.style.position =
                                                        "fixed";
                                                    textArea.style.opacity =
                                                        "0";
                                                    document.body.appendChild(
                                                        textArea
                                                    );
                                                    textArea.focus();
                                                    textArea.select();
                                                    try {
                                                        document.execCommand(
                                                            "copy"
                                                        );
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
                                                console.error(
                                                    "Failed to copy:",
                                                    err
                                                );
                                            }
                                        }}
                                        className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-100 transition-colors bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 cursor-pointer"
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
                                        Copy
                                    </button>
                                    {showCopyTooltip && (
                                        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 text-white text-xs rounded whitespace-nowrap">
                                            Copied!
                                        </div>
                                    )}
                                </div>
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
