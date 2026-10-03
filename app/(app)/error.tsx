"use client";

import { useEffect } from "react";
import ErrorState from "@/app/components/ui/ErrorState";

// The shell-level error boundary: it catches errors below the (app) layout, so
// the navigation bar stays on screen.
export default function AppError({
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
            message="Something went wrong while loading this page."
            reset={reset}
        />
    );
}
