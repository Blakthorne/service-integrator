"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { csvTextProblem } from "@/lib/catalog/csvUpload";
import { parseBookCode, parseCatalogId } from "@/lib/catalog/ids";
import { CSV_FIX_FIELDS_MESSAGE } from "@/lib/catalog/importText";
import { validateBookCsvUpload, type BookCsvPart } from "@/lib/catalog/validation";
import { FORM_FAILURE_MESSAGE, formError, type FormState } from "@/lib/forms";
import {
    applyCatalogImport,
    discardCatalogImport,
    previewBookCsvImport,
    previewSeedImport,
    type ApplyCatalogImportResult,
    type BookCsvPreviewResult,
    type DiscardCatalogImportResult,
} from "@/lib/queries/catalogImport";
import { routes } from "@/lib/routes";

/**
 * What an import action tells its form through `useActionState`: the message
 * to show (a refusal, or a failure), or null before it has run. An action
 * that succeeds redirects instead of returning.
 */
export type ImportActionState = { error: string } | null;

/** Shown for a failure the actions cannot explain; the log has the details. */
const FAILURE_MESSAGE =
    "Something went wrong, so nothing was changed. Try again; the server log has the details.";

/** Shown when the form's run id is not a catalog id: a stale or tampered form. */
const NO_SUCH_RUN_MESSAGE = "There is no such import run.";

/**
 * A server action is a public POST endpoint, so each one checks the session
 * itself instead of relying on the middleware alone (convention 15), and
 * throws without one.
 */
async function requireSession(): Promise<void> {
    const session = await auth();
    if (!session) {
        throw new Error("Not signed in");
    }
}

/** Log a failure nobody expected and give the form the generic message. */
function failed(what: string, error: unknown): ImportActionState {
    console.error(`Failed to ${what}:`, error);
    return { error: FAILURE_MESSAGE };
}

/**
 * A refusal means the run or the catalog is not as the page showed it: the
 * run was applied or discarded in another tab, or books arrived. Give the
 * form the refusal, and revalidate the import pages, so that once the form
 * is closed the page behind it shows the state as it is now, not a preview
 * with live Apply and Discard buttons.
 */
function refused(message: string): ImportActionState {
    revalidatePath(routes.catalogImport(), "layout");
    return { error: message };
}

// Each action below runs its query inside a try block and calls `redirect()`
// outside it: redirect works by throwing, so a try block would swallow it.

/**
 * The seed preview form's action: plan the seed from hymns.json, store it as
 * a preview run and go to the run's review page.
 */
export async function previewSeedImportAction(): Promise<ImportActionState> {
    await requireSession();
    let runId: number;
    try {
        runId = previewSeedImport();
    } catch (error) {
        return failed("preview the seed import", error);
    }
    revalidatePath(routes.catalogImport(), "layout");
    redirect(routes.catalogImportRun(runId));
}

/**
 * What the Import a book from CSV form is told: a refusal to show (a field to
 * fix, a failure), or the run to go to. Unlike the other import forms this one
 * is not a `useActionState` form action: it calls the action from `onSubmit`
 * with its pending state in `useState`, as Settings' forms do, and goes to the
 * run's page itself (convention 15), so success comes back as a value and not
 * as a `redirect()`.
 */
export type PreviewBookCsvState = FormState<BookCsvPart> | { status: "previewed"; runId: number };

/** Log a failure nobody expected and give the CSV form the generic message. */
function csvFailed(what: string, error: unknown): PreviewBookCsvState {
    console.error(`Failed to ${what}:`, error);
    return formError(FORM_FAILURE_MESSAGE);
}

/**
 * The Import a book from CSV form's action: read its fields
 * (`validateBookCsvUpload`: the book's id, and a file that is not empty and at
 * most 1 MB), read the file's text, which must be UTF-8 (`csvTextProblem`), and
 * plan it against the book as a preview run (`previewBookCsvImport`). The
 * file's own problems (a header that does not fit, a number taken, ...) are in
 * the run's report and block applying it, so they are not refusals here: a
 * refusal is only a field that needs fixing, or a book that is not in the
 * catalog. On success it revalidates the import pages and returns the run's id
 * for the form to go to.
 */
