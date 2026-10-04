"use client";

import { useFormStatus } from "react-dom";
import { buttonClasses, type ButtonVariant } from "./buttonClasses";

interface SubmitButtonProps {
    /** The button's text. */
    children: React.ReactNode;
    /** The text while the form's action runs. Defaults to "Working…". */
    pendingLabel?: string;
    /**
     * "danger" is for an action that deletes or throws something away, and
     * "secondary" for a quieter one that should not draw the eye (Reconcile's
     * Ignore, Undo and Unignore). Defaults to "primary".
     */
    variant?: ButtonVariant;
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
            className={buttonClasses(variant, pending)}
        >
            {pending ? pendingLabel : children}
        </button>
    );
}
