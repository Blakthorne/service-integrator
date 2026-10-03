"use client";

import CopyButton from "./ui/CopyButton";
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
    const copyrightText = formatCopyrightText({
        title,
        author,
        copyright,
        admin,
    });

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
                    <div className="flex-shrink-0">
                        <CopyButton label="Copy" text={copyrightText} />
                    </div>
                )}
            </div>
        </div>
    );
}
