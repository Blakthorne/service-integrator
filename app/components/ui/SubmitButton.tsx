"use client";

import { useFormStatus } from "react-dom";

/**
 * Each variant's colours. White text needs 4.5:1 against the button: blue-600
 * gives 5.3:1, red-600 4.8:1. The focus ring sits outside the button, so it
 * needs 3:1 against the page: blue-600 on white, blue-400 on dark grey.
 */
const VARIANT_CLASSES = {
    primary: {
        colour: "text-white bg-blue-600 focus:ring-blue-600 dark:focus:ring-blue-400",
        hover: "hover:bg-blue-700",
    },
    danger: {
        colour: "text-white bg-red-600 focus:ring-red-500",
        hover: "hover:bg-red-700",
    },
    secondary: {
        colour: "text-gray-700 bg-white border border-gray-300 focus:ring-blue-600 dark:text-gray-300 dark:bg-gray-700 dark:border-gray-600 dark:focus:ring-blue-400",
        hover: "hover:bg-gray-50 dark:hover:bg-gray-600",
    },
} as const;

interface SubmitButtonProps {
    /** The button's text. */
    children: React.ReactNode;
    /** The text while the form's action runs. Defaults to "Working…". */
    pendingLabel?: string;
    /**
     * "danger" is for an action that deletes or throws something away, and
     * "secondary" for a quieter one beside a primary button (Ignore beside
     * Link). Defaults to "primary".
     */
    variant?: keyof typeof VARIANT_CLASSES;
}

/**
 * The submit button of a form whose `action` is a function (a server action,
 * or the one `useActionState` returns). While that action runs it shows
 * `pendingLabel` and ignores clicks, so a second one cannot submit twice.
 *
 * `useFormStatus` reports on the nearest parent `<form>`, so render this
 * inside the form it submits, never beside it.
 *
 * It is `aria-disabled` while pending rather than `disabled`: a disabled
 * button loses focus, which would leave a keyboard user on the page's body
 * when the action comes back with a message and the form stays open.
 */
export default function SubmitButton({
    children,
    pendingLabel = "Working…",
    variant = "primary",
}: SubmitButtonProps) {
    const { pending } = useFormStatus();
    const { colour, hover } = VARIANT_CLASSES[variant];

    return (
        <button
            type="submit"
            aria-disabled={pending}
            onClick={(event) => {
                // Stops the form submitting again; Enter in a field of the
                // form submits through this button's click too.
                if (pending) {
                    event.preventDefault();
                }
            }}
            className={`px-4 py-2 text-sm font-medium rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-gray-800 transition-colors ${colour} ${pending ? "opacity-60 cursor-not-allowed" : `cursor-pointer ${hover}`}`}
        >
            {pending ? pendingLabel : children}
        </button>
    );
}
