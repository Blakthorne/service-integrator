interface CatalogCardProps {
    /** The card's heading, an `<h2>` that names the card for screen readers. */
    title: string;
    /** The heading's id, unique on the page. */
    headingId: string;
    /** A link beside the heading, such as one to the tune's page. */
    action?: React.ReactNode;
    /** Whether the body runs to the card's edges, as a table does; otherwise it is padded. */
    flush?: boolean;
    children: React.ReactNode;
}

/** A titled card of a catalog page, such as a song's Hymn or Tune. */
export default function CatalogCard({
    title,
    headingId,
    action,
    flush = false,
    children,
}: CatalogCardProps) {
    return (
        <section
            aria-labelledby={headingId}
            className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden"
        >
            <div
                className={`flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 sm:px-6 pt-4 sm:pt-6 ${
                    flush ? "pb-4" : ""
                }`}
            >
                <h2
                    id={headingId}
                    className="text-xl font-semibold text-gray-900 dark:text-gray-100"
                >
                    {title}
                </h2>
                {action}
            </div>
            {flush ? (
                children
            ) : (
                <div className="px-4 sm:px-6 pt-4 pb-4 sm:pb-6">{children}</div>
            )}
        </section>
    );
}

interface CardFieldProps {
    label: string;
    children: React.ReactNode;
}

/** One labelled value of a card, inside a `<dl>`. */
export function CardField({ label, children }: CardFieldProps) {
    return (
        <div>
            <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                {label}
            </dt>
            <dd className="mt-1 text-gray-900 dark:text-gray-100">{children}</dd>
        </div>
    );
}

/** Muted text for a field with no value, such as "Not recorded". */
export function NoValue({ children }: { children: React.ReactNode }) {
    return <span className="text-gray-500 dark:text-gray-400">{children}</span>;
}

/** The look of a text link on catalog pages. */
export const LINK_CLASS =
    "text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:underline";
