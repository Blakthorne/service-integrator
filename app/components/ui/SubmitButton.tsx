"use client";

import { useFormStatus } from "react-dom";

const VARIANT_CLASSES = {
    primary: "bg-blue-500 hover:bg-blue-600 focus:ring-blue-500",
    danger: "bg-red-600 hover:bg-red-700 focus:ring-red-500",
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
 * or the one `useActionState` returns). It shows `pendingLabel` and is
 * disabled while that action runs, so a second click cannot submit twice.
 *
 * `useFormStatus` reports on the nearest parent `<form>`, so render this
 * inside the form it submits, never beside it.
 */
export default function SubmitButton({
    children,
    pendingLabel = "Working…",
    variant = "primary",
}: SubmitButtonProps) {
    const { pending } = useFormStatus();

    return (
        <button
            type="submit"
            disabled={pending}
            className={`px-4 py-2 text-sm font-medium text-white rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-gray-800 transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${VARIANT_CLASSES[variant]}`}
        >
            {pending ? pendingLabel : children}
        </button>
    );
}
