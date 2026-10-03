"use client";

import CopyButton from "../ui/CopyButton";
import SongCopyright from "../SongCopyright";
import {
    buildCopyrightCopyAllText,
    getItemCopyrightInfo,
} from "@/lib/copyright";
import type { PlanItemWithSong } from "@/lib/domain";

/**
 * The Copyright Information tab: the copyright block of every song item, in
 * sequence order, and a "Copy All" button for all of them. Each item's block
 * comes from the song it was joined to by PCO ID, so an item renamed in the
 * plan still gets one.
 */
export default function CopyrightInformation({
    items,
}: {
    items: PlanItemWithSong[];
}): React.ReactNode {
    return (
        <div>
            <div className="flex items-center justify-between mb-6">
                <h3 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
                    Copyright Information
                </h3>
                <div className="flex items-center gap-4">
                    <CopyButton text={buildCopyrightCopyAllText(items)} />
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
    );
}
