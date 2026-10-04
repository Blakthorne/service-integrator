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
}

interface ConfirmFormProps {
    /** The action `useActionState` returned for this form. */
    action: (formData: FormData) => void;
    runId: number;
    /** The refusal or failure the action last returned, if any. */
    error: string | null;
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
                    className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors cursor-pointer"
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
 * refusal (the catalog already has books, the run was applied in another
 * tab) comes back from the action and shows inside the dialog, which stays
 * open; success redirects away.
 *
 * Pending state comes from `useFormStatus` inside each form (SubmitButton),
 * never from a transition held open across the action, which would stall
 * every navigation until it returned (convention 15).
 */
export default function ImportRunActions({
    runId,
    plannedText,
}: ImportRunActionsProps) {
    const [open, setOpen] = useState<"apply" | "discard" | null>(null);
    const applyButtonRef = useRef<HTMLButtonElement>(null);
    const discardButtonRef = useRef<HTMLButtonElement>(null);
    const [applyState, applyAction] = useActionState(applyImportAction, null);
    const [discardState, discardAction] = useActionState(discardImportAction, null);

    function close() {
        setOpen(null);
    }

    return (
        <>
            <button
                ref={applyButtonRef}
                type="button"
                onClick={() => setOpen("apply")}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-500 rounded-md shadow-sm hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900 transition-colors cursor-pointer"
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
            >
                <ConfirmForm
                    action={applyAction}
                    runId={runId}
                    error={applyState?.error ?? null}
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
            >
                <ConfirmForm
                    action={discardAction}
                    runId={runId}
                    error={discardState?.error ?? null}
                    onCancel={close}
                    submitLabel="Discard preview"
                    pendingLabel="Discarding…"
                    variant="danger"
                />
            </Dialog>
        </>
    );
}
