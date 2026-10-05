"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import {
    STALE_PAGE_MESSAGE,
    describeAliasAdded,
    describeAliasRemoved,
    describeNameSaved,
    editRefusal,
    formRefusal,
    type FormRefusal,
} from "@/lib/catalog/editForms";
import { MERGE_REFUSED_NOW_MESSAGE } from "@/lib/catalog/mergeText";
import type { TuneOption } from "@/lib/catalog/pickers";
import {
    TUNE_ALIAS_FIELDS,
    TUNE_FIELDS,
    validateMerge,
    validateTuneAlias,
    validateTuneEdit,
    type TunePart,
} from "@/lib/catalog/validation";
import {
    FORM_FAILURE_MESSAGE,
    formSuccess,
    readValues,
    type FieldErrors,
    type FormState,
    type FormValues,
} from "@/lib/forms";
import {
    addCatalogTuneAlias,
    editCatalogTune,
    getTuneOptions,
    mergeCatalogTunes,
    previewCatalogTuneMerge,
    removeCatalogTuneAlias,
    type MergeApplyResult,
    type MergePlanResult,
    type MergePreview,
    type TuneAliasResult,
    type TuneEditResult,
} from "@/lib/queries/catalogEdit";
import { routes } from "@/lib/routes";

/**
 * A tune's page's edits: the tune's Save (name, meter and notes), its other
 * names' Add and Remove, and "Merge this tune into…" (the tunes to choose
 * from, the preview, and the merge). They work as the song page's edits do
 * (`app/(app)/catalog/songs/[songId]/editActions.ts`): each form calls its
 * action from `onSubmit` or a click with its pending state in `useState`;
 * each action checks the session and throws without one, reads its form
 * with its reader in `lib/catalog/validation.ts` (every id through
 * `parseCatalogId`), gives refusals back as values, logs failures, and
 * revalidates the pages that show what changed.
 */

/** What the tune's Save gives back. */
export type TuneFormState = FormState<TunePart>;

/** What Add and Remove another name give back. */
export type TuneAliasFormState = FormState<"tune" | "alias">;

/** What reading the tunes to merge into gives back. */
export type TuneOptionsState = { ok: true; options: TuneOption[] } | { ok: false; message: string };

/** What the merge's preview gives back: what the merge would do, or why it cannot be planned. */
export type TuneMergePreviewState = { ok: true; preview: MergePreview } | { ok: false; message: string };

/**
 * What the merge gives back when it does not merge: why, with the plan
 * whose refusals say so when it was refused as it was written.
 */
export type TuneMergeRefusalState = { ok: false; message: string; preview: MergePreview | null };

/**
 * What the merge gives back: what it did, which is the plan it carried out,
 * planned again where it wrote and so not always the preview that was
 * confirmed; or why it did not merge.
 */
export type TuneMergeState = { ok: true; preview: MergePreview } | TuneMergeRefusalState;

/**
 * A server action is a public POST endpoint, so each one checks the session
 * itself rather than relying on the middleware (convention 15), and throws
 * without one.
 */
async function requireSession(): Promise<void> {
    const session = await auth();
    if (!session) {
        throw new Error("Not signed in");
    }
}

type FormErrorState<P extends string> = Extract<FormState<P>, { status: "error" }>;

function errorState<P extends string>(
    message: string,
    values: FormValues,
    fieldErrors: FieldErrors<P> = {}
): FormErrorState<P> {
    return { status: "error", message, fieldErrors, values };
}

/** Log a failure nobody expected, and give the form the generic message: nothing changed. */
function failed<P extends string>(what: string, error: unknown, values: FormValues): FormErrorState<P> {
    console.error(`Failed to ${what}:`, error);
    return errorState(FORM_FAILURE_MESSAGE, values);
}

/** A refused form, with what was posted. */
function refused<P extends string>({ message, fieldErrors }: FormRefusal<P>, values: FormValues): FormErrorState<P> {
    return errorState(message, values, fieldErrors);
}

/**
 * Every page that shows what a change to a tune changes: the catalog's
 * pages (the tune's, its songs', the lists and the books), the plan pages
 * (their catalog songs name the tune, and their suggestions are matched by
 * tune names) and the dashboard (a hymnal note may name the tune).
 */
function revalidateTuneEdits(): void {
    revalidatePath(routes.catalog(), "layout");
    revalidatePath(routes.plans(), "layout");
    revalidatePath(routes.home());
}

/** The tune form's parts that are fields. The tune is hidden. */
const TUNE_FIELD_PARTS: readonly TunePart[] = ["name", "meter", "notes"];

/**
 * The tune's Save: its name, meter and notes (`editCatalogTune`). A name
 * another tune has is an error on the name that links to that tune. On
 * success the values are what was stored (cleaned), and the message says
 * what the rename did to the other names.
 */
export async function editTuneAction(formData: FormData): Promise<TuneFormState> {
    await requireSession();
    const values = readValues(formData, TUNE_FIELDS);
    const checked = validateTuneEdit(formData);
    if (!checked.ok) {
        return refused(formRefusal(checked.fieldErrors, TUNE_FIELD_PARTS), values);
    }
    const { input } = checked;
    let result: TuneEditResult;
    try {
        result = editCatalogTune(input);
    } catch (error) {
        return failed(`save tune ${input.tuneId}`, error, values);
    }
    if (!result.ok) {
        return refused(editRefusal(result.problems, TUNE_FIELD_PARTS), values);
    }
    revalidateTuneEdits();
    return formSuccess(describeNameSaved("tune", result), {
        tuneId: values.tuneId,
        name: input.name,
        meter: input.meter ?? "",
        notes: input.notes ?? "",
    });
}

