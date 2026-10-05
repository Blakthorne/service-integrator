"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import {
    ROLES_IMPACT_UNCHECKED_MESSAGE,
    checkRolesImpactConfirmed,
    creditRolesImpact,
} from "@/lib/creditRoleImpact";
import {
    FORM_FAILURE_MESSAGE,
    formError,
    formSuccess,
    type FieldErrors,
    type FormState,
    type FormValues,
} from "@/lib/forms";
import { EXPORT_FAILED_MESSAGE } from "@/lib/catalog/exportText";
import { parsePcoId } from "@/lib/pco";
import { getCreditLabelSets, rederiveAllCredits } from "@/lib/queries/credits";
import { exportCatalogJson } from "@/lib/queries/export";
import { syncPcoSongsNow, type RunJobResult } from "@/lib/queries/reconcile";
import { getSettings, saveSettings, type SaveSettingsResult } from "@/lib/queries/settings";
import { routes } from "@/lib/routes";
import {
    CREDIT_ROLES_CONFIRM_FIELD,
    creditRolesOf,
    readCopyrightForm,
    readCreditRolesConfirmation,
    readCreditsForm,
    readEmailForm,
    readHymnalNotesForm,
    readScheduleTextForm,
    type SettingsFormRead,
} from "@/lib/settingsForms";
import { CREDITS_NOT_REREAD_MESSAGE, describeRederivedCredits } from "@/lib/settingsText";

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

/** What exporting the catalog tells its button: the JSON to download, or why there is none. */
export type ExportCatalogResult = { ok: true; json: string } | { ok: false; message: string };

/**
 * Settings' "Export catalog (JSON)": read the whole catalog as its
 * deterministic JSON document (`exportCatalogJson`) and hand it to the button,
 * which saves it as a file in the browser (a Blob named with
 * `catalogExportFileName`): there is no download route, since nothing the
 * server renders may fetch `/api/*` and the document is made on demand. It
 * only reads, so it revalidates nothing. It checks the session first and
 * throws without one; a failure is logged and comes back as a message.
 *
 * The button calls it from its click with its pending state in `useState`
 * (convention 15), as Sync now does: the export reads every row of the
 * catalog, and a transition held open across it would stall navigation.
 */
export async function exportCatalogAction(): Promise<ExportCatalogResult> {
    const session = await auth();
    if (!session) {
        throw new Error("Not signed in");
    }
    try {
        return { ok: true, json: exportCatalogJson() };
    } catch (error) {
        console.error("Failed to export the catalog:", error);
        return { ok: false, message: EXPORT_FAILED_MESSAGE };
    }
}

/**
 * Where a Settings form stands, as its action returns it: the fields are
 * named as `lib/settingsForms.ts` names them, and "success" carries what
 * each field holds once it is saved.
 *
 * Unlike the catalog's forms, these are not `useActionState` form actions:
 * each form's `onSubmit` calls its action and keeps the state and the
 * pending flag in `useState` (see `useSettingsForm`). The actions write only
 * to the local database and take milliseconds, but a save revalidates the
 * pages, and any `revalidatePath` makes the response re-render the page that
 * called, which here reads Planning Center for the service types and their
 * categories. A form action's transition is not over until that render is,
 * so "Saving..." stayed up for as long as Planning Center took (8.4 s with a
 * Planning Center that takes 4 s per read; twice its 15 s timeout when it
 * hangs), and "Saved." with it. Called from a handler, the action's promise
 * resolves when the action returns, "Saved." appears at once, and the page's
 * Planning Center cards update in the background when their reads are back
 * (convention 15: an action whose page waits on Planning Center is called
 * from an event handler).
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
 * The pages that show what the credit roles and phrases change: Settings, the
 * plan pages (the copyright text prints the credits) and the catalog's, whose
 * song pages show each song's credits as the roles read them. Not the
 * dashboard, which shows no credits.
 */
function revalidateCreditPages(): void {
    revalidatePath(routes.settings());
    revalidatePath(routes.plans(), "layout");
    revalidatePath(routes.catalog(), "layout");
}

/**
 * The pages that show the email settings: Settings alone. The plan's Email
 * dialog reads them afresh each time it opens.
 */
function revalidateEmailPages(): void {
    revalidatePath(routes.settings());
}

/** What follows a save that went through: more to say beside "Saved.", or a problem the save itself did not have. */
type AfterSave = { ok: true; message: string } | { ok: false; message: string };

