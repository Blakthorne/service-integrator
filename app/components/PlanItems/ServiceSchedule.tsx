"use client";

import CopyButton from "../ui/CopyButton";
import type {
    CatalogMatch,
    LinkSuggestion,
    PlanItemWithSong,
    ScheduleSelection,
} from "@/lib/domain";
import { catalogUnavailableMessage, scheduleSongView } from "@/lib/scheduleCards";
import type { ChooseOption, SetCustomText } from "@/lib/scheduleSelections";
import { buildScheduleCopyText } from "@/lib/serviceSchedule";
import type { LinkSong } from "./LinkToCatalogInline";
import ScheduleSongCard from "./ScheduleSongCard";

/** Props of ServiceSchedule. */
export interface ServiceScheduleProps {
    /** The plan's items with their selections (see `mergeScheduleSelections`). */
    items: (PlanItemWithSong & ScheduleSelection)[];
    /**
     * The catalog song each song item's Planning Center song is linked to,
     * by Planning Center song id.
     */
    catalog: Record<string, CatalogMatch>;
    /** Suggestions for each Planning Center song that is not linked, by its id. */
    suggestions: Record<string, LinkSuggestion[]>;
    /** Why the catalog could not be read, or null; the tab then says numbers can't be shown. */
    catalogError: string | null;
    serviceTypeName: string;
    /** The plan's calendar date as `YYYY-MM-DD`, or null when it is unknown. */
    planDate: string | null;
    /** This tab's address, where the new-song form comes back to. */
    scheduleHref: string;
    /** Called when a song's option is chosen. */
    onChooseOption: ChooseOption;
    /** Called with a song's custom text once typing pauses. */
    onCustomTextChange: SetCustomText;
    /** Links a song's Planning Center song to a suggested catalog song. */
    onLink: LinkSong;
}

/**
 * The Service Schedule tab: a card per song item, in sequence order, with
 * its numbers from its catalog link or a way to link it, and the choices for
 * its line (see `ScheduleSongCard`); a "Copy All" button for the schedule
 * text; and, when the catalog cannot be read, a quiet banner saying so. It
 * holds no selections itself; they come in with `items` and changes go out
 * through the callbacks.
 */
export default function ServiceSchedule({
    items,
    catalog,
    suggestions,
    catalogError,
    serviceTypeName,
    planDate,
    scheduleHref,
    onChooseOption,
    onCustomTextChange,
    onLink,
}: ServiceScheduleProps) {
    const catalogState = { catalog, suggestions, catalogError };
    return (
        <div>
            <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
                    Service Schedule
                </h2>
                <div className="flex items-center gap-4">
                    <div className="relative">
                        <CopyButton
                            text={buildScheduleCopyText({
                                items,
                                catalog,
                                serviceTypeName,
                                planDate,
                            })}
                        />
                    </div>
                </div>
            </div>
            {catalogError !== null && (
                <p className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
                    {catalogUnavailableMessage(catalogError)}
                </p>
            )}
            <div className="space-y-4">
                {items
                    .filter((item) => item.itemType === "song")
                    .sort((a, b) => a.sequence - b.sequence)
                    .map((item) => (
                        <ScheduleSongCard
                            key={item.id}
                            item={item}
                            view={scheduleSongView(item, catalogState)}
                            scheduleHref={scheduleHref}
                            onChooseOption={onChooseOption}
                            onCustomTextChange={onCustomTextChange}
                            onLink={onLink}
                        />
                    ))}
            </div>
        </div>
    );
}