export async function previewBookCsvAction(formData: FormData): Promise<PreviewBookCsvState> {
    await requireSession();
    const checked = validateBookCsvUpload(formData);
    if (!checked.ok) {
        return formError(CSV_FIX_FIELDS_MESSAGE, { fieldErrors: checked.fieldErrors });
    }
    const { bookId, file, sourceName } = checked.input;
    let text: string;
    try {
        text = await file.text();
    } catch (error) {
        return csvFailed(`read the uploaded CSV file ${sourceName}`, error);
    }
    const textProblem = csvTextProblem(text);
    if (textProblem !== null) {
        return formError(CSV_FIX_FIELDS_MESSAGE, { fieldErrors: { file: { message: textProblem } } });
    }
    let result: BookCsvPreviewResult;
    try {
        result = previewBookCsvImport({ bookId, sourceName, text });
    } catch (error) {
        return csvFailed(`preview the CSV file ${sourceName} for book ${bookId}`, error);
    }
    if (!result.ok) {
        const part: BookCsvPart = result.reason === "book-not-found" ? "book" : "file";
        return formError(CSV_FIX_FIELDS_MESSAGE, { fieldErrors: { [part]: { message: result.message } } });
    }
    revalidatePath(routes.catalogImport(), "layout");
    return { status: "previewed", runId: result.runId };
}

/**
 * The Apply form's action: add the previewed run's rows to the catalog, then
 * revalidate what shows them and go to the book a book's file was imported
 * into (the songs list after the seed, which adds the books). What shows them
 * is every catalog page; the plan pages and the dashboard too, since a book's
 * file adds entries to songs that are linked to Planning Center, and those
 * entries are numbers in the schedule text and the hymnal notes. A refusal
 * (the run is not a preview, the catalog already has books, or a book's file
 * has problems or no longer fits the catalog) is returned for the form to
 * show, and the import pages are revalidated.
 */
export async function applyImportAction(
    _state: ImportActionState,
    formData: FormData
): Promise<ImportActionState> {
    await requireSession();
    const runId = parseCatalogId(formData.get("runId"));
    if (runId === null) {
        return { error: NO_SUCH_RUN_MESSAGE };
    }
    let result: ApplyCatalogImportResult;
    try {
        result = applyCatalogImport(runId);
    } catch (error) {
        return failed(`apply import run ${runId}`, error);
    }
    if (!result.ok) {
        return refused(result.message);
    }
    revalidatePath(routes.catalog(), "layout");
    revalidatePath(routes.plans(), "layout");
    revalidatePath(routes.home());
    // The code is the book's own, from its stored report; it is parsed all the same (convention 19).
    const bookCode = result.bookCode === null ? null : parseBookCode(result.bookCode);
    redirect(bookCode === null ? routes.catalog() : routes.catalogBook(bookCode));
}

/**
 * The Discard form's action: mark the previewed run discarded, then go back
 * to the list of runs. A refusal (no such run, or it is not a preview) is
 * returned for the form to show, and the import pages are revalidated.
 */
export async function discardImportAction(
    _state: ImportActionState,
    formData: FormData
): Promise<ImportActionState> {
    await requireSession();
    const runId = parseCatalogId(formData.get("runId"));
    if (runId === null) {
        return { error: NO_SUCH_RUN_MESSAGE };
    }
    let result: DiscardCatalogImportResult;
    try {
        result = discardCatalogImport(runId);
    } catch (error) {
        return failed(`discard import run ${runId}`, error);
    }
    if (!result.ok) {
        return refused(result.message);
    }
    revalidatePath(routes.catalogImport(), "layout");
    redirect(routes.catalogImport());
}