/** Add another name: give the tune another name, which Planning Center songs' titles are matched by too. */
export async function addTuneAliasAction(formData: FormData): Promise<TuneAliasFormState> {
    await requireSession();
    const values = readValues(formData, TUNE_ALIAS_FIELDS);
    const checked = validateTuneAlias(formData);
    if (!checked.ok) {
        return refused(formRefusal(checked.fieldErrors, ["alias"]), values);
    }
    const { input } = checked;
    let result: TuneAliasResult;
    try {
        result = addCatalogTuneAlias(input);
    } catch (error) {
        return failed(`add another name to tune ${input.tuneId}`, error, values);
    }
    if (!result.ok) {
        return refused(editRefusal(result.problems, ["alias"]), values);
    }
    revalidateTuneEdits();
    return formSuccess(describeAliasAdded("tune", result.alias), { ...values, alias: "" });
}

/** Remove, beside another name: take it off the tune. The name is posted hidden, so any refusal is the form's message. */
export async function removeTuneAliasAction(formData: FormData): Promise<TuneAliasFormState> {
    await requireSession();
    const values = readValues(formData, TUNE_ALIAS_FIELDS);
    const checked = validateTuneAlias(formData);
    if (!checked.ok) {
        return refused(formRefusal(checked.fieldErrors, []), values);
    }
    const { input } = checked;
    let result: TuneAliasResult;
    try {
        result = removeCatalogTuneAlias(input);
    } catch (error) {
        return failed(`remove another name of tune ${input.tuneId}`, error, values);
    }
    if (!result.ok) {
        return refused(editRefusal(result.problems, []), values);
    }
    revalidateTuneEdits();
    return formSuccess(describeAliasRemoved("tune", result.alias), values);
}

const TUNE_OPTIONS_FAILURE_MESSAGE =
    "The tunes could not be read. Try again; the server log has the details.";

/**
 * The tunes "Merge this tune into…" chooses from (`getTuneOptions`): every
 * tune, by name, with its other names and meter. The picker asks for them
 * when it opens. It writes and revalidates nothing.
 */
export async function listTuneOptionsAction(): Promise<TuneOptionsState> {
    await requireSession();
    try {
        return { ok: true, options: getTuneOptions() };
    } catch (error) {
        console.error("Failed to read the tunes to merge into:", error);
        return { ok: false, message: TUNE_OPTIONS_FAILURE_MESSAGE };
    }
}

/** The first message of a merge form's errors: the target to choose, or a hidden id that is not one. */
function mergeFormMessage(errors: Partial<Record<string, { message: string }>>): string {
    return errors.source?.message ?? errors.target?.message ?? STALE_PAGE_MESSAGE;
}

/**
 * The preview: what merging the posted tune (`sourceId`) into the one
 * chosen (`targetId`) would do (`previewCatalogTuneMerge`): the songs that
 * move, those that merge into the target's song of the same hymn, what else
 * changes, and why it would be refused. Nothing is written.
 */
export async function previewTuneMergeAction(formData: FormData): Promise<TuneMergePreviewState> {
    await requireSession();
    const checked = validateMerge(formData, "tune");
    if (!checked.ok) {
        return { ok: false, message: mergeFormMessage(checked.fieldErrors) };
    }
    const { sourceId, targetId } = checked.input;
    let result: MergePlanResult;
    try {
        result = previewCatalogTuneMerge(sourceId, targetId);
    } catch (error) {
        console.error(`Failed to preview merging tune ${sourceId} into ${targetId}:`, error);
        return { ok: false, message: FORM_FAILURE_MESSAGE };
    }
    return result.ok ? { ok: true, preview: result.preview } : { ok: false, message: result.message };
}

/**
 * Merge, once the dialog has confirmed it: merge the posted tune into the
 * one chosen (`mergeCatalogTunes`, planned afresh and written in one
 * transaction). Then every page that shows the catalog is revalidated, and
 * what the merge did comes back: its notice says that, not what the preview
 * showed. The panel then replaces the page, whose tune is gone, with the
 * target tune's (`tuneMergeLanding`). A merge refused as it is written
 * comes back with its plan.
 */
export async function mergeTunesAction(formData: FormData): Promise<TuneMergeState> {
    await requireSession();
    const checked = validateMerge(formData, "tune");
    if (!checked.ok) {
        return { ok: false, message: mergeFormMessage(checked.fieldErrors), preview: null };
    }
    const { sourceId, targetId } = checked.input;
    let result: MergeApplyResult;
    try {
        result = mergeCatalogTunes(sourceId, targetId);
    } catch (error) {
        console.error(`Failed to merge tune ${sourceId} into ${targetId}:`, error);
        return { ok: false, message: FORM_FAILURE_MESSAGE, preview: null };
    }
    if (!result.ok) {
        return result.reason === "refused"
            ? { ok: false, message: MERGE_REFUSED_NOW_MESSAGE, preview: result.preview }
            : { ok: false, message: result.message, preview: null };
    }
    revalidateTuneEdits();
    return { ok: true, preview: result.preview };
}
