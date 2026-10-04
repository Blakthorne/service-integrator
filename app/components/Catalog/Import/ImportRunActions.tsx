"use client";

import { useActionState, useRef, useState } from "react";
import {
    applyImportAction,
    discardImportAction,
} from "@/app/(app)/catalog/import/actions";
import Dialog from "@/app/components/ui/Dialog";
import SubmitButton from "@/app/components/ui/SubmitButton";

interface ImportRunActionsProps {
    runId: number;
    /** What applying adds, as the confirmation says it: "2 books, 895 hymns, …". */
    plannedText: string;
    /**
     * Set when Apply is known to be refused (the catalog already has books):
     * the id of the text beside the buttons that says why. Apply is then
     * unavailable. The action still refuses on the server, so this only
     * saves a click.
     */
    applyUnavailableId?: string;
}

interface ConfirmFormProps {
    /** The action `useActionState` returned for this form. */
    action: (formData: FormData) => void;
    runId: number;
    /** The refusal or failure the action last returned, if any. */
    error: string | null;
    /** Whether the action is running: Cancel is then unavailable, so the result is seen. */
    pending: boolean;
    onCancel: () => void;
    submitLabel: string;
    pendingLabel: string;
    variant?: "primary" | "danger";
}

/** The form inside a confirmation: the run's id, any message, Cancel and the submit button. */
function ConfirmForm({
    action,
    runId,
    error,
    pending,
    onCancel,
    submitLabel,
    pendingLabel,
    variant,
}: ConfirmFormProps) {
    return (
        <form action={action}>
            <input type="hidden" name="runId" value={runId} />
            {error && (
                <p
                    role="alert"
                    className="mb-4 text-sm text-red-600 dark:text-red-400"
                >
                    {error}
                </p>
            )}
            <div className="flex justify-end gap-3">
                <button
                    type="button"
                    onClick={onCancel}
                    disabled={pending}
                    className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                >
                    Cancel
                </button>
                <SubmitButton pendingLabel={pendingLabel} variant={variant}>
                    {submitLabel}
                </SubmitButton>
            </div>
        </form>
    );
}

/**
 * Apply and Discard for a previewed run, each confirmed in a dialog. A
 * refusal the page could not know about (the run was applied in another tab)
 * comes back from the action and shows inside the dialog, which stays open;
 * the action also revalidates the page, which then shows the run as it is
 * now. Success redirects away.
 *
 * While an action runs its dialog cannot be closed (Cancel is disabled, and
 * the dialog ignores Escape and hides its close button), so that whatever
 * comes back is seen: a refusal that arrived after the dialog was closed
 * would land in it unseen.
 *
 * When the page already knows Apply will be refused (`applyUnavailableId`),
 * the button is `aria-disabled` rather than `disabled`, like `SubmitButton`:
 * it stays focusable, is described by the text that gives the reason, and
 * does nothing when pressed.
 *
 * Pending state comes from `useActionState` (`isPending`, which locks the
 * dialog) and, inside each form, `useFormStatus` (SubmitButton's label).
 * React runs a form action inside a transition, so a navigation started
 * while one runs commits only when it returns: the stall convention 15
 * warns about for an action that waits on Planning Center. It is acceptable
 * here, because these actions write to the local database in milliseconds.
 */
export default function ImportRunActions({
    runId,
    plannedText,
    applyUnavailableId,
}: ImportRunActionsProps) {
    const applyUnavailable = applyUnavailableId !== undefined;
    const [open, setOpen] = useState<"apply" | "discard" | null>(null);
    const applyButtonRef = useRef<HTMLButtonElement>(null);
    const discardButtonRef = useRef<HTMLButtonElement>(null);
    const [applyState, applyAction, applyPending] = useActionState(
        applyImportAction,
        null
    );
    const [discardState, discardAction, discardPending] = useActionState(
        discardImportAction,
        null
    );

    function close() {
        setOpen(null);
    }

    return (
        <>
            <button
                ref={applyButtonRef}
                type="button"
                aria-disabled={applyUnavailable || undefined}
                aria-describedby={applyUnavailableId}
                onClick={() => {
                    if (!applyUnavailable) {
                        setOpen("apply");
                    }
                }}
                className={`px-4 py-2 text-sm font-medium rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-600 dark:focus:ring-blue-400 focus:ring-offset-2 dark:focus:ring-offset-gray-900 transition-colors ${
                    applyUnavailable
                        ? "bg-gray-200 text-gray-500 cursor-not-allowed dark:bg-gray-700 dark:text-gray-400"
                        : "bg-blue-600 text-white hover:bg-blue-700 cursor-pointer"
                }`}
            >
                Apply
            </button>
            <button
                ref={discardButtonRef}
                type="button"
                onClick={() => setOpen("discard")}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors cursor-pointer"
            >
                Discard
            </button>

            <Dialog
                open={open === "apply"}
                onClose={close}
                title="Apply this import?"
                description={`Adds ${plannedText} to the catalog, all at once. The app has no undo for it.`}
                returnFocusRef={applyButtonRef}
                dismissible={!applyPending}
            >
                <ConfirmForm
                    action={applyAction}
                    runId={runId}
                    error={applyState?.error ?? null}
                    pending={applyPending}
                    onCancel={close}
                    submitLabel="Apply import"
                    pendingLabel="Applying…"
                />
            </Dialog>
            <Dialog
                open={open === "discard"}
                onClose={close}
                title="Discard this preview?"
                description="Nothing is added to the catalog. The run stays in the list, marked as discarded."
                returnFocusRef={discardButtonRef}
                dismissible={!discardPending}
            >
                <ConfirmForm
                    action={discardAction}
                    runId={runId}
                    error={discardState?.error ?? null}
                    pending={discardPending}
                    onCancel={close}
                    submitLabel="Discard preview"
                    pendingLabel="Discarding…"
                    variant="danger"
                />
            </Dialog>
        </>
    );
}
