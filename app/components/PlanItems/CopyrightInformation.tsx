"use client";

import CopyButton from "../ui/CopyButton";
import {
    buildCopyrightCopyAllText,
    formatCopyrightText,
    getItemCopyrightInfo,
} from "@/lib/copyright";
import type { PlanItemWithSong } from "@/lib/domain";
import { settingsUnavailableMessage } from "@/lib/scheduleCards";
import type { CopyrightSettings } from "@/lib/settings";
import PlanNotice from "./PlanNotice";

/** One song's copyright block, as Copy All copies it. */
function CopyrightBlock({ text }: { text: string }) {
    return (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
            <p className="text-sm text-gray-900 dark:text-gray-100 whitespace-pre-line">{text}</p>
        </div>
    );
}

interface CopyrightInformationProps {
    items: PlanItemWithSong[];
    /** The settings the blocks follow: the CCLI license number. */
    settings: CopyrightSettings;
    /** Why the settings could not be read, or null; the tab then says the text uses the defaults. */
    settingsError: string | null;
}

/**
 * The Copyright Information tab: the copyright block of every song item, in
 * sequence order, and a "Copy All" button for all of them, each block with
 * the CCLI license number from the settings, so what is shown is what is
 * copied. Each item's block comes from the song it was joined to by PCO ID,
 * so an item renamed in the plan still gets one. When the settings cannot
 * be read, a quiet banner says the text uses the defaults.
 */
export default function CopyrightInformation({
    items,
    settings,
    settingsError,
}: CopyrightInformationProps): React.ReactNode {
    return (
        <div>
            <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
                    Copyright Information
                </h2>
                <div className="flex items-center gap-4">
                    <CopyButton text={buildCopyrightCopyAllText(items, settings)} />
                </div>
            </div>
            {settingsError !== null && (
                <PlanNotice>{settingsUnavailableMessage(settingsError)}</PlanNotice>
            )}
            <div className="flex flex-col space-y-4 max-w-3xl mx-auto">
                {items
                    .filter((item) => item.itemType === "song")
                    .sort((a, b) => a.sequence - b.sequence)
                    .map((item) => {
                        const songInfo = getItemCopyrightInfo(item);
                        if (!songInfo) return null;

                        return (
                            <CopyrightBlock
                                key={item.id}
                                text={formatCopyrightText(songInfo, settings)}
                            />
                        );
                    })}
            </div>
        </div>
    );
}
