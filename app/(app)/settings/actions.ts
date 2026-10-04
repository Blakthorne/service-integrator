"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import {
    FORM_FAILURE_MESSAGE,
    formError,
    formSuccess,
    type FieldErrors,
    type FormState,
} from "@/lib/forms";
import { parsePcoId } from "@/lib/pco";
import { syncPcoSongsNow, type RunJobResult } from "@/lib/queries/reconcile";
import { getSettings, saveSettings, type SaveSettingsResult } from "@/lib/queries/settings";
import { routes } from "@/lib/routes";
import {
    readCopyrightForm,
    readHymnalNotesForm,
    readScheduleTextForm,
    type SettingsFormRead,
} from "@/lib/settingsForms";

/** What "Sync now" says when it is done: how the run went, in a sentence. */
export interface SyncNowResult {
    ok: boolean;
    message: string;
}

/**
 * "Sync now", on Settings and Reconcile: run the Planning Center song sync
 * (`syncPcoSongsNow`, which joins a run already in progress rather than
 * start another) and say how that run went. Then every page that shows the
 * sync or what it changes is revalidated: Settings, the catalog's pages (the
 * mirror and the auto-links it made) and the plans' (their numbers come
 * from the links), whether it succeeded or not, since its run is recorded
 * either way. When no run could be recorded at all (the database could not
 * be opened or written), nothing changed: it says so, and revalidates
 * nothing.
 *
 * A sync can take a while (it is paced), so the button calls this directly
 * and keeps its pending state in `useState`, not in a transition held open
 * across the action, which would stall every navigation until it returned
 * (convention 15). It checks the session first and throws without one.
 */
export async function syncPcoSongsAction(): Promise<SyncNowResult> {
    const session = await auth();
    if (!session) {
        throw new Error("Not signed in");
    }
    let result: RunJobResult;
    try {
        result = await syncPcoSongsNow();
    } catch (error) {
        console.error("Failed to sync the Planning Center songs:", error);
        return { ok: false, message: FORM_FAILURE_MESSAGE };
    }
    if (result.run === null) {
        // runJob logged why: the run could not even be recorded.
        return { ok: false, message: FORM_FAILURE_MESSAGE };
    }
    revalidatePath(routes.settings());
    revalidatePath(routes.catalog(), "layout");
    revalidatePath(routes.plans(), "layout");
    const { run } = result;
    return run.ok
        ? { ok: true, message: run.message ?? "Synced." }
        : { ok: false, message: `The sync failed: ${run.message ?? "no reason was recorded"}.` };
}

/**
 * Where a Settings form stands, as its action returns it to
 * `useActionState`: the fields are named as `lib/settingsForms.ts` names
 * them, and "success" carries what each field holds once it is saved.
 */
export type SettingsFormState = FormState;

/**
 * What a form says above its Save button when a field needs fixing. It does
 * not say where the fields are, or what colour they are marked in: the
 * message sits below them, and a person who cannot see colour must find them.
 */
const FIX_FIELDS_MESSAGE =
    "Nothing was saved. Fix the fields that have an error message, then try again.";

/** What a form says when it refuses with reasons that are not about any one field. */
const NOTHING_SAVED_MESSAGE = "Nothing was saved.";

/** What a form says when it is saved. */
const SAVED_MESSAGE = "Saved.";

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

/**
 * Every page that shows what a setting changes: Settings itself, the plan
 * pages (the copyright and schedule text, and the hymnal notes' preview and
 * sync) and the dashboard, which shows the plans' numbers and note status.
 */
function revalidateSettingsPages(): void {
    revalidatePath(routes.settings());
    revalidatePath(routes.plans(), "layout");
    revalidatePath(routes.home());
}

/**
 * A refusal from `saveSettings`, as the form shows it. The readers check
 * every value with the registry's own parsers first, so this is only a
 * guard: a setting whose key is a field of the form is marked on that field,
 * and any other reason is added to the message, so none is lost.
 */
function refusal(
    result: Extract<SaveSettingsResult, { ok: false }>,
    posted: Record<string, string>
): SettingsFormState {
    const fieldErrors: FieldErrors = {};
    const elsewhere: string[] = [];
    for (const [key, message] of Object.entries(result.fieldErrors)) {
        if (Object.hasOwn(posted, key)) {
            fieldErrors[key] = { message };
        } else {
            elsewhere.push(message);
        }
    }
    const message = Object.keys(fieldErrors).length > 0 ? FIX_FIELDS_MESSAGE : NOTHING_SAVED_MESSAGE;
    return formError([message, ...elsewhere].join(" "), { fieldErrors, values: posted });
}

/**
 * Save what a form read, and say how it went. A field that needs fixing
 * comes back as an error on that field, with nothing saved. A save the
 * database cannot make (`saveSettings` throws) is logged and comes back as
 * the generic message. A save revalidates the pages that show settings, and
 * gives the form what each field holds now.
 */
function saveRead(read: SettingsFormRead): SettingsFormState {
    if (!read.ok) {
        return formError(FIX_FIELDS_MESSAGE, {
            fieldErrors: read.fieldErrors,
            values: read.posted,
        });
    }
    let result: SaveSettingsResult;
    try {
        result = saveSettings(read.values);
    } catch (error) {
        console.error("Failed to save the settings:", error);
        return formError(FORM_FAILURE_MESSAGE, { values: read.posted });
    }
    if (!result.ok) {
        return refusal(result, read.posted);
    }
    revalidateSettingsPages();
    return formSuccess(SAVED_MESSAGE, read.shown);
}

/**
 * The Copyright card's action: save the CCLI license number. Like the other
 * Settings forms it writes only to the local database, so it takes
 * milliseconds and may be a form action (convention 15).
 */
export async function saveCopyrightAction(
    _state: SettingsFormState,
    formData: FormData
): Promise<SettingsFormState> {
    await requireSession();
    return saveRead(readCopyrightForm(formData));
}

/**
 * The Schedule text card's action: save the header label of each service
 * type the form listed and the number separator, as typed. A blank label is
 * dropped, so its service type gets its default, and the labels of service
 * types the form did not list are kept (`readScheduleTextForm`), which
 * needs the saved ones: when they cannot be read, nothing is saved rather
 * than lose them (`getSettings` has logged why).
 */
export async function saveScheduleTextAction(
    _state: SettingsFormState,
    formData: FormData
): Promise<SettingsFormState> {
    await requireSession();
    const { settings, error } = getSettings();
    if (error !== null) {
        return formError(FORM_FAILURE_MESSAGE);
    }
    return saveRead(readScheduleTextForm(formData, settings.scheduleHeaderLabels, parsePcoId));
}

/** The Hymnal notes card's action: save the item note category's name and whether a note names the tune. */
export async function saveHymnalNotesAction(
    _state: SettingsFormState,
    formData: FormData
): Promise<SettingsFormState> {
    await requireSession();
    return saveRead(readHymnalNotesForm(formData));
}
