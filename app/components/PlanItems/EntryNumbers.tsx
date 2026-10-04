import type { LabelledEntry } from "@/lib/domain";
import { scheduleEntries } from "@/lib/serviceSchedule";

interface EntryNumbersProps {
    /** The linked catalog song's entries, in book order. */
    entries: readonly Pick<LabelledEntry, "id" | "label" | "variantNote">[];
}

/**
 * Where a linked song is in the books, as its Schedule tab card shows it:
 * each entry's label ("R-396", "G-Front Cover") with its variant note beside
 * it, never inside it. The labels that Numbers prints (see
 * `scheduleEntries`) are bold; a descant printed beside them is not.
 */
export default function EntryNumbers({ entries }: EntryNumbersProps) {
    if (entries.length === 0) {
        return (
            <p className="text-sm text-gray-600 dark:text-gray-400">
                Not in a book, so there are no numbers to print.
            </p>
        );
    }
    const printed = new Set(scheduleEntries(entries));
    return (
        <ul aria-label="Numbers" className="flex flex-wrap gap-x-4 gap-y-1">
            {entries.map((entry) => (
                <li key={entry.id} className="flex items-baseline gap-1.5">
                    <span
                        className={`text-base tabular-nums whitespace-nowrap ${
                            printed.has(entry)
                                ? "font-semibold text-gray-900 dark:text-gray-100"
                                : "text-gray-500 dark:text-gray-400"
                        }`}
                    >
                        {entry.label}
                    </span>
                    {entry.variantNote && (
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                            ({entry.variantNote})
                        </span>
                    )}
                </li>
            ))}
        </ul>
    );
}
