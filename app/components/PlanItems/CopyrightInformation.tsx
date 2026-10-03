"use client";

import { useState } from "react";
import CopyButton from "./CopyButton";
import { PlanItem } from "./PlanItems";
import { SongDetailsType } from "../SongDetails";
import SongCopyright from "../SongCopyright";
import {
    buildCopyrightCopyAllText,
    getItemCopyrightInfo,
} from "@/lib/copyright";

export default function CopyrightInformation({
    items,
    includedSongs,
}: {
    items: PlanItem[];
    includedSongs: SongDetailsType[];
}): React.ReactNode {
    const [showCopyTooltip, setShowCopyTooltip] = useState<boolean>(false);

    return (
        <div>
            <div className="flex items-center justify-between mb-6">
                <h3 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
                    Copyright Information
                </h3>
                <div className="flex items-center gap-4">
                    <CopyButton
                        text={buildCopyrightCopyAllText(items, includedSongs)}
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
