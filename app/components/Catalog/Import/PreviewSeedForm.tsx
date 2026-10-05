"use client";

import { useActionState } from "react";
import { previewSeedImportAction } from "@/app/(app)/catalog/import/actions";
import SubmitButton from "@/app/components/ui/SubmitButton";

/**
 * The "Preview seed from hymns.json" button. Its action stores a preview and
 * redirects to the new run's page; it only comes back here with a message
 * when the preview failed.
 */
export default function PreviewSeedForm() {
    const [state, formAction] = useActionState(previewSeedImportAction, null);

    return (
        <form action={formAction}>
            {state && (
                <p
                    role="alert"
                    className="mb-3 text-sm text-red-600 dark:text-red-400"
                >
                    {state.error}
                </p>
            )}
            <SubmitButton pendingLabel="Reading hymns.json…">
                Preview seed from hymns.json
            </SubmitButton>
        </form>
    );
}
