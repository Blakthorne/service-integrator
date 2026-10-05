"use client";

import { useEffect, useRef, useState } from "react";
import { createDebouncedSave } from "@/lib/debouncedSave";
import type { PlanItem, ScheduleSelection } from "@/lib/domain";
import { SCHEDULE_OPTION_LABELS } from "@/lib/scheduleCards";
import type {
    ChooseOption,
    ScheduleOption,
    SetCustomText,
} from "@/lib/scheduleSelections";

/** A song item as its choices read it: its ID and title, with its selection. */
type ItemWithSelection = Pick<PlanItem, "id" | "title"> & ScheduleSelection;

/** How long typing has to pause before the custom text is saved. */
const CUSTOM_TEXT_DEBOUNCE_MS = 500;

// The components below live at module scope. Defined inside another
// component's render, each re-render made them new component types, so React
// remounted them, and the text box lost focus whenever a saved change
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

/** One choice: its radio button and label. */
function ChoiceRadio({
    item,
    option,
    onChooseOption,
}: {
    item: ItemWithSelection;
    option: ScheduleOption;
    onChooseOption: ChooseOption;
}) {
    return (
        <label className="flex items-center gap-2 py-1 cursor-pointer">
            <input
                type="radio"
                name={`schedule-${item.id}`}
                value={option}
                checked={item.option === option}
                onChange={() => onChooseOption(item.id, option)}
                className="text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm text-gray-900 dark:text-gray-100 whitespace-nowrap">
                {SCHEDULE_OPTION_LABELS[option]}
            </span>
        </label>
    );
}

interface ScheduleChoicesProps {
    item: ItemWithSelection;
    /** The choices to offer (see `scheduleChoices`): Numbers is the one that may be missing. */
    choices: readonly ScheduleOption[];
    onChooseOption: ChooseOption;
    onCustomTextChange: SetCustomText;
}

/**
 * What a song's line in the schedule text prints, as one radio group:
 * Numbers when it is offered, Leave blank, and Custom with its text box.
 * Each keeps its place whether or not Numbers is offered, so the text box is
 * never remounted under someone typing in it when a link adds the numbers.
 */
export default function ScheduleChoices({
    item,
    choices,
    onChooseOption,
    onCustomTextChange,
}: ScheduleChoicesProps) {
    return (
        <fieldset>
            <legend className="sr-only">
                What the schedule text prints for {item.title}
            </legend>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
                {choices.includes("numbers") ? (
                    <ChoiceRadio
                        item={item}
                        option="numbers"
                        onChooseOption={onChooseOption}
                    />
                ) : null}
                <ChoiceRadio item={item} option="blank" onChooseOption={onChooseOption} />
                <div className="flex flex-1 min-w-56 items-center gap-2">
                    <ChoiceRadio
                        item={item}
                        option="custom"
                        onChooseOption={onChooseOption}
                    />
                    <CustomTextInput
                        item={item}
                        onCustomTextChange={onCustomTextChange}
                    />
                </div>
            </div>
        </fieldset>
    );
}
