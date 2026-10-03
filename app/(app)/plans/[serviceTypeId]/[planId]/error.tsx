"use client";

import { useEffect } from "react";
import ErrorState from "@/app/components/ui/ErrorState";

/**
 * Catches errors in the plan page's header, items table or tab nav (the
 * `(overview)` layout) and in item pages; a tab's own errors stop at
 * `(overview)/error.tsx`. It sits below the PlanProvider in the `[planId]`
 * layout, so the Schedule tab's selections survive the error and the retry.
 */
export default function PlanPageError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        console.error(error);
    }, [error]);

    return (
        <ErrorState
            message="Something went wrong while showing this part of the plan."
            reset={reset}
        />
    );
}
