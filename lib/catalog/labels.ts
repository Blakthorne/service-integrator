import type { Book, Entry } from "@/lib/domain";

/** Where the number goes in a numbered book's label format ("R-{n}"). */
export const NUMBER_PLACEHOLDER = "{n}";

/** "front cover" → "Front Cover": every word's first letter upper-cased, the rest kept. */
function titleCase(text: string): string {
    return text.replace(/(^|\s)(\S)/g, (_, space: string, letter: string) =>
        space + letter.toUpperCase()
    );
}

/**
 * An entry's label, as lists, pages and schedule text show it.
 *
 * - A numbered book's label format has its `{n}` replaced by the entry's
 *   number ("R-396"), by its location, title-cased, when it has no number
 *   ("G-Front Cover"), or by "?" when it has neither.
 * - An unnumbered book's entries are all labelled with its label format,
 *   which is its short name ("Chorus Book").
 *
 * A variant note is shown beside the label, never inside it. Pages get
 * entries already labelled (`LabelledEntry`), so client components never
 * call this.
 */
export function formatEntryLabel(
    book: Pick<Book, "numbered" | "labelFormat">,
    entry: Pick<Entry, "number" | "locationLabel">
): string {
    if (!book.numbered) {
        return book.labelFormat;
    }
    const location = entry.locationLabel?.trim() ?? "";
    const value =
        entry.number !== null
            ? String(entry.number)
            : location !== ""
              ? titleCase(location)
              : "?";
    return book.labelFormat.replaceAll(NUMBER_PLACEHOLDER, value);
}
