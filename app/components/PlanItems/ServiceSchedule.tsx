"use client";

import { useEffect, useRef, useState } from "react";
import CopyButton from "../ui/CopyButton";
import { createDebouncedSave } from "@/lib/debouncedSave";
import {
    hasNumbers,
    type ChooseOption,
    type SetCustomText,
} from "@/lib/scheduleSelections";
import {
    buildScheduleCopyText,
    catalogMatchFor,
    formatScheduleNumbers,
} from "@/lib/serviceSchedule";
import type { CatalogMatch, PlanItem, ScheduleSelection } from "@/lib/domain";

/** A plan item together with its Schedule-tab selections. */
type ItemWithSelection = PlanItem & ScheduleSelection;

/** How long typing has to pause before the custom text is saved. */
const CUSTOM_TEXT_DEBOUNCE_MS = 500;

// The option components below live at module scope. Defined inside
// ServiceSchedule's render, each re-render made them new component types, so
// React remounted them, and the text box lost focus whenever a saved change
// re-rendered the tab (about half a second after typing paused).

/**
 * The custom-text box. It keeps what is typed locally and saves it 500 ms
 * after typing pauses, or straight away when the box loses focus (so a radio
 * or the copy button clicked right after typing sees the text) or unmounts.
 */
function CustomTextInput({
    item,
    onCustomTextChange,
}: {
    item: ItemWithSelection;
    onCustomTextChange: SetCustomText;
}) {
    const [inputValue, setInputValue] = useState(item.customText || "");

    // The saver's timer and the unmount cleanup outlive the render that
    // scheduled them, so they save through the latest callback and item ID.
    const saveRef = useRef<(text: string) => void>(() => {});
    useEffect(() => {
        saveRef.current = (text) => onCustomTextChange(item.id, text);
    });
    const [saver] = useState(() =>
        createDebouncedSave<string>(
            (text) => saveRef.current(text),
            CUSTOM_TEXT_DEBOUNCE_MS
        )
    );

    // Follow the saved text when it changes elsewhere (choosing Numbers or
    // Leave blank clears it), unless an edit is still waiting to be saved: the
    // box stays mounted, so an older save landing mid-typing must not
    // overwrite it.
    useEffect(() => {
        if (!saver.isPending()) {
            setInputValue(item.customText || "");
        }
    }, [item.customText, saver]);

    // Leaving the tab while an edit waits (Back, Cmd+[, a swipe) unmounts the
    // box with no blur event, since React dispatches none during the commit,
    // so the unmount saves the edit instead of dropping it with the timer.
    useEffect(() => {
        return () => {
            saver.flush();
        };
    }, [saver]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newValue = e.target.value;
        setInputValue(newValue);
        saver.schedule(newValue);
    };

    const handleBlur = () => {
        saver.flush();
    };

    return (
        <input
            type="text"
            value={inputValue}
            onChange={handleChange}
            onBlur={handleBlur}
            aria-label={`Custom text for ${item.title}`}
            className="flex-1 px-2 py-1 text-sm border w-full rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
            placeholder="Enter custom text..."
        />
    );
}

function CustomOption({
    item,
    onChooseOption,
    onCustomTextChange,
}: {
    item: ItemWithSelection;
    onChooseOption: ChooseOption;
    onCustomTextChange: SetCustomText;
}) {
    return (
        <div className="flex items-center space-x-3 mx-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700">
            <label className="flex items-center space-x-3 cursor-pointer">
                <input
                    type="radio"
                    name={`schedule-${item.id}`}
                    checked={item.option === "custom"}
                    onChange={() => onChooseOption(item.id, "custom")}
                    className="text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-900 dark:text-gray-100">
                    Custom:
                </span>
            </label>
            <CustomTextInput
                item={item}
                onCustomTextChange={onCustomTextChange}
            />
        </div>
    );
}

