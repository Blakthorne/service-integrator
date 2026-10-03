"use client";

import { useState } from "react";
import { formatCopyrightText, type CopyrightSong } from "@/lib/copyright";

type SongCopyrightProps = CopyrightSong & {
    showContainer?: boolean;
    showCopyButton?: boolean;
};

export default function SongCopyright({
    title,
    author,
    copyright,
    admin,
    showContainer = true,
    showCopyButton = false,
}: SongCopyrightProps): React.ReactElement {
    const [showCopyTooltip, setShowCopyTooltip] = useState(false);
    const copyrightText = formatCopyrightText({
        title,
        author,
        copyright,
        admin,
    });

    const handleCopy = () => {
        navigator.clipboard.writeText(copyrightText).then(
            () => {
                setShowCopyTooltip(true);
                setTimeout(() => {
                    setShowCopyTooltip(false);
                }, 2000);
            },
            (err) => {
                console.error("Failed to copy:", err);
            }
        );
    };

    if (!showContainer) {
        return (
            <p className="text-sm text-gray-900 dark:text-gray-100 whitespace-pre-line">
                {copyrightText}
            </p>
        );
    }

    return (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
            <div className="flex justify-between items-start gap-4">
                <p className="text-sm text-gray-900 dark:text-gray-100 whitespace-pre-line">
                    {copyrightText}
                </p>
                {showCopyButton && (
                    <div className="relative flex-shrink-0">
                        <button
                            onClick={handleCopy}
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
                )}
            </div>
        </div>
    );
}
