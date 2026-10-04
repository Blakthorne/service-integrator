"use client";

import { useEffect, useMemo, useRef } from "react";
import type { PickerMatches } from "@/lib/catalog/pickers";
import OptionPicker from "../OptionPicker";

interface ChoiceFromListProps<T> {
    /** Every option, in the order matches of the same rank are listed. */
    options: readonly T[];
    /** The option chosen, or undefined when none is. */
    chosen: T | undefined;
    /** What is typed in the search field. */
    search: string;
    onSearchChange: (search: string) => void;
    /** Choose an option, or clear the choice (null) to search again. */
    onChoose: (option: T | null) => void;
    /** The search over the options, from `lib/catalog/pickers.ts`. */
    searchOptions: (options: readonly T[], query: string) => PickerMatches<T>;
    keyOf: (option: T) => number;
    nameOf: (option: T) => string;
    /** The line under an option's name, or "" for none. */
    describe: (option: T) => string;
    /** The search field's label, such as "Search the catalog's hymns". */
    searchLabel: string;
    /** What the chosen option is, for the Change button's name: "hymn", "tune". */
    noun: string;
    /**
     * The id of the part's error, when it has one. It describes the search
     * field, or the Change button once an option is chosen (an error such as
     * "the catalog already has this song" is about the option chosen).
     */
    errorId?: string;
}

/**
 * Choosing one option from a long list (a hymn, a tune): a search field
 * with the best matches as buttons, and once one is chosen, that option with
 * a Change button that brings the search back. Focus follows: to Change
 * once an option is chosen, and back to the search field after Change, so
 * neither swap drops it on the page's body.
 */
export default function ChoiceFromList<T>({
    options,
    chosen,
    search,
    onSearchChange,
    onChoose,
    searchOptions,
    keyOf,
    nameOf,
    describe,
    searchLabel,
    noun,
    errorId,
}: ChoiceFromListProps<T>) {
    const changeRef = useRef<HTMLButtonElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);
    /** Where focus goes after the next render: set by a choice or by Change. */
    const focusNext = useRef<"change" | "search" | null>(null);
    const result = useMemo(() => searchOptions(options, search), [searchOptions, options, search]);

    useEffect(() => {
        if (focusNext.current === "change") {
            changeRef.current?.focus();
        } else if (focusNext.current === "search") {
            searchRef.current?.focus();
        }
        focusNext.current = null;
    });

    function choose(option: T | null) {
        focusNext.current = option === null ? "search" : "change";
        onChoose(option);
    }

    if (chosen !== undefined) {
        const detail = describe(chosen);
        return (
            <div className="flex items-center justify-between gap-4 rounded-md border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900/40 px-3 py-2">
                <div className="min-w-0">
                    <p className="font-medium text-gray-900 dark:text-gray-100">
                        {nameOf(chosen)}
                    </p>
                    {detail && (
                        <p className="text-sm text-gray-600 dark:text-gray-400">{detail}</p>
                    )}
                </div>
                <button
                    ref={changeRef}
                    type="button"
                    onClick={() => choose(null)}
                    aria-label={`Change the ${noun}: ${nameOf(chosen)}`}
                    aria-describedby={errorId}
                    className="shrink-0 rounded-md px-3 py-1.5 text-sm font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                >
                    Change
                </button>
            </div>
        );
    }

    return (
        <OptionPicker
            label={searchLabel}
            query={search}
            onQueryChange={onSearchChange}
            result={result}
            keyOf={keyOf}
            onEnter={(best) => {
                if (best !== undefined) {
                    choose(best);
                }
            }}
            errorId={errorId}
            inputRef={searchRef}
            renderOption={(option) => {
                const detail = describe(option);
                return (
                    <button
                        type="button"
                        onClick={() => choose(option)}
                        className="block w-full px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 cursor-pointer"
                    >
                        <span className="block font-medium text-gray-900 dark:text-gray-100">
                            {nameOf(option)}
                        </span>
                        {detail && (
                            <span className="block text-sm text-gray-600 dark:text-gray-400">
                                {detail}
                            </span>
                        )}
                    </button>
                );
            }}
        />
    );
}
