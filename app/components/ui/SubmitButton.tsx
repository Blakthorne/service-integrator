"use client";

import { useFormStatus } from "react-dom";

const VARIANT_CLASSES = {
    primary: {
        colour: "bg-blue-500 focus:ring-blue-500",
        hover: "hover:bg-blue-600",
    },
    danger: {
        colour: "bg-red-600 focus:ring-red-500",
        hover: "hover:bg-red-700",
    },
} as const;

interface SubmitButtonProps {
    /** The button's text. */
    children: React.ReactNode;
    /** The text while the form's action runs. Defaults to "Working…". */
    pendingLabel?: string;
    /** "danger" is for an action that deletes or throws something away. Defaults to "primary". */
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
            className={`px-4 py-2 text-sm font-medium text-white rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-gray-800 transition-colors ${colour} ${pending ? "opacity-60 cursor-not-allowed" : `cursor-pointer ${hover}`}`}
        >
            {pending ? pendingLabel : children}
        </button>
    );
}
