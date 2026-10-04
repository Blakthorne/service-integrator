"use client";

import CopyButton from "../ui/CopyButton";
import type {
    CatalogMatch,
    LinkSuggestion,
    PlanItemWithSong,
    ScheduleSelection,
} from "@/lib/domain";
import { cardNoteBadge } from "@/lib/hymnNoteText";
import { hymnNoteDiffFor, type HymnNoteStatus } from "@/lib/hymnNotes";
import {
    catalogUnavailableMessage,
    scheduleSongView,
    selectionsUnavailableMessage,
    settingsUnavailableMessage,
} from "@/lib/scheduleCards";
import type { ChooseOption, SetCustomText } from "@/lib/scheduleSelections";
import type { SelectionSaveState } from "@/lib/scheduleSelectionsStore";
import { buildScheduleCopyText } from "@/lib/serviceSchedule";
import type { LinkSong } from "./LinkToCatalogInline";
import PlanNotice from "./PlanNotice";
import type { RetrySave } from "./PlanProvider";
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
    /** Why the saved choices could not be read, or null; the tab then says choices won't be saved. */
    selectionsError: string | null;
    /** Why the settings could not be read, or null; the tab then says the text uses the defaults. */
    settingsError: string | null;
    /** The plan's hymnal notes against its category, for each card's note status. */
    hymnNoteStatus: HymnNoteStatus;
    /** How the saves of the changed songs stand, by item ID (see `SelectionSaveState`). */
    saves: Readonly<Record<string, SelectionSaveState>>;
    serviceTypeName: string;
    /** The plan's calendar date as `YYYY-MM-DD`, or null when it is unknown. */
    planDate: string | null;
    /** The schedule text's header label, from the settings; null for no header. */
    headerLabel: string | null;
    /** What goes between a song's numbers, from the settings. */
    numberSeparator: string;
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
 * its numbers from its catalog link or a way to link it, its hymnal note's
 * status, and the choices for its line (see `ScheduleSongCard`); a "Copy All" button for the schedule
 * text, with the header and separator from the settings; and quiet banners
 * when the catalog, the saved choices or the settings cannot be read. It
 * holds no selections itself; they come in with `items`, with how
 * their saves stand in `saves`, and changes go out through the callbacks.
 */
export default function ServiceSchedule({
    items,
    catalog,
    suggestions,
    catalogError,
    selectionsError,
    settingsError,
    hymnNoteStatus,
    saves,
    serviceTypeName,
    planDate,
    headerLabel,
    numberSeparator,
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
                                headerLabel,
                                numberSeparator,
                            })}
                        />
                    </div>
                </div>
            </div>
            {catalogError !== null && (
                <PlanNotice>{catalogUnavailableMessage(catalogError)}</PlanNotice>
            )}
            {selectionsError !== null && (
                <PlanNotice>{selectionsUnavailableMessage(selectionsError)}</PlanNotice>
            )}
            {settingsError !== null && (
                <PlanNotice>{settingsUnavailableMessage(settingsError)}</PlanNotice>
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
                            noteBadge={cardNoteBadge(hymnNoteDiffFor(hymnNoteStatus, item.id))}
                            saveState={saves[item.id] ?? null}
                            numberSeparator={numberSeparator}
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
