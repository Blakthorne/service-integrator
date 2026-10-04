interface LoadingStateProps {
    /** What is loading, e.g. "Loading plans…". Shown under the spinner and announced to screen readers. */
    label: string;
}

/** A centered spinner with a label, for `loading.tsx` files and Suspense fallbacks. */
export default function LoadingState({ label }: LoadingStateProps) {
    return (
        <div role="status" className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
            <p className="text-gray-600 dark:text-gray-300">{label}</p>
        </div>
    );
}
