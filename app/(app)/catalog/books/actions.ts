"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import {
    BOOK_FIELD_PARTS,
    BOOK_SAVED_MESSAGE,
    EMPTY_NEW_BOOK,
    bookEditValues,
    describeAddedBook,
    type MoveOutcome,
} from "@/lib/catalog/bookForms";
import { editRefusal, formRefusal } from "@/lib/catalog/editForms";
import {
    BOOK_FIELDS,
    NEW_BOOK_FIELDS,
    validateBookEdit,
    validateBookMove,
    validateEntryMove,
    validateNewBook,
} from "@/lib/catalog/validation";
import {
    FORM_FAILURE_MESSAGE,
    formError,
    formSuccess,
    readValues,
    type FieldErrors,
    type FormState,
    type FormValues,
} from "@/lib/forms";
import { getCatalogBooks } from "@/lib/queries/catalog";
import {
    addCatalogBook,
    editCatalogBook,
    moveCatalogBook,
    moveCatalogEntry,
    type BookEditResult,
    type BookMoveResult,
    type EntryMoveResult,
} from "@/lib/queries/catalogEdit";
import { routes } from "@/lib/routes";

/**
 * The books pages' actions: Add a book, a book's Edit form, and the Move up
 * and Move down buttons of the books list and of an unnumbered book's
 * entries.
 *
 * Each is called from an event handler with its pending state in
 * `useState`, as Settings' forms are (convention 15), and not as a form
 * action: a change to a book changes the text of every plan page and the
 * dashboard, and a form action's transition would last until the page it
 * revalidated had been rendered again. They write only to the local
 * database.
 *
 * Each is a public POST endpoint, so it checks the session first and throws
 * without one, then reads what it was sent with the readers in
 * `lib/catalog/validation.ts`, which parse every id (convention 19). A
 * refusal (a field to fix, a code that is taken, a book that is gone) comes
 * back as a value for the form to show; anything unexpected is logged and
 * comes back as a message that nothing was changed. After a change each
 * revalidates the pages that show what changed.
 */

/**
 * A server action is a public POST endpoint, so it checks the session
 * itself rather than relying on the middleware (convention 15), and throws
 * without one.
 */
async function requireSession(): Promise<void> {
    const session = await auth();
    if (!session) {
        throw new Error("Not signed in");
    }
}

/** Log a failure nobody expected, and give the form the generic message. */
function failed(what: string, error: unknown, values: FormValues): FormState {
    console.error(`Failed to ${what}:`, error);
    return formError(FORM_FAILURE_MESSAGE, { values });
}

/** The first message of a form's errors, for a button that has no field to show them on. */
function firstMessage(errors: FieldErrors): string {
    return Object.values(errors)[0]?.message ?? FORM_FAILURE_MESSAGE;
}

/**
 * Every page that shows a book's name, label, order or whether it is in use:
 * the catalog's (the books and their pages, the songs list's book filter,
 * every song's entry labels), the plan pages (their schedule text and
 * hymnal notes print the labels, in book order, of books in use) and the
 * dashboard (the same numbers).
 */
function revalidateBookPages(): void {
    revalidatePath(routes.catalog(), "layout");
    revalidatePath(routes.plans(), "layout");
    revalidatePath(routes.home());
}

/**
 * The Add a book form's action: read its fields (`validateNewBook`: a code
 * `parseBookCode` accepts, a name, a short name, numbered or not, and a
 * label format that suits it), then add the book last in the order and in
 * use (`addCatalogBook`). A field that needs fixing, a code another book
 * has in any case, or a label format that does not suit the book comes back
 * as an error on its field. On success the form comes back empty, with what
 * was added. A new book has no entries, so only the catalog's pages change.
 */
export async function addBookAction(formData: FormData): Promise<FormState> {
    await requireSession();
    const posted = readValues(formData, NEW_BOOK_FIELDS);
    const checked = validateNewBook(formData);
    if (!checked.ok) {
        const { message, fieldErrors } = formRefusal(checked.fieldErrors, BOOK_FIELD_PARTS);
        return formError(message, { fieldErrors, values: posted });
    }
    let result: BookEditResult;
    try {
        result = addCatalogBook(checked.input);
    } catch (error) {
        return failed("add a book", error, posted);
    }
    if (!result.ok) {
        const { message, fieldErrors } = editRefusal(result.problems, BOOK_FIELD_PARTS);
        return formError(message, { fieldErrors, values: posted });
    }
    revalidatePath(routes.catalog(), "layout");
    return formSuccess(
        describeAddedBook({ code: result.code, name: checked.input.name }),
        EMPTY_NEW_BOOK
    );
}

