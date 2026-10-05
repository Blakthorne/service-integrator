import type { Book } from "@/lib/domain";
import { formatEntryLabel } from "./labels";
import {
    BOOK_FIELDS,
    BOOK_NO,
    BOOK_YES,
    NEW_BOOK_FIELDS,
    cleanText,
    defaultLabelFormat,
    labelFormatProblem,
    type BookPart,
    type MoveDirection,
} from "./validation";

/**
 * What the book forms (Add a book on the books page, Edit on a book's page)
 * and their Move up and Move down buttons show and say: the values their
 * fields start with, a preview of how the book labels an entry, which parts
 * of the forms are fields, and the sentences that follow a move. Pure and
 * safe on both sides: the forms are client components, and their actions
 * (`app/(app)/catalog/books/actions.ts`) build the same states, with the
 * refusals of `lib/catalog/editForms.ts`.
 */

/** What the Add a book form posts, or starts with, by field. */
export type NewBookValues = Record<(typeof NEW_BOOK_FIELDS)[number], string>;

/** The Add a book form with nothing typed: a numbered book, which most are. */
export const EMPTY_NEW_BOOK: NewBookValues = {
    code: "",
    name: "",
    shortName: "",
    numbered: BOOK_YES,
    labelFormat: "",
};

/** What a book's Edit form posts, or starts with, by field. */
export type BookEditValues = Record<(typeof BOOK_FIELDS)[number], string>;

/**
 * A book's Edit form as it starts, and as it reads once saved: the book as
 * stored, so a short name or label format left blank shows the default it
 * became.
 */
export function bookEditValues(
    book: Pick<Book, "id" | "name" | "shortName" | "labelFormat" | "active">
): BookEditValues {
    return {
        bookId: String(book.id),
        name: book.name,
        shortName: book.shortName,
        labelFormat: book.labelFormat,
        active: book.active ? BOOK_YES : BOOK_NO,
    };
}

/** The number a preview of a numbered book's label uses: R-396 is the church's best-known. */
export const PREVIEW_ENTRY_NUMBER = 396;

/** What the fields say about how a book labels its entries. */
export interface BookLabelFields {
    code: string;
    name: string;
    shortName: string;
    labelFormat: string;
    numbered: boolean;
}

/**
 * How a book labels an entry, as the form's fields would make it, for the
 * preview under them: the label of a sample entry, or what is wrong with the
 * label format, or null while there is nothing to show yet (a numbered book
 * with no code to build the default from, a book with no name).
 */
export type BookLabelPreview =
    | { kind: "label"; /** The words before the label. */ lead: string; label: string }
    | { kind: "problem"; message: string }
    | null;

/**
 * Preview a book's label from the fields as typed, with the same defaults
 * the form's reader applies: a blank short name is the name, and a blank
 * label format is `CODE-{n}` for a numbered book and the short name for one
 * without numbers (`defaultLabelFormat`). A format that does not suit the
 * book (`labelFormatProblem`) is the preview's problem, so it is seen
 * before Add is pressed.
 */
export function previewBookLabel({
    code,
    name,
    shortName,
    labelFormat,
    numbered,
}: BookLabelFields): BookLabelPreview {
    const short = cleanText(shortName) || cleanText(name);
    const typed = cleanText(labelFormat);
    const typedCode = code.trim();
    const format =
        typed !== ""
            ? typed
            : numbered
              ? typedCode === ""
                  ? ""
                  : defaultLabelFormat(typedCode, true, short)
              : short;
    if (format === "") {
        return null;
    }
    const problem = labelFormatProblem(format, numbered);
    if (problem !== null) {
        return { kind: "problem", message: problem };
    }
    return {
        kind: "label",
        lead: numbered ? `An entry numbered ${PREVIEW_ENTRY_NUMBER} is labelled` : "Every entry is labelled",
        label: formatEntryLabel(
            { numbered, labelFormat: format },
            { number: numbered ? PREVIEW_ENTRY_NUMBER : null, locationLabel: null }
        ),
    };
}

/**
 * What leaving a book out of use does, as the hint under the in-use choice
 * says it. A book that is not in use is still in the catalog: its page and
 * its entries on song pages stay.
 */
export const NOT_IN_USE_EXPLANATION =
    "A book that is not in use stays browsable here, but its entries are left out of the schedule text, the hymnal notes and the songs list's book filter.";

/**
 * The hint under a book's label field: what the label is, and what leaving
 * it blank gives. A numbered book's label has `{n}` where the number goes.
 */
export function labelFormatHint(numbered: boolean, code: string): string {
    if (numbered) {
        const prefix = code.trim() === "" ? "the code" : code.trim();
        return `Write {n} where the number goes, as in R-{n}. Leave blank for ${prefix}-{n}.`;
    }
    return "A book without numbers labels every entry alike, as in Chorus Book. Leave blank for the short name.";
}

/**
 * The parts of the book forms that are fields, which an error marks: every
 * part but "book", the hidden id of the book an Edit form is for. A refusal
 * about that one has no field to mark, so it is the form's own message
 * (`formRefusal` and `editRefusal` in `lib/catalog/editForms.ts`, which the
 * actions call with these).
 */
export const BOOK_FIELD_PARTS: readonly BookPart[] = [
    "code",
    "name",
    "shortName",
    "numbered",
    "labelFormat",
    "active",
];

/** What the Add a book form says once the book is added. */
export function describeAddedBook({ code, name }: { code: string; name: string }): string {
    return `Added ${name} (${code}).`;
}

/** What a book's Edit form says once it is saved. */
export const BOOK_SAVED_MESSAGE = "Saved.";

/** What a Move up or Move down button brings back: the new place, whether anything moved, or why not. */
export type MoveOutcome =
    | { ok: true; changed: boolean; place: number }
    | { ok: false; message: string };

/** "up" is towards the start of the list, "down" towards its end. */
function edgeWord(direction: MoveDirection): string {
    return direction === "up" ? "first" : "last";
}

/**
 * What the list says after a Move on `name`, in a status region: where the
 * book (or entry) is now, or that it was at the edge already.
 */
export function describeMove(
    name: string,
    direction: MoveDirection,
    { changed, place }: { changed: boolean; place: number },
    noun: "book" | "entry"
): string {
    if (!changed) {
        return `${name} is already ${edgeWord(direction)}.`;
    }
    return noun === "book"
        ? `Moved ${name} ${direction}. It is now number ${place} in the list.`
        : `Moved ${name} ${direction}. It is now at position ${place}.`;
}