/**
 * Numbers, the choice for a song linked to a catalog song in a book: its tune
 * and numbers, as "NETTLETON (R-553/G-17)".
 */
function NumbersOption({
    item,
    match,
    onChooseOption,
}: {
    item: ItemWithSelection;
    match: CatalogMatch;
    onChooseOption: ChooseOption;
}) {
    return (
        <label className="flex items-center space-x-3 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer">
            <input
                type="radio"
                name={`schedule-${item.id}`}
                checked={item.option === "numbers"}
                onChange={() => onChooseOption(item.id, "numbers")}
                className="text-blue-600 focus:ring-blue-500"
            />
            <span className="flex-1 text-sm text-gray-900 dark:text-gray-100">
                {(match.tuneName ?? "") + " "}(
                {formatScheduleNumbers(match.entries)}
                )
            </span>
        </label>
    );
}

function LeaveBlankOption({
    item,
    onChooseOption,
}: {
    item: ItemWithSelection;
    onChooseOption: ChooseOption;
}) {
    return (
        <label className="flex items-center space-x-3 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer">
            <input
                type="radio"
                name={`schedule-${item.id}`}
                checked={item.option === "blank"}
                onChange={() => onChooseOption(item.id, "blank")}
                className="text-blue-600 focus:ring-blue-500"
            />
            <span className="flex-1 text-sm text-gray-900 dark:text-gray-100">
                Leave blank
            </span>
        </label>
    );
}

/** Props of ServiceSchedule. */
export interface ServiceScheduleProps {
    /** The plan's items with their selections (see `mergeScheduleSelections`). */
    items: ItemWithSelection[];
    /**
     * The catalog song each song item's Planning Center song is linked to,
     * by Planning Center song id.
     */
    catalog: Record<string, CatalogMatch>;
    serviceTypeName: string;
    /** The plan's calendar date as `YYYY-MM-DD`, or null when it is unknown. */
    planDate: string | null;
    /** Called when a song's option is chosen. */
    onChooseOption: ChooseOption;
    /** Called with a song's custom text once typing pauses. */
    onCustomTextChange: SetCustomText;
}

/**
 * The Service Schedule tab: a card per song to take its numbers from its
 * catalog link, leave it blank or give custom text, and a "Copy All" button
 * for the schedule text. It holds no selections itself; they come in with
 * `items` and changes go out through the callbacks.
 */
export default function ServiceSchedule({
    items,
    catalog,
    serviceTypeName,
    planDate,
    onChooseOption,
    onCustomTextChange,
}: ServiceScheduleProps) {
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
            <div className="space-y-4">
                {items
                    .filter((item) => item.itemType === "song")
                    .sort((a, b) => a.sequence - b.sequence)
                    .map((item) => {
                        const match = catalogMatchFor(catalog, item.songId);

                        return (
                            <div
                                key={item.id}
                                className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4"
                            >
                                <div className="flex flex-col space-y-2">
                                    <div className="flex justify-between items-start">
                                        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">
                                            {item.title}
                                        </h3>
                                    </div>
                                    {!hasNumbers(item, catalog) && (
                                        <p className="text-sm text-gray-600 dark:text-gray-400">
                                            {match
                                                ? "Linked song is in no book"
                                                : "Song not linked to the catalog"}
                                        </p>
                                    )}
                                    <div>
                                        {match && hasNumbers(item, catalog) && (
                                            <NumbersOption
                                                item={item}
                                                match={match}
                                                onChooseOption={onChooseOption}
                                            />
                                        )}
                                        <LeaveBlankOption
                                            item={item}
                                            onChooseOption={onChooseOption}
                                        />
                                        <CustomOption
                                            item={item}
                                            onChooseOption={onChooseOption}
                                            onCustomTextChange={
                                                onCustomTextChange
                                            }
                                        />
                                    </div>
                                </div>
                            </div>
                        );
                    })}
            </div>
        </div>
    );
}
