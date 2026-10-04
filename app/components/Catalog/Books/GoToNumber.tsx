"use client";

import { useId, useState } from "react";
import { entryRowId } from "./bookText";

interface GoToNumberProps {
    /** The book's code, for the message when it has no such number. */
    bookCode: string;
}

/** A plain run of digits that fits an entry number; no sign, no decimals. */
const NUMBER_PATTERN = /^[0-9]{1,9}$/;

/**
 * A box that jumps to the row of an entry number on the page: scrolls to it
 * and moves focus to its link, which the row's `focus-within` style
 * highlights. It finds the row in the page (`entryRowId`), so the table
 * stays a server component and the browser's own find still works.
 */
export default function GoToNumber({ bookCode }: GoToNumberProps) {
    const inputId = useId();
    const messageId = useId();
    const [message, setMessage] = useState<string | null>(null);

    function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const text = String(
            new FormData(event.currentTarget).get("number") ?? ""
        ).trim();
        if (!NUMBER_PATTERN.test(text)) {
            setMessage("Enter an entry number, such as 396.");
            return;
        }
        const number = Number(text);
        const row = document.getElementById(entryRowId(number));
        if (row === null) {
            setMessage(`${bookCode} has no entry numbered ${number}.`);
            return;
        }
        setMessage(null);
        row.scrollIntoView({ block: "center" });
        // The scroll above is the only one: focusing must not undo it.
        row.querySelector<HTMLElement>("a")?.focus({ preventScroll: true });
    }

    return (
        <form onSubmit={handleSubmit} noValidate>
            <div className="flex items-end gap-3">
                <div>
                    <label
                        htmlFor={inputId}
                        className="block mb-1 text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400"
                    >
                        Go to number
                    </label>
                    {/* 16px on phones: iOS zooms into smaller text fields. */}
                    <input
                        id={inputId}
                        name="number"
                        type="text"
                        inputMode="numeric"
                        autoComplete="off"
                        aria-describedby={messageId}
                        className="w-32 rounded-md border border-gray-300 bg-white px-3 py-2 text-base sm:text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                    />
                </div>
                <button
                    type="submit"
                    className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors cursor-pointer"
                >
                    Go
                </button>
            </div>
            {/* Always rendered, so a screen reader announces a message that appears. */}
            <p
                id={messageId}
                role="status"
                className={
                    message
                        ? "mt-2 text-sm text-red-600 dark:text-red-400"
                        : "sr-only"
                }
            >
                {message}
            </p>
        </form>
    );
}
