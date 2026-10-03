"use client";

import { useEffect, useRef, useState } from "react";
import CopyButton from "../ui/CopyButton";
import { normalizeTitle } from "@/lib/normalizeTitle";
import type { ChooseOption, SetCustomText } from "@/lib/scheduleSelections";
import {
    buildScheduleCopyText,
    formatHymnNumbers,
} from "@/lib/serviceSchedule";
import type {
    HymnData,
    HymnVersion,
    PlanItem,
    ScheduleSelection,
} from "@/lib/domain";

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
 * or the copy button clicked right after typing sees the text).
 */
function CustomTextInput({
    item,
    onCustomTextChange,
}: {
    item: ItemWithSelection;
    onCustomTextChange: SetCustomText;
}) {
    const [inputValue, setInputValue] = useState(item.customText || "");
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Follow the saved text when it changes elsewhere (picking a hymn version
    // clears it), unless an edit is still waiting to be saved: the box stays
    // mounted now, so an older save landing mid-typing must not overwrite it.
    useEffect(() => {
        if (timeoutRef.current === null) {
            setInputValue(item.customText || "");
        }
    }, [item.customText]);

    // Cleanup timeout on unmount
    useEffect(() => {
        return () => {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
        };
    }, []);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newValue = e.target.value;
        setInputValue(newValue);

        // Clear existing timeout
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
        }

        // Set new timeout to save the text
        timeoutRef.current = setTimeout(() => {
            timeoutRef.current = null;
            onCustomTextChange(item.id, newValue);
        }, CUSTOM_TEXT_DEBOUNCE_MS);
    };

    const handleBlur = () => {
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
            onCustomTextChange(item.id, inputValue);
        }
    };

    return (
        <input
            type="text"
            value={inputValue}
            onChange={handleChange}
            onBlur={handleBlur}
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
                    name={`hymn-${item.id}`}
                    checked={item.selectedOption === "Custom"}
                    onChange={() => onChooseOption(item.id, "Custom")}
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

function HymnNumbers({ hymnVersion }: { hymnVersion: HymnVersion }) {
    return (
        <span className="flex-1 text-sm text-gray-900 dark:text-gray-100">
            {hymnVersion.tune_name + " "}(
            {formatHymnNumbers(hymnVersion)}
            )
        </span>
    );
}

function HymnVersionOption({
    item,
    hymnVersion,
    versionIndex,
    onChooseOption,
}: {
    item: ItemWithSelection;
    hymnVersion: HymnVersion;
    versionIndex: number;
    onChooseOption: ChooseOption;
}) {
    return (
        <label className="flex items-center space-x-3 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer">
            <input
                type="radio"
                name={`hymn-${item.id}`}
                checked={
                    !item.selectedOption &&
                    item.selectedVersionIndex === versionIndex
                }
                onChange={() => onChooseOption(item.id, undefined, versionIndex)}
                className="text-blue-600 focus:ring-blue-500"
            />
            <HymnNumbers hymnVersion={hymnVersion} />
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
                name={`option-${item.id}`}
                checked={
                    item.selectedOption === "Leave blank" ||
                    item.selectedOption === undefined
                }
                onChange={() => onChooseOption(item.id, "Leave blank")}
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
    /** Hymnbook matches for the song items' titles. */
    hymnData: HymnData[];
    serviceTypeName: string;
    /** The plan's calendar date as `YYYY-MM-DD`, or null when it is unknown. */
    planDate: string | null;
    /** Called when a song's radio button is picked. */
    onChooseOption: ChooseOption;
    /** Called with a song's custom text once typing pauses. */
    onCustomTextChange: SetCustomText;
}

/**
 * The Service Schedule tab: a card per song to pick its hymn version, leave
 * it blank or give custom text, and a "Copy All" button for the schedule
 * text. It holds no selections itself; they come in with `items` and changes
 * go out through the callbacks.
 */
export default function ServiceSchedule({
    items,
    hymnData,
    serviceTypeName,
    planDate,
    onChooseOption,
    onCustomTextChange,
}: ServiceScheduleProps) {
    return (
        <div>
            <div className="flex items-center justify-between mb-6">
                <h3 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
                    Service Schedule
                </h3>
                <div className="flex items-center gap-4">
                    <div className="relative">
                        <CopyButton
                            text={buildScheduleCopyText({
                                items,
                                hymnData,
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
                        const hymn = hymnData.find(
                            (h) => normalizeTitle(h.song_title) === normalizeTitle(item.title)
                        );

                        return (
                            <div
                                key={item.id}
                                className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4"
                            >
                                <div className="flex flex-col space-y-2">
                                    <div className="flex justify-between items-start">
                                        <h4 className="text-lg font-medium text-gray-900 dark:text-gray-100">
                                            {item.title}
                                        </h4>
                                    </div>
                                    {!hymn ? (
                                        <div className="space-y-2">
                                            <p className="text-sm text-gray-600 dark:text-gray-400">
                                                Song not found in hymn books
                                            </p>
                                            <div>
                                                <LeaveBlankOption
                                                    item={item}
                                                    onChooseOption={
                                                        onChooseOption
                                                    }
                                                />
                                                <CustomOption
                                                    item={item}
                                                    onChooseOption={
                                                        onChooseOption
                                                    }
                                                    onCustomTextChange={
                                                        onCustomTextChange
                                                    }
                                                />
                                            </div>
                                        </div>
                                    ) : hymn.versions.length > 1 ? (
                                        <div className="space-y-2">
                                            <p className="text-sm text-gray-600 dark:text-gray-400">
                                                Multiple versions found
                                            </p>
                                            <div>
                                                {hymn.versions.map(
                                                    (version, index) => (
                                                        <HymnVersionOption
                                                            key={
                                                                item.id +
                                                                version.tune_name
                                                            }
                                                            item={item}
                                                            hymnVersion={
                                                                version
                                                            }
                                                            versionIndex={index}
                                                            onChooseOption={
                                                                onChooseOption
                                                            }
                                                        />
                                                    )
                                                )}
                                                <CustomOption
                                                    item={item}
                                                    onChooseOption={
                                                        onChooseOption
                                                    }
                                                    onCustomTextChange={
                                                        onCustomTextChange
                                                    }
                                                />
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="space-y-2">
                                            <div>
                                                <HymnVersionOption
                                                    item={item}
                                                    hymnVersion={
                                                        hymn.versions[0]
                                                    }
                                                    versionIndex={0}
                                                    onChooseOption={
                                                        onChooseOption
                                                    }
                                                />
                                                <CustomOption
                                                    item={item}
                                                    onChooseOption={
                                                        onChooseOption
                                                    }
                                                    onCustomTextChange={
                                                        onCustomTextChange
                                                    }
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
            </div>
        </div>
    );
}
