import type { Book, Entry } from "@/lib/domain";

/**
 * What a page shows beside an entry's label: its variant note ("Descant -
 * last stanza only"), then its location ("inside back cover") unless the
 * label already says it. A numbered book labels an entry that has no number
 * by its location ("G-Front Cover", see `formatEntryLabel`), so there the
 * location is not repeated. Blank notes are left out.
 */
export function entryNotes(
    book: Pick<Book, "numbered">,
    entry: Pick<Entry, "number" | "locationLabel" | "variantNote">
): string[] {
    const notes: string[] = [];
    const variant = entry.variantNote?.trim() ?? "";
    if (variant !== "") {
        notes.push(variant);
    }
    const location = entry.locationLabel?.trim() ?? "";
    const labelShowsLocation = book.numbered && entry.number === null;
    if (location !== "" && !labelShowsLocation) {
        notes.push(location);
    }
    return notes;
}
