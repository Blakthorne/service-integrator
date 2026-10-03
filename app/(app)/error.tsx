"use client";

import { startTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
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
    const router = useRouter();

    useEffect(() => {
        console.error(error);
    }, [error]);

    return (
        <ErrorState
            message="Something went wrong while loading this page."
            onRetry={() => {
                // reset() alone only re-renders with the cached server data;
                // refresh() makes the server render the page again.
                startTransition(() => {
                    router.refresh();
                    reset();
                });
            }}
        />
    );
}
