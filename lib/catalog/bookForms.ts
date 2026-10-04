import type { BookProblem } from "@/lib/db/books";
import type { CatalogRowRef } from "@/lib/db/catalogEdit";
import type { Book } from "@/lib/domain";
import type { FieldErrors, FormLink } from "@/lib/forms";
import { routes } from "@/lib/routes";
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
 * fields start with, a preview of how the book labels an entry, the form's
 * errors from what the catalog refused, and the sentences that follow a
 * move. Pure and safe on both sides: the forms are client components, and
 * their actions (`app/(app)/catalog/books/actions.ts`) build the same
 * states, which the tests here pin.
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

/** A link to the catalog row a problem is about: a book's page, a song's or a tune's. */
export function linkToRow(row: CatalogRowRef): FormLink {
    switch (row.kind) {
        case "book":
            return { href: routes.catalogBook(row.code), label: row.label };
        case "song":
            return { href: routes.catalogSong(row.songId), label: row.label };
        case "tune":
            return { href: routes.catalogTune(row.tuneId), label: row.label };
    }
}

/**
 * What a book form says above its button when a field needs fixing. It does
 * not say where the fields are, or what colour they are marked in: the
 * message sits below them, and a person who cannot see colour must find them.
 */
export const FIX_BOOK_FIELDS_MESSAGE =
    "Nothing was saved. Fix the fields that have an error message, then try again.";

/**
 * A refused book form as it shows: the sentence above the button, and the
 * errors to mark on the fields. A refusal about the book itself (it is not
 * in the catalog any more, or its id was not an id) has no field to mark, so
 * its message is the form's own.
 */
export function bookFieldsRefusal(errors: FieldErrors<BookPart>): {
    message: string;
    fieldErrors: FieldErrors<BookPart>;
} {
    const { book, ...fields } = errors;
    return { message: book?.message ?? FIX_BOOK_FIELDS_MESSAGE, fieldErrors: fields };
}

/**
 * A refused book edit as a form shows it (`bookFieldsRefusal`): each part's
 * first problem, with a link to the book that has a code that is taken.
 */
export function bookRefusal(problems: readonly BookProblem[]): {
    message: string;
    fieldErrors: FieldErrors<BookPart>;
} {
    const fieldErrors: FieldErrors<BookPart> = {};
    for (const { part, message, existing } of problems) {
        fieldErrors[part] ??= { message, ...(existing && { link: linkToRow(existing) }) };
    }
    return bookFieldsRefusal(fieldErrors);
}

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
