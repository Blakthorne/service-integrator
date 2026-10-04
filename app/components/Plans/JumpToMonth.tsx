"use client";

import { useId, useState } from "react";
import { describeMonthOption, type MonthJump, type PlanMonth } from "@/lib/plansByDate";
import { buttonClasses } from "../ui/buttonClasses";

interface JumpToMonthProps {
    /** The months that have past plans, newest first (`planMonths`). */
    months: PlanMonth[];
    /** The page the list is on, so that what a jump said goes when the page changes some other way. */
    currentPage: number;
    /** Asks the list to go to a month (`YYYY-MM`, "" for none): what it did, or why it could not. */
    onJump: (month: string) => MonthJump;
}

/** What the last jump said: its sentence, and the page it went to (none for a refusal). */
interface JumpMessage {
    ok: boolean;
    text: string;
    page: number | null;
}

/**
 * "Jump to month": a choice of the months that have past plans and a Go
 * button, which takes the list to the page that holds the month's first date.
 * Go is a button, not the select's own change, so a keyboard user arrowing
 * through the months does not take the list somewhere at each key press; the
 * label says what Go does.
 *
 * What a jump did is said in a status region that is always rendered, and goes
 * when the page changes some other way (Previous, Next), when it would be
 * wrong. A refusal (no month chosen) stays until the next jump, in red, and
 * the select is described by whichever message there is.
 */
export default function JumpToMonth({ months, currentPage, onJump }: JumpToMonthProps) {
    const selectId = useId();
    const messageId = useId();
    const [message, setMessage] = useState<JumpMessage | null>(null);

    function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const month = String(new FormData(event.currentTarget).get("month") ?? "");
        const jump = onJump(month);
        setMessage({ ok: jump.ok, text: jump.message, page: jump.ok ? jump.page : null });
    }

    // A jump's sentence is about the page it went to.
    const shown = message !== null && (!message.ok || message.page === currentPage) ? message : null;

    return (
        <form onSubmit={handleSubmit} noValidate>
            <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-0 flex-1 sm:flex-none">
                    <label
                        htmlFor={selectId}
                        className="block mb-1 text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400"
                    >
                        Jump to month
                    </label>
                    {/* 16px on phones: iOS zooms into smaller fields. */}
                    <select
                        id={selectId}
                        name="month"
                        defaultValue=""
                        aria-describedby={messageId}
                        aria-invalid={shown !== null && !shown.ok ? true : undefined}
                        className="w-full sm:w-64 rounded-md border border-gray-300 bg-white px-3 py-2 text-base sm:text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 aria-[invalid=true]:border-red-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:aria-[invalid=true]:border-red-400"
                    >
                        <option value="">Choose a month&hellip;</option>
                        {months.map((month) => (
                            <option key={month.month} value={month.month}>
                                {describeMonthOption(month)}
                            </option>
                        ))}
                    </select>
                </div>
                <button type="submit" className={buttonClasses("secondary")}>
                    Go
                </button>
            </div>
            {/* Always rendered, so a screen reader announces a message that appears. */}
            <p
                id={messageId}
                role="status"
                className={
                    shown === null
                        ? "sr-only"
                        : shown.ok
                          ? "mt-2 text-sm text-gray-600 dark:text-gray-300"
                          : "mt-2 text-sm text-red-600 dark:text-red-400"
                }
            >
                {shown?.text}
            </p>
        </form>
    );
}
