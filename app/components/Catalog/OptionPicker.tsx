"use client";

import { useId, type ReactNode, type Ref } from "react";
import { describePickerMatches, type PickerMatches } from "@/lib/catalog/pickers";

interface OptionPickerProps<T> {
    /** The search field's visible label, such as "Search hymns". */
    label: string;
    /** What is typed in the search field. */
    query: string;
    onQueryChange: (query: string) => void;
    /** The matches for `query`, from a search of `lib/catalog/pickers.ts`. */
    result: PickerMatches<T>;
    /** A key for an option, unique among the matches. */
    keyOf: (option: T) => number | string;
    /** An option's row: a button that chooses it, or a form that acts on it. */
    renderOption: (option: T) => ReactNode;
    /**
     * Called for Enter in the search field, with the best match, if any.
     * Enter never submits the form the picker is in.
     */
    onEnter?: (best: T | undefined) => void;
    /** The id of an error that describes the search field, if it has one. */
    errorId?: string;
    placeholder?: string;
    inputRef?: Ref<HTMLInputElement>;
}

/**
 * A search field over a list of options, with the best few matches under
 * it: for choosing a hymn or tune on the new-song form, and a song to link
 * on Reconcile. The page sends every option once and the browser searches
 * them as the person types (`lib/catalog/pickers.ts`); a line under the
 * field says how many match, and is read out as it changes.
 */
export default function OptionPicker<T>({
    label,
    query,
    onQueryChange,
    result,
    keyOf,
    renderOption,
    onEnter,
    errorId,
    placeholder,
    inputRef,
}: OptionPickerProps<T>) {
    const id = useId();
    const statusId = `${id}-status`;

    return (
        <div>
            <label
                htmlFor={id}
                className="block mb-1 text-sm font-medium text-gray-700 dark:text-gray-300"
            >
                {label}
            </label>
            <input
                ref={inputRef}
                id={id}
                type="search"
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
                onKeyDown={(event) => {
                    if (event.key === "Enter") {
                        event.preventDefault();
                        onEnter?.(result.matches[0]);
                    }
                }}
                placeholder={placeholder}
                autoComplete="off"
                spellCheck={false}
                aria-describedby={[statusId, errorId].filter(Boolean).join(" ")}
                aria-invalid={errorId ? true : undefined}
                className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-base sm:text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p
                id={statusId}
                aria-live="polite"
                className="mt-1 text-xs text-gray-500 dark:text-gray-400"
            >
                {describePickerMatches(query, result)}
            </p>
            {result.matches.length > 0 && (
                <ul className="mt-2 divide-y divide-gray-200 dark:divide-gray-700 rounded-md border border-gray-200 dark:border-gray-700 overflow-hidden">
                    {result.matches.map((option) => (
                        <li key={keyOf(option)}>{renderOption(option)}</li>
                    ))}
                </ul>
            )}
        </div>
    );
}
