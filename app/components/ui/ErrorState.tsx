"use client";

import { startTransition } from "react";
import { useRouter } from "next/navigation";

type ErrorStateProps = { message: string } & (
    | {
          /**
           * Pass the error boundary's `reset`; this component refreshes server
           * data first.
           */
          reset: () => void;
          onRetry?: never;
      }
    | {
          /**
           * For a failure outside an error boundary that has its own retry (a
           * server action, a client-side request). Without it there is no
           * button.
           */
          onRetry?: () => void;
          reset?: never;
      }
);

/**
 * A centered error message with a "Try Again" button.
 *
 * In an `error.tsx`, pass the boundary's `reset` and nothing else. The button
 * calls `router.refresh()` and then `reset()` in a transition. `reset()` alone
 * only re-renders with what the client already has, so a server render that
 * failed would not run again; the refresh makes the server render it afresh.
 */
export default function ErrorState({
    message,
    reset,
    onRetry,
}: ErrorStateProps) {
    const router = useRouter();

    const retry = reset
        ? () => {
              startTransition(() => {
                  router.refresh();
                  reset();
              });
          }
        : onRetry;

    return (
        <div role="alert" className="text-center py-12">
            <p className="text-red-600 dark:text-red-400 mb-4">{message}</p>
            {retry && (
                <button
                    type="button"
                    onClick={retry}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors cursor-pointer"
                >
                    Try Again
                </button>
            )}
        </div>
    );
}
