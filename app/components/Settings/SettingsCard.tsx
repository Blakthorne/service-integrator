interface SettingsCardProps {
    /** The card's heading, an `<h2>` that names the card for screen readers. */
    title: string;
    /** The heading's id, unique on the page. */
    headingId: string;
    /** What the card is for, under its heading. Inline content only: it renders inside a `<p>`. */
    description?: React.ReactNode;
    children: React.ReactNode;
}

/**
 * A card of the Settings page, as the Database and Planning Center sync
 * cards look: a titled section with a sentence about it, then its content.
 */
export default function SettingsCard({ title, headingId, description, children }: SettingsCardProps) {
    return (
        <section
            aria-labelledby={headingId}
            className="max-w-3xl mx-auto bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6"
        >
            <h2
                id={headingId}
                className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2"
            >
                {title}
            </h2>
            {description && (
                <p className="mb-4 text-sm text-gray-600 dark:text-gray-300">{description}</p>
            )}
            {children}
        </section>
    );
}

interface SettingsCardFallbackProps {
    title: string;
    headingId: string;
    /** What is being read, e.g. "Reading the service types from Planning Center…". */
    label: string;
}

/**
 * What a card shows until the Planning Center reads it depends on come
 * back: its heading, so the page does not jump, and what it is waiting
 * for, announced to screen readers.
 */
export function SettingsCardFallback({ title, headingId, label }: SettingsCardFallbackProps) {
    return (
        <SettingsCard title={title} headingId={headingId}>
            <p role="status" className="text-sm text-gray-600 dark:text-gray-300">
                {label}
            </p>
        </SettingsCard>
    );
}