/**
 * A book's Edit form's action: read its fields (`validateBookEdit`), then
 * change the book's name, short name, label format and whether it is in use
 * (`editCatalogBook`). A short name or label format left blank becomes its
 * default, so the form comes back with the book as stored (the posted
 * values when it cannot be read again: the change is made either way).
 */
export async function saveBookAction(formData: FormData): Promise<FormState> {
    await requireSession();
    const posted = readValues(formData, BOOK_FIELDS);
    const checked = validateBookEdit(formData);
    if (!checked.ok) {
        const { message, fieldErrors } = formRefusal(checked.fieldErrors, BOOK_FIELD_PARTS);
        return formError(message, { fieldErrors, values: posted });
    }
    let result: BookEditResult;
    try {
        result = editCatalogBook(checked.input);
    } catch (error) {
        return failed(`save book ${checked.input.bookId}`, error, posted);
    }
    if (!result.ok) {
        const { message, fieldErrors } = editRefusal(result.problems, BOOK_FIELD_PARTS);
        return formError(message, { fieldErrors, values: posted });
    }
    revalidateBookPages();
    let values = posted;
    try {
        const stored = getCatalogBooks().find(({ id }) => id === result.bookId);
        if (stored) {
            values = bookEditValues(stored);
        }
    } catch (error) {
        console.error(`Failed to read book ${result.bookId} after saving it:`, error);
    }
    return formSuccess(BOOK_SAVED_MESSAGE, values);
}

/**
 * A book's Move up or Move down button: read the book and the direction
 * (`validateBookMove`), then swap the book with its neighbour in the order
 * books are listed in (`moveCatalogBook`). It says where the book is now,
 * and whether anything moved: the first book moved up stays. The order
 * decides how a song's labels are ordered, so a move revalidates the pages
 * that print them.
 */
export async function moveBookAction(formData: FormData): Promise<MoveOutcome> {
    await requireSession();
    const checked = validateBookMove(formData);
    if (!checked.ok) {
        return { ok: false, message: firstMessage(checked.fieldErrors) };
    }
    let result: BookMoveResult;
    try {
        result = moveCatalogBook(checked.input.bookId, checked.input.direction);
    } catch (error) {
        console.error(`Failed to move book ${checked.input.bookId}:`, error);
        return { ok: false, message: FORM_FAILURE_MESSAGE };
    }
    if (!result.ok) {
        return { ok: false, message: result.problems[0].message };
    }
    if (result.changed) {
        revalidateBookPages();
    }
    return { ok: true, changed: result.changed, place: result.sortOrder };
}

/**
 * An entry's Move up or Move down button, on the page of a book without
 * numbers: read the entry and the direction (`validateEntryMove`), then swap
 * the entry with its neighbour (`moveCatalogEntry`; the book decides, so an
 * entry of a numbered book is refused). Positions only show on the
 * catalog's pages, which are all it revalidates: a book without numbers
 * labels every entry alike.
 */
export async function moveEntryAction(formData: FormData): Promise<MoveOutcome> {
    await requireSession();
    const checked = validateEntryMove(formData);
    if (!checked.ok) {
        return { ok: false, message: firstMessage(checked.fieldErrors) };
    }
    let result: EntryMoveResult;
    try {
        result = moveCatalogEntry(checked.input.entryId, checked.input.direction);
    } catch (error) {
        console.error(`Failed to move entry ${checked.input.entryId}:`, error);
        return { ok: false, message: FORM_FAILURE_MESSAGE };
    }
    if (!result.ok) {
        return { ok: false, message: result.problems[0].message };
    }
    if (result.changed) {
        revalidatePath(routes.catalog(), "layout");
    }
    return { ok: true, changed: result.changed, place: result.position };
}
