"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { parseCatalogId } from "@/lib/catalog/ids";
import {
    applyCatalogImport,
    discardCatalogImport,
    previewSeedImport,
    type ApplyCatalogImportResult,
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
 * The Apply form's action: add the previewed run's rows to the catalog, then
 * revalidate every catalog page (they read what it just added) and go to the
 * songs list. A refusal (the run is not a preview, or the catalog already
 * has books) is returned for the form to show, and the import pages are
 * revalidated.
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
    redirect(routes.catalog());
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
