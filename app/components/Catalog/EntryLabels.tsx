import type { LabelledEntry } from "@/lib/domain";

interface EntryLabelsProps {
    /** A song's entries, in book order. */
    entries: readonly Pick<LabelledEntry, "id" | "label" | "variantNote">[];
}

/**
 * Where a song is in the books: each entry's label ("R-396"), with its
 * variant note beside it, never inside it ("G-518 (Descant - last stanza
 * only)").
 */
export default function EntryLabels({ entries }: EntryLabelsProps) {
    if (entries.length === 0) {
        return (
            <span className="text-gray-500 dark:text-gray-400">Not in a book</span>
        );
    }
    return (
        <ul className="flex flex-wrap gap-x-3 gap-y-0.5">
            {entries.map((entry) => (
                <li key={entry.id}>
                    <span className="whitespace-nowrap tabular-nums">
                        {entry.label}
                    </span>
                    {entry.variantNote && (
                        <span className="ml-1 text-xs text-gray-500 dark:text-gray-400">
                            ({entry.variantNote})
                        </span>
                    )}
                </li>
            ))}
        </ul>
    );
}
