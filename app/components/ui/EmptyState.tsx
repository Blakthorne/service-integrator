interface EmptyStateProps {
    title: string;
    description?: string;
    /** A call to action, such as a `<Link>` back to the list. */
    action?: React.ReactNode;
}

/** A centered "nothing here" message, for a missing item or an empty list. */
export default function EmptyState({
    title,
    description,
    action,
}: EmptyStateProps) {
    return (
        <div className="text-center py-12">
            <h2 className="text-lg font-medium text-gray-900 dark:text-gray-100">
                {title}
            </h2>
            {description && (
                <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                    {description}
                </p>
            )}
            {action && <div className="mt-4">{action}</div>}
        </div>
    );
}
