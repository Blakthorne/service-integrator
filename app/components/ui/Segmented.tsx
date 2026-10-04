/** One choice of a `Segmented` control. */
export interface SegmentedOption<T extends string> {
    value: T;
    label: string;
    /**
     * The choice's full name, for a short `label` ("Rejoice" for "Rejoice
     * Hymns"): its tooltip and accessible description. The label stays its
     * accessible name, so voice control finds it by what it shows.
     */
    title?: string;
}

interface SegmentedProps<T extends string> {
    /** The value of the chosen option. */
    value: T;
    options: readonly SegmentedOption<T>[];
    onChange: (next: T) => void;
    /** Names the group for screen readers, such as "Filter by book". */
    ariaLabel: string;
}

/**
 * A row of buttons of which one is chosen, for a filter or a sort order. Each
 * is a toggle button (`aria-pressed`) in a labelled group, reached with Tab.
 * Choosing the chosen one again calls `onChange` with the same value. When
 * the row is wider than its container (a phone), it scrolls sideways rather
 * than widen the page.
 */
export default function Segmented<T extends string>({
    value,
    options,
    onChange,
    ariaLabel,
}: SegmentedProps<T>) {
    return (
        <div
            role="group"
            aria-label={ariaLabel}
            className="inline-flex max-w-full overflow-x-auto rounded-md border border-gray-300 dark:border-gray-600"
        >
            {options.map((option) => {
                const isActive = option.value === value;
                return (
                    <button
                        key={option.value}
                        type="button"
                        aria-pressed={isActive}
                        title={option.title}
                        onClick={() => onChange(option.value)}
                        // The focus ring is inset: the group's overflow would
                        // clip one drawn outside the button.
                        className={`shrink-0 whitespace-nowrap px-3 py-2 text-sm font-medium transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 ${
                            isActive
                                ? "bg-blue-500 text-white"
                                : "bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600"
                        }`}
                    >
                        {option.label}
                    </button>
                );
            })}
        </div>
    );
}
