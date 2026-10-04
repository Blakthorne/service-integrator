"use client";

import CopyButton from "../ui/CopyButton";
import type {
    CatalogMatch,
    LinkSuggestion,
    PlanItemWithSong,
    ScheduleSelection,
} from "@/lib/domain";
import {
    catalogUnavailableMessage,
    scheduleSongView,
    selectionsUnavailableMessage,
} from "@/lib/scheduleCards";
import type { ChooseOption, SetCustomText } from "@/lib/scheduleSelections";
import type { SelectionSaveState } from "@/lib/scheduleSelectionsStore";
import { buildScheduleCopyText } from "@/lib/serviceSchedule";
import type { LinkSong } from "./LinkToCatalogInline";
import type { RetrySave } from "./PlanProvider";
import ScheduleSongCard from "./ScheduleSongCard";

/** A quiet banner above the cards: what the tab cannot do, and why. */
function Notice({ children }: { children: React.ReactNode }) {
    return (
        <p className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
            {children}
        </p>
    );
}

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
    /** Why the saved choices could not be read, or null; the tab then says choices won't be saved. */
    selectionsError: string | null;
    /** How the saves of the changed songs stand, by item ID (see `SelectionSaveState`). */
    saves: Readonly<Record<string, SelectionSaveState>>;
    serviceTypeName: string;
    /** The plan's calendar date as `YYYY-MM-DD`, or null when it is unknown. */
    planDate: string | null;
    /** This tab's address, where the new-song form comes back to. */
    scheduleHref: string;
    /** Called when a song's option is chosen. */
    onChooseOption: ChooseOption;
    /** Called with a song's custom text once typing pauses. */
    onCustomTextChange: SetCustomText;
    /** Saves a song's choice again after its save failed. */
    onRetrySave: RetrySave;
    /** Links a song's Planning Center song to a suggested catalog song. */
    onLink: LinkSong;
}

/**
 * The Service Schedule tab: a card per song item, in sequence order, with
 * its numbers from its catalog link or a way to link it, and the choices for
 * its line (see `ScheduleSongCard`); a "Copy All" button for the schedule
 * text; and quiet banners when the catalog or the saved choices cannot be
 * read. It holds no selections itself; they come in with `items`, with how
 * their saves stand in `saves`, and changes go out through the callbacks.
 */
export default function ServiceSchedule({
    items,
    catalog,
    suggestions,
    catalogError,
    selectionsError,
    saves,
    serviceTypeName,
    planDate,
    scheduleHref,
    onChooseOption,
    onCustomTextChange,
    onRetrySave,
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
            {catalogError !== null && <Notice>{catalogUnavailableMessage(catalogError)}</Notice>}
            {selectionsError !== null && (
                <Notice>{selectionsUnavailableMessage(selectionsError)}</Notice>
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
                            saveState={saves[item.id] ?? null}
                            scheduleHref={scheduleHref}
                            onChooseOption={onChooseOption}
                            onCustomTextChange={onCustomTextChange}
                            onRetrySave={onRetrySave}
                            onLink={onLink}
                        />
                    ))}
            </div>
        </div>
    );
}
