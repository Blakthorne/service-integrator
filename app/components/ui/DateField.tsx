"use client";

import { useId, useState } from "react";
import { parseReportDate } from "@/lib/reports";

interface DateFieldProps {
    /** The field's visible label, such as "Not sung since". */
    label: string;
    /** What the date does, under the field, read with it. */
    hint?: string;
    /** The date the page uses, `YYYY-MM-DD` (as the URL has it); "" for none. */
    value: string;
    /**
     * Called with each complete, real date typed or picked, and with "" when
     * the field has been emptied. Never called with half a date: a date
     * being typed is not one until it is whole (`parseReportDate`).
     */
    onChange: (value: string) => void;
    /**
     * Called by a "Clear" button beside the label, shown while the field has
     * a date, for a field whose date is optional (a filter). Left out, there
     * is no button.
     */
    onClear?: () => void;
}

/**
 * A date field whose date lives in the URL, as `SearchBox`'s search does.
 *
 * What is typed shows at once, from local state: the URL, and with it the
 * list, catch up a moment later, and a date input fed straight from it would
 * lose what is half typed, since the browser reads a date with a part
 * missing as "". The page hears of the date once it is whole. When the URL's
 * date changes the field follows it (Back, a link); and when the field is
 * left with half a date in it, it goes back to the date in use rather than
 * show one the page is not using.
 *
 * A browser that has no date input shows a text field, in which the date is
 * written `YYYY-MM-DD`, which is what `parseReportDate` takes.
 */
export default function DateField({ label, hint, value, onChange, onClear }: DateFieldProps) {
    const id = useId();
    const hintId = useId();
    const [draft, setDraft] = useState(value);
    const [followed, setFollowed] = useState(value);
    if (value !== followed) {
        setFollowed(value);
        setDraft(value);
    }

    return (
        <div className="max-w-full space-y-1">
            <div className="flex items-baseline justify-between gap-3">
                <label
                    htmlFor={id}
                    className="block text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400"
                >
                    {label}
                </label>
                {onClear && value !== "" && (
                    <button
                        type="button"
                        onClick={onClear}
                        className="rounded-sm text-xs font-medium text-blue-600 hover:text-blue-800 hover:underline cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:text-blue-400 dark:hover:text-blue-300 dark:focus-visible:outline-blue-400"
                    >
                        Clear<span className="sr-only"> {label.toLowerCase()}</span>
                    </button>
                )}
            </div>
            <input
                id={id}
                type="date"
                value={draft}
                onChange={(event) => {
                    const next = event.target.value;
                    setDraft(next);
                    // "" is an emptied field, or one with a part missing: only the first is news.
                    const whole =
                        next === "" ? !event.target.validity.badInput : parseReportDate(next) !== null;
                    if (whole) {
                        onChange(next);
                    }
                }}
                onBlur={() => setDraft(value)}
                aria-describedby={hint ? hintId : undefined}
                autoComplete="off"
                // The picker's icon takes the page's dark scheme.
                className="block w-full sm:w-48 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-base sm:text-sm text-gray-900 dark:text-gray-100 [color-scheme:light] dark:[color-scheme:dark] focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {hint && (
                <p id={hintId} className="max-w-xs text-xs text-gray-600 dark:text-gray-400">
                    {hint}
                </p>
            )}
        </div>
    );
}
