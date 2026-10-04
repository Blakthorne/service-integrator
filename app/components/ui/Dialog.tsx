"use client";

import { useEffect, useId, useRef } from "react";

interface DialogProps {
    /** Whether the dialog is showing. The parent owns this and sets it to false in `onClose`. */
    open: boolean;
    /**
     * Called once the dialog has closed, however it closed: Escape (a
     * repeated Escape too, which a dialog that is not `dismissible` cannot
     * stop), its close button, or `open` going false. Set `open` to false in
     * it, always. The dialog is closed already, so it is not a request to
     * refuse: left true, `open` would say it is showing when it is not, and
     * setting it true again would not open it.
     */
    onClose: () => void;
    /** The dialog's heading. It also names the dialog for screen readers. */
    title: string;
    /** One line under the title, read out with the dialog's name. */
    description?: string;
    /**
     * The element that gets focus back when the dialog closes: the button that
     * opened it. Without it focus goes back to the element that had it when
     * the dialog opened, which is not that button on a browser that does not
     * focus a button when it is clicked (Safari, and Firefox on a Mac).
     */
    returnFocusRef?: React.RefObject<HTMLElement | null>;
    /**
     * Whether the person can close it, with Escape or its close button.
     * Defaults to true. Pass false while an action runs inside it, so that
     * what comes back (a refusal) lands where they are looking and not in a
     * dialog they closed; `open` still closes it. A browser may let repeated
     * Escape presses through anyway, so that a dialog cannot trap the
     * keyboard (Chromium does on the third): this stops a stray key press,
     * not a determined one. Such a close calls `onClose` like any other, and
     * a parent that must show what the action brings back opens the dialog
     * again when it comes.
     */
    dismissible?: boolean;
    children: React.ReactNode;
}

/**
 * A modal dialog on the browser's own `<dialog>`, opened with `showModal()`.
 * The browser makes the rest of the page inert, so focus stays inside, and
 * closes the dialog on Escape. The first focusable element in it takes focus
 * when it opens: the close button, which is the safe one.
 *
 * It is controlled: render it always, and flip `open` from the button that
 * opens it. Its content is rendered while it is closed too, so a form inside
 * keeps its state (and a refusal it is showing) from one opening to the next.
 */
export default function Dialog({
    open,
    onClose,
    title,
    description,
    returnFocusRef,
    dismissible = true,
    children,
}: DialogProps) {
    const dialogRef = useRef<HTMLDialogElement>(null);
    const openerRef = useRef<Element | null>(null);
    const titleId = useId();
    const descriptionId = useId();

    useEffect(() => {
        const dialog = dialogRef.current;
        if (!open || !dialog) {
            return;
        }
        // Where focus is before the dialog takes it.
        openerRef.current = document.activeElement;
        if (!dialog.open) {
            dialog.showModal();
        }
        // `open` went false, or the dialog is going away: close it unless
        // the browser already has (Escape).
        return () => {
            if (dialog.open) {
                dialog.close();
            }
        };
    }, [open]);

    // The browser fires `close` however the dialog closed: on Escape, from
    // the close button, and after the `close()` above. Every close comes
    // through here, so the parent hears of each one the same way, after it
    // has happened. Hand focus back, then tell the parent.
    function handleClose() {
        // The event is queued, so one for a close that the dialog has since
        // opened again from (React's Strict Mode does that in development) is stale.
        if (dialogRef.current?.open) {
            return;
        }
        const target = returnFocusRef?.current ?? openerRef.current;
        openerRef.current = null;
        if (target instanceof HTMLElement && target.isConnected) {
            target.focus();
        }
        onClose();
    }

    return (
        <dialog
            ref={dialogRef}
            aria-labelledby={titleId}
            aria-describedby={description ? descriptionId : undefined}
            onClose={handleClose}
            // Escape asks the browser to close the dialog by firing `cancel`
            // first; preventing it keeps the dialog open.
            onCancel={dismissible ? undefined : (event) => event.preventDefault()}
            className="m-auto w-[min(32rem,calc(100%_-_2rem))] rounded-lg border border-gray-200 bg-white p-0 text-gray-900 shadow-xl backdrop:bg-black/50 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
        >
            <div className="p-5 sm:p-6">
                <div className="flex items-start justify-between gap-4">
                    <h2 id={titleId} className="text-lg font-semibold">
                        {title}
                    </h2>
                    {dismissible && (
                        <button
                            type="button"
                            // Closes the dialog itself, so `onClose` comes from
                            // the `close` event, as for Escape.
                            onClick={() => dialogRef.current?.close()}
                            aria-label="Close"
                            className="-m-1 rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                        >
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                aria-hidden="true"
                                className="h-5 w-5"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                            >
                                <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M6 18L18 6M6 6l12 12"
                                />
                            </svg>
                        </button>
                    )}
                </div>
                {description && (
                    <p
                        id={descriptionId}
                        className="mt-2 text-sm text-gray-600 dark:text-gray-300"
                    >
                        {description}
                    </p>
                )}
                <div className="mt-4">{children}</div>
            </div>
        </dialog>
    );
}
