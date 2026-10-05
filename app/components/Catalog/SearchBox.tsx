"use client";

import { useId, useState } from "react";

interface SearchBoxProps {
    /** The search as the URL has it (`?q=`), "" for none. */
    value: string;
    /** Called with what is typed, as it is typed. */
    onChange: (value: string) => void;
    /** The field's visible label, such as "Search songs". */
    label: string;
    /**
     * What can be searched, such as "By title, tune or number". It shows
     * under the field, where it stays legible and in view while typing (a
     * placeholder would be faint and vanish), and is read with the field.
     */
    hint: string;
}

/**
 * The search field of a catalog list, whose search lives in the URL.
 *
 * What is typed shows at once, from local state: the URL, and with it the
 * list, catch up a moment later in a transition (that is how Next applies
 * `useUrlState`'s writes), and an input fed straight from the URL would drop
 * keystrokes. When the URL's search changes, the field follows it: after
 * typing it already says the same, and after Back or a link to the bare list
 * it shows the URL's search instead of a stale one.
 */
export default function SearchBox({
    value,
    onChange,
    label,
    hint,
}: SearchBoxProps) {
    const id = useId();
    const hintId = useId();
    const [draft, setDraft] = useState(value);
    const [followed, setFollowed] = useState(value);
    if (value !== followed) {
        setFollowed(value);
        setDraft(value);
    }

    return (
        <div>
            <label
                htmlFor={id}
                className="block mb-1 text-sm font-medium text-gray-700 dark:text-gray-300"
            >
                {label}
            </label>
            <input
                id={id}
                type="search"
                value={draft}
                onChange={(event) => {
                    setDraft(event.target.value);
                    onChange(event.target.value);
                }}
                aria-describedby={hintId}
                autoComplete="off"
                spellCheck={false}
                className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-base sm:text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p id={hintId} className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                {hint}
            </p>
        </div>
    );
}
