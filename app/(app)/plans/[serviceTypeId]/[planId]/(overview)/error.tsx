"use client";

import { useEffect } from "react";
import ErrorState from "@/app/components/ui/ErrorState";

/**
 * Catches an error in the Copyright or Schedule tab. It sits inside the
 * `(overview)` layout, so the plan header, the items table and the tab nav
 * stay on screen and the other tab is a click away, and below PlanProvider,
 * so the Schedule tab's selections survive. Errors in the layout itself or in
 * an item page go to `[planId]/error.tsx`.
 */
export default function PlanTabError({
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
            message="Something went wrong while showing this tab."
            reset={reset}
        />
    );
}