/** What `saveRead` does besides saving. */
interface SaveOptions {
    /** Revalidate the pages that show what was saved; the settings pages by default. */
    revalidate?: () => void;
    /**
     * Runs once the values are stored. Its message replaces "Saved." when it
     * went well. When it did not, the form shows its message as an error,
     * though the values are stored.
     */
    after?: () => AfterSave;
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
 * the generic message. A save runs `options.after`, revalidates the pages
 * that show it (`options.revalidate`: the settings pages by default), and
 * gives the form what each field holds now.
 */
function saveRead(read: SettingsFormRead, options: SaveOptions = {}): SettingsFormState {
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
    const followUp = options.after?.();
    // The values are stored whether or not the follow-up worked.
    (options.revalidate ?? revalidateSettingsPages)();
    if (followUp?.ok === false) {
        return formError(followUp.message, { values: read.posted });
    }
    return formSuccess(followUp?.message ?? SAVED_MESSAGE, read.shown);
}

/** The Copyright card's action: save the CCLI license number. */
export async function saveCopyrightAction(formData: FormData): Promise<SettingsFormState> {
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
export async function saveScheduleTextAction(formData: FormData): Promise<SettingsFormState> {
    await requireSession();
    const { settings, error } = getSettings();
    if (error !== null) {
        return formError(FORM_FAILURE_MESSAGE);
    }
    return saveRead(readScheduleTextForm(formData, settings.scheduleHeaderLabels, parsePcoId));
}

/** The Hymnal notes card's action: save the item note category's name and whether a note names the tune. */
export async function saveHymnalNotesAction(formData: FormData): Promise<SettingsFormState> {
    await requireSession();
    return saveRead(readHymnalNotesForm(formData));
}

/**
 * Read every song's author again with the roles just saved, and say how
 * many songs that was and how they read (`rederiveAllCredits`: the database
 * alone, one transaction). A failure is logged and says when the credits
 * will follow anyway: the next song sync derives them with the stored roles.
 */
function rederiveCredits(): AfterSave {
    try {
        return { ok: true, message: describeRederivedCredits(rederiveAllCredits()) };
    } catch (error) {
        console.error("Failed to read the songs' credits again:", error);
        return { ok: false, message: CREDITS_NOT_REREAD_MESSAGE };
    }
}

/**
 * Whether `roles` may be saved, for what they do to songs: the labels the
 * mirrored songs' authors use are read again (`getCreditLabelSets`), and
 * roles that would leave some of them labelled with a role that no longer
 * exists, changing their copyright text, are saved only when the form's
 * checkbox confirms exactly how many songs that is
 * (lib/creditRoleImpact.ts). Null when they may be saved. A refusal is
 * marked on the checkbox, and Settings is revalidated so the form's notice
 * shows the songs as they are now: the page's may be stale (a sync, or
 * roles saved in another tab), or show no songs at all. When the labels
 * cannot be read nothing is saved, since the change cannot be checked.
 */
function refuseUnconfirmedImpact(
    roles: readonly string[],
    formData: FormData,
    posted: FormValues
): SettingsFormState | null {
    const { sets, error } = getCreditLabelSets();
    if (error !== null) {
        return formError(ROLES_IMPACT_UNCHECKED_MESSAGE, { values: posted });
    }
    const check = checkRolesImpactConfirmed(
        creditRolesImpact(sets, roles),
        readCreditRolesConfirmation(formData)
    );
    if (check.ok) {
        return null;
    }
    revalidatePath(routes.settings());
    return formError(FIX_FIELDS_MESSAGE, {
        fieldErrors: { [CREDIT_ROLES_CONFIRM_FIELD]: { message: check.message } },
        values: posted,
    });
}

/**
 * The Credits card's action: save the credit roles, in order, and the
 * phrase for each, then read every song's author again with the new roles
 * (`rederiveAllCredits`) so the credits follow at once and not at the next
 * song sync, and say how many songs that was. A refused form saves nothing
 * and reads nothing again.
 *
 * Roles that rename or remove a role that songs' authors use as a label
 * change those songs' copyright text (their authors stop reading as
 * labelled), so they are saved only once the form confirms how many songs
 * that is, checked against the mirror here (`refuseUnconfirmedImpact`).
 */
export async function saveCreditsAction(formData: FormData): Promise<SettingsFormState> {
    await requireSession();
    const read = readCreditsForm(formData);
    // Null when the form was refused, which `saveRead` then says.
    const roles = creditRolesOf(read);
    if (roles !== null) {
        const refused = refuseUnconfirmedImpact(roles, formData, read.posted);
        if (refused !== null) {
            return refused;
        }
    }
    return saveRead(read, {
        revalidate: revalidateCreditPages,
        after: rederiveCredits,
    });
}

/**
 * The Email card's action: save the recipients, one address each, and the
 * subject's template. It reads nothing from Planning Center and sends
 * nothing: the plan's Email dialog does, with what is saved here.
 */
export async function saveEmailAction(formData: FormData): Promise<SettingsFormState> {
    await requireSession();
    return saveRead(readEmailForm(formData), { revalidate: revalidateEmailPages });
}
