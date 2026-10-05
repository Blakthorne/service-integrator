import type { Book, LabelledEntry } from "@/lib/domain";
import type { FormLink } from "@/lib/forms";
import { routes } from "@/lib/routes";
import { formatCount } from "./counts";
import { previewEntryLabel, type MoveDirection } from "./validation";

/**
 * The song page's Books card in edit mode: what its entry forms start
 * with, the label they will make, where an entry of a book without numbers
 * stands and whether it can move, and what is said after each change.
 * Pure and safe on both sides: the card is a client component, and the
 * page's actions use `twinEntry` and `twinEntryLink`.
 */

/** A book as the card needs it: how it labels, whether it is in use, and how many entries it has (an unnumbered book's last position). */
export type EntryEditorBook = Pick<
    Book,
    "id" | "code" | "name" | "shortName" | "numbered" | "labelFormat" | "active"
> & { entryCount: number };

/** The fields an entry form posts besides its ids, as `validateNewEntry` and `validateEntryEdit` read them. */
export const ENTRY_FORM_FIELDS = ["placement", "number", "location", "position", "variantNote"] as const;

export type EntryFormField = (typeof ENTRY_FORM_FIELDS)[number];

/** What an entry form's fields hold, as text by field. */
export type EntryFormValues = Record<EntryFormField, string>;

/**
 * The Add form's fields for `book`: a numbered book takes a number (or a
 * location); a book without numbers takes the song at its end.
 */
export function newEntryValues(book: Pick<Book, "numbered">): EntryFormValues {
    return {
        placement: book.numbered ? "number" : "end",
        number: "",
        location: "",
        position: "",
        variantNote: "",
    };
}

/**
 * An entry's Edit form as it starts: its number, or its location (the
 * front cover), in a numbered book; its position in a book without
 * numbers, which the form can change; and its variant note.
 */
export function editEntryValues(
    entry: Pick<LabelledEntry, "number" | "position" | "locationLabel" | "variantNote">,
    book: Pick<Book, "numbered">
): EntryFormValues {
    const values: EntryFormValues = {
        placement: "number",
        number: "",
        location: "",
        position: "",
        variantNote: entry.variantNote ?? "",
    };
    if (!book.numbered) {
        return { ...values, placement: "position", position: entry.position === null ? "" : String(entry.position) };
    }
    if (entry.number === null) {
        return { ...values, placement: "location", location: entry.locationLabel ?? "" };
    }
    return { ...values, number: String(entry.number) };
}

/**
 * The label the fields make in `book`, shown under them as they are typed
 * in: "R-396", "G-Front Cover", an unnumbered book's short name; null while
 * what is typed makes none.
 */
export function entryFormLabel(
    book: Pick<Book, "numbered" | "labelFormat">,
    values: Pick<EntryFormValues, "placement" | "number" | "location">
): string | null {
    return previewEntryLabel(book, {
        placement: values.placement === "location" ? "location" : "number",
        number: values.number,
        location: values.location,
    });
}

/** Where an entry of a book without numbers stands: "position 3 of 12"; null in a numbered book. */
export function describeEntryPosition(
    entry: Pick<LabelledEntry, "position">,
    book: Pick<EntryEditorBook, "numbered" | "entryCount">
): string | null {
    if (book.numbered || entry.position === null) {
        return null;
    }
    return `position ${formatCount(entry.position)} of ${formatCount(book.entryCount)}`;
}

/**
 * Whether an entry can move up (it is not first) and down (it is not
 * last) in its book's order: only in a book without numbers.
 */
export function entryMoves(
    entry: Pick<LabelledEntry, "position">,
    book: Pick<EntryEditorBook, "numbered" | "entryCount">
): { up: boolean; down: boolean } {
    if (book.numbered || entry.position === null) {
        return { up: false, down: false };
    }
    return { up: entry.position > 1, down: entry.position < book.entryCount };
}

/** What Move up and Move down say: where the entry is now, or that it was at the edge already. */
export function describeEntryMove(
    direction: MoveDirection,
    { changed, position }: { changed: boolean; position: number },
    book: Pick<EntryEditorBook, "name" | "entryCount">
): string {
    if (!changed) {
        return `Already ${direction === "up" ? "first" : "last"} in ${book.name}.`;
    }
    return `Moved ${direction}: now ${formatCount(position)} of ${formatCount(book.entryCount)} in ${book.name}.`;
}

/** What the Add form says once the entry is added: "Added R-396.", or the end of a book without numbers. */
export function describeEntryAdded(label: string, book: Pick<Book, "name" | "numbered">): string {
    return book.numbered ? `Added ${label}.` : `Added to the end of ${book.name}.`;
}

/** What an entry's Edit form says once it is saved. */
export function describeEntrySaved(label: string, book: Pick<Book, "name" | "numbered">): string {
    return book.numbered ? `Saved ${label}.` : `Saved the entry in ${book.name}.`;
}

/** What the card says once an entry is deleted. */
export function describeEntryDeleted(label: string, book: Pick<Book, "name" | "numbered">): string {
    return book.numbered ? `Deleted ${label}.` : `Deleted the entry in ${book.name}.`;
}

/** The Delete dialog's question and what it says under it. */
export function deleteEntryQuestion(
    entry: Pick<LabelledEntry, "label" | "variantNote">,
    book: Pick<Book, "name" | "numbered">
): { title: string; description: string } {
    const variant = entry.variantNote === null ? "" : ` (${entry.variantNote})`;
    const title = book.numbered
        ? `Delete ${entry.label}${variant}?`
        : `Delete the entry in ${book.name}${variant}?`;
    const after = book.numbered ? "" : ` The entries after it in ${book.name} move up one.`;
    return {
        title,
        description: `The song stays in the catalog, with its other entries.${after}`,
    };
}

/**
 * The song's other entry in book `bookId` with the same variant note (or,
 * for `null`, with none), which an entry with that note would clash with
 * (a song is in a book once per variant note); `exceptEntryId` is the entry
 * being edited, which is not its own twin.
 */
export function twinEntry(
    entries: readonly LabelledEntry[],
    bookId: number,
    variantNote: string | null,
    exceptEntryId: number | null
): LabelledEntry | undefined {
    return entries.find(
        (entry) =>
            entry.bookId === bookId && entry.variantNote === variantNote && entry.id !== exceptEntryId
    );
}

/** A link from a refusal to the entry it clashes with: its label, linking to its book's page. */
export function twinEntryLink(twin: Pick<LabelledEntry, "bookCode" | "label">): FormLink {
    return { href: routes.catalogBook(twin.bookCode), label: twin.label };
}

/**
 * The entry to hand focus to when `removedId` leaves the list `ids`: the
 * one after it, else the one before; null when it was the only one, or is
 * not in the list.
 */
export function entryAfterRemoval(ids: readonly number[], removedId: number): number | null {
    const index = ids.indexOf(removedId);
    if (index === -1) {
        return null;
    }
    return ids[index + 1] ?? ids[index - 1] ?? null;
}
