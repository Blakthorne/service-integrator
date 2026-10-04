"use client";

import type { MoveDirection } from "@/lib/catalog/validation";

interface MoveButtonsProps {
    /** What moves, as the buttons' names say it: "Rejoice Hymns", "Amazing Grace". */
    name: string;
    /** The DOM ids of the two buttons: `useReorder` puts focus back on one by its id. */
    upId: string;
    downId: string;
    /** First or last in its list: the button for that edge does nothing. */
    first: boolean;
    last: boolean;
    /** A move is under way somewhere in the list. */
    pending: boolean;
    onMove: (direction: MoveDirection) => void;
}

const BUTTON_CLASS =
    "relative z-10 inline-flex size-8 items-center justify-center rounded-md border border-gray-300 bg-white text-gray-700 shadow-sm transition-colors cursor-pointer hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-600 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600 dark:focus:ring-blue-400 aria-disabled:cursor-not-allowed aria-disabled:opacity-40 aria-disabled:hover:bg-white dark:aria-disabled:hover:bg-gray-700";

/** A chevron that points up or down. */
function Chevron({ direction }: { direction: MoveDirection }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
        >
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d={direction === "up" ? "M5 15l7-7 7 7" : "M19 9l-7 7-7-7"}
            />
        </svg>
    );
}

/**
 * Move up and Move down for one row of a list that is ordered by hand. Each
 * is `aria-disabled`, not `disabled`, at its edge of the list and while a
 * move runs: a disabled button loses focus, which would leave a keyboard
 * user on the page's body when the row they moved reaches the top. Each is
 * named for the row it moves, since a list has one pair per row. They sit
 * above a row's stretched link (`relative z-10`).
 */
export default function MoveButtons({ name, upId, downId, first, last, pending, onMove }: MoveButtonsProps) {
    return (
        <div className="flex shrink-0 items-center gap-1">
            <button
                id={upId}
                type="button"
                aria-label={`Move ${name} up`}
                aria-disabled={first || pending}
                onClick={() => {
                    if (!first && !pending) {
                        onMove("up");
                    }
                }}
                className={BUTTON_CLASS}
            >
                <Chevron direction="up" />
            </button>
            <button
                id={downId}
                type="button"
                aria-label={`Move ${name} down`}
                aria-disabled={last || pending}
                onClick={() => {
                    if (!last && !pending) {
                        onMove("down");
                    }
                }}
                className={BUTTON_CLASS}
            >
                <Chevron direction="down" />
            </button>
        </div>
    );
}
