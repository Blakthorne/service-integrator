"use client";

import CopyButton from "../ui/CopyButton";
import SongCopyright from "../SongCopyright";
import {
    buildCopyrightCopyAllText,
    getItemCopyrightInfo,
} from "@/lib/copyright";
import type { PlanItem, Song } from "@/lib/domain";

export default function CopyrightInformation({
    items,
    includedSongs,
}: {
    items: PlanItem[];
    includedSongs: Song[];
}): React.ReactNode {
    return (
        <div>
            <div className="flex items-center justify-between mb-6">
                <h3 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
                    Copyright Information
                </h3>
                <div className="flex items-center gap-4">
                    <CopyButton
                        text={buildCopyrightCopyAllText(items, includedSongs)}
                    />
                </div>
            </div>
            <div className="flex flex-col space-y-4 max-w-3xl mx-auto">
                {items
                    .filter((item) => item.itemType === "song")
                    .sort((a, b) => a.sequence - b.sequence)
                    .map((item) => {
                        const songInfo = getItemCopyrightInfo(
                            item,
                            includedSongs
                        );
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
