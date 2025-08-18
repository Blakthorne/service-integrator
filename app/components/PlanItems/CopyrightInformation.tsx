"use client";

import { useState } from "react";
import CopyButton from "./CopyButton";
import { PlanItem } from "./PlanItems";
import { SongDetailsType } from "../SongDetails";
import SongCopyright, { formatCopyrightText } from "../SongCopyright";

export default function CopyrightInformation({
    items,
    includedSongs,
}: {
    items: PlanItem[];
    includedSongs: SongDetailsType[];
}): React.ReactNode {
    const [showCopyTooltip, setShowCopyTooltip] = useState<boolean>(false);

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

    return (
        <div>
            <div className="flex items-center justify-between mb-6">
                <h3 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
                    Copyright Information
                </h3>
                <div className="flex items-center gap-4">
                    <CopyButton
                        text={items
                            .filter((item) => item.itemType === "song")
                            .sort((a, b) => a.sequence - b.sequence)
                            .map((item) => {
                                const info = getItemCopyrightInfo(item);
                                return info ? formatCopyrightText(info) : null;
                            })
                            .filter((info): info is string => info !== null)
                            .join("\n\n")}
                        showTooltip={showCopyTooltip}
                        setShowTooltip={setShowCopyTooltip}
                    />
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
