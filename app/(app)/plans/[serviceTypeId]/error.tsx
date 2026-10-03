"use client";

import { useEffect } from "react";
import ErrorState from "@/app/components/ui/ErrorState";

/**
 * Catches a failure to load the plan in the `[planId]` layout. It sits one
 * level up because a segment's own error.tsx does not cover its own layout.
 */
export default function PlanError({
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
        <div className="font-sans">
            <ErrorState message="Failed to load this plan" reset={reset} />
        </div>
    );
}
