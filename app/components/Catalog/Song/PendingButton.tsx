"use client";

import { PRIMARY_BUTTON_CLASS, primaryButtonState } from "./styles";

interface PendingButtonProps {
    /** True while its action runs: it says `pendingLabel` and ignores clicks. */
    pending: boolean;
    /** What it says while its action runs, such as "Saving…". */
    pendingLabel: string;
    /** Runs the action; not called while `pending`. */
    onClick: () => void;
    /** The id of text that describes it, such as what it will write. */
    describedBy?: string;
    buttonRef?: React.Ref<HTMLButtonElement>;
    children: React.ReactNode;
}

/**
 * The primary button of an action that waits on Planning Center: a plain
 * button (`type="button"`) that calls its action from its click, with the
 * pending state passed in (convention 15). Not a submit button, so Enter
 * in a field never writes to Planning Center: only the button does.
 *
 * While pending it is `aria-disabled`, not `disabled`: a disabled button
 * loses focus, which would leave a keyboard user on the page's body when
 * the action comes back with a refusal.
 */
export default function PendingButton({
    pending,
    pendingLabel,
    onClick,
    describedBy,
    buttonRef,
    children,
}: PendingButtonProps) {
    return (
        <button
            ref={buttonRef}
            type="button"
            aria-disabled={pending}
            aria-describedby={describedBy}
            onClick={() => {
                if (!pending) {
                    onClick();
                }
            }}
            className={`${PRIMARY_BUTTON_CLASS} ${primaryButtonState(pending)}`}
        >
            {pending ? pendingLabel : children}
        </button>
    );
}
