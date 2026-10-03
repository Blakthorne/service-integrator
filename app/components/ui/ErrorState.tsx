"use client";

interface ErrorStateProps {
    message: string;
    /** Shows a "Try Again" button that calls this. Leave it out when there is nothing to retry. */
    onRetry?: () => void;
}

/**
 * A centered error message with an optional retry button, for `error.tsx`
 * files and inline failures. To retry a server render, do not call `reset()`
 * alone: wrap `router.refresh()` and `reset()` in `startTransition`.
 */
export default function ErrorState({ message, onRetry }: ErrorStateProps) {
    return (
        <div role="alert" className="text-center py-12">
            <p className="text-red-600 dark:text-red-400 mb-4">{message}</p>
            {onRetry && (
                <button
                    type="button"
                    onClick={onRetry}
                    className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors cursor-pointer"
                >
                    Try Again
                </button>
            )}
        </div>
    );
}
