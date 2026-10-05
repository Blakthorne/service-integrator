"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import {
    STALE_PAGE_MESSAGE,
    describeAliasAdded,
    describeAliasRemoved,
    describeMarked,
    describeNameSaved,
    describeUnmarked,
    editRefusal,
    formRefusal,
    type FormRefusal,
} from "@/lib/catalog/editForms";
import { twinEntry, twinEntryLink } from "@/lib/catalog/entryEditor";
import { parseCatalogId } from "@/lib/catalog/ids";
import { MERGE_REFUSED_NOW_MESSAGE } from "@/lib/catalog/mergeText";
import type { HymnOption } from "@/lib/catalog/pickers";
import {
    ENTRY_FIELDS,
    HYMN_ALIAS_FIELDS,
    HYMN_FIELDS,
    SONG_MARK_FIELDS,
    validateEntryDelete,
    validateEntryEdit,
    validateEntryMove,
    validateHymnAlias,
    validateHymnEdit,
    validateMerge,
    validateNewEntry,
    validateSongMark,
    type EntryPart,
    type HymnPart,
    type SongMarkPart,
} from "@/lib/catalog/validation";
import type { LabelledEntry } from "@/lib/domain";
import {
    FORM_FAILURE_MESSAGE,
    formSuccess,
    readId,
    readValues,
    type FieldErrors,
    type FormLink,
    type FormState,
    type FormValues,
} from "@/lib/forms";
import { getCatalogSong } from "@/lib/queries/catalog";
import {
    addCatalogEntry,
    addCatalogHymnAlias,
    deleteCatalogEntry,
    editCatalogEntry,
    editCatalogHymn,
    getHymnOptions,
    mergeCatalogHymns,
    moveCatalogEntry,
    previewCatalogHymnMerge,
    removeCatalogHymnAlias,
    type EntryDeleteResult,
    type EntryEditResult,
    type EntryMoveResult,
    type HymnAliasResult,
    type HymnEditResult,
    type MergeApplyResult,
    type MergePlanResult,
    type MergePreview,
} from "@/lib/queries/catalogEdit";
import { markCatalogSong, unmarkCatalogSong, type MarkResult } from "@/lib/queries/marks";
import { routes } from "@/lib/routes";

/**
 * The song page's edits of the catalog: its mark (Mark to learn, with a
 * note, and Unmark), its entries in books (Add, Edit, Delete, and Move up
 * and Move down in a book without numbers), its hymn (Save, and Add and
 * Remove other titles) and "Merge this hymn into…" (the hymns to choose
 * from, the preview, and the merge).
 *
 * The page's other cards read Planning Center, so each form calls its
 * action from `onSubmit` (or a click) with its pending state in `useState`,
 * never as a form action (convention 15 as phase 5 refined it). Each action
 * is a public POST endpoint: it checks the session first and throws without
 * one, reads its `FormData` with its reader in `lib/catalog/validation.ts`
 * (every id through `parseCatalogId`), and calls only `lib/queries`. What
 * the reader or the catalog refuses comes back as a value, with the fields
 * to mark and links to what a change clashes with; anything unexpected is
 * logged and comes back as `FORM_FAILURE_MESSAGE`, nothing having changed
 * (each write is one transaction). After a change, each revalidates the
 * pages that show it.
 */

/**
 * What an edit form's action gives back: a `FormState`, whose success also
 * carries what the change reports (`T`), for the form to word and to hand
 * focus on.
 */
export type EditFormState<P extends string, T extends object = object> =
    | Exclude<FormState<P>, { status: "success" }>
    | (Extract<FormState<P>, { status: "success" }> & T);

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

/** A form's "error" state: refused or failed, with what was posted. */
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
 * Every page that shows what a change to the catalog's songs, hymns or
 * entries changes: the catalog's pages (the songs list, every song, tune
 * and book page), the plan pages (their numbers, titles and suggestions
 * come from the catalog, and their Schedule tab prints the numbers) and
 * the dashboard (its songs' numbers and hymnal notes).
 */
function revalidateCatalogEdits(): void {
    revalidatePath(routes.catalog(), "layout");
    revalidatePath(routes.plans(), "layout");
    revalidatePath(routes.home());
}

/** The pages that show a song's marks: the catalog's (the song's page, and the songs list's mark filter). */
function revalidateMarks(): void {
    revalidatePath(routes.catalog(), "layout");
}

// ---------------------------------------------------------------------------
// Marks
// ---------------------------------------------------------------------------

/** What Mark to learn, Save note and Unmark give back. */
export type SongMarkFormState = FormState<SongMarkPart>;

/** The mark forms' parts that are fields: the note. The song and the mark are hidden. */
const MARK_FIELD_PARTS: readonly SongMarkPart[] = ["note"];

/**
 * Mark to learn (and Save note): put the posted mark on the song with the
 * note, or none when it is blank (`markCatalogSong`). A song already marked
 * keeps when it was marked and takes the new note.
 */
export async function markSongAction(formData: FormData): Promise<SongMarkFormState> {
    await requireSession();
    const values = readValues(formData, SONG_MARK_FIELDS);
    const checked = validateSongMark(formData);
    if (!checked.ok) {
        return refused(formRefusal(checked.fieldErrors, MARK_FIELD_PARTS), values);
    }
    const { songId, mark, note } = checked.input;
    let result: MarkResult;
    try {
        result = markCatalogSong(songId, mark, note);
    } catch (error) {
        return failed(`mark catalog song ${songId}`, error, values);
    }
    if (!result.ok) {
        return errorState(result.message, values);
    }
    revalidateMarks();
    return formSuccess(describeMarked(mark, result.changed, note), { ...values, note: note ?? "" });
}

/** Unmark: take the posted mark off the song (`unmarkCatalogSong`); its note goes with it. */
export async function unmarkSongAction(formData: FormData): Promise<SongMarkFormState> {
    await requireSession();
    const values = readValues(formData, SONG_MARK_FIELDS);
    const checked = validateSongMark(formData);
    if (!checked.ok) {
        return refused(formRefusal(checked.fieldErrors, MARK_FIELD_PARTS), values);
    }
    const { songId, mark } = checked.input;
    let result: MarkResult;
    try {
        result = unmarkCatalogSong(songId, mark);
    } catch (error) {
        return failed(`unmark catalog song ${songId}`, error, values);
    }
    if (!result.ok) {
        return errorState(result.message, values);
    }
    revalidateMarks();
    return formSuccess(describeUnmarked(mark, result.changed), { ...values, note: "" });
}

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

/** What Add and an entry's Save give back: on success, the entry's id and its label ("R-396"). */
export type EntryFormState = EditFormState<EntryPart, { entryId: number; label: string }>;

/** What Delete gives back: on success, the label the entry had. */
export type EntryDeleteState = EditFormState<"entry", { label: string }>;

/** What Move up and Move down give back: on success, the entry's position now, and whether it moved. */
export type EntryMoveState = EditFormState<"entry" | "direction", { changed: boolean; position: number }>;

/** The entry forms' parts that are fields. The song and the entry are hidden. */
const ENTRY_FIELD_PARTS: readonly EntryPart[] = ["book", "placement", "variantNote"];

/**
 * The link for a variant note that clashes with another entry of the song
 * in the book (`song-already-in-book`, which the catalog gives no row):
 * that entry, by its label, linking to its book's page. Found in song
 * `songId`'s entries, in the book `bookIdOf` picks from them; null when it
 * cannot be found, or reading the song fails (logged): the message alone
 * still says where the entry is.
 */
function twinLink(
    songId: number | null,
    bookIdOf: (entries: readonly LabelledEntry[]) => number | undefined,
    variantNote: string | null,
    exceptEntryId: number | null
): FormLink | null {
    if (songId === null) {
        return null;
    }
    try {
        const song = getCatalogSong(songId);
        const bookId = song ? bookIdOf(song.entries) : undefined;
        const twin =
            song && bookId !== undefined ? twinEntry(song.entries, bookId, variantNote, exceptEntryId) : undefined;
        return twin ? twinEntryLink(twin) : null;
    } catch (error) {
        console.error(`Failed to read catalog song ${songId} for a refusal's link:`, error);
        return null;
    }
}

/**
 * An entry form's refusal from the catalog (`editRefusal`): a number taken
 * links to the song that has it, and a variant note that clashes to the
 * song's entry it clashes with (`twinLink`).
 */
function entryRefusal(
    result: Extract<EntryEditResult, { ok: false }>,
    findTwin: () => FormLink | null
): FormRefusal<EntryPart> {
    const refusal = editRefusal(result.problems, ENTRY_FIELD_PARTS);
    const clash = refusal.fieldErrors.variantNote;
    if (clash && !clash.link && result.problems.some(({ reason }) => reason === "song-already-in-book")) {
        const link = findTwin();
        if (link !== null) {
            refusal.fieldErrors.variantNote = { ...clash, link };
        }
    }
    return refusal;
}

/**
 * Add: put the song in a book (`addCatalogEntry`), at a number or location
 * in a numbered book, or at the end of a book without numbers, with an
 * optional variant note. A number another song has, or a second entry of
 * the song in the book with the same variant note (or none), is an error on
 * its field that links to what has it.
 */
export async function addEntryAction(formData: FormData): Promise<EntryFormState> {
    await requireSession();
    const values = readValues(formData, ENTRY_FIELDS);
    const checked = validateNewEntry(formData);
    if (!checked.ok) {
        return refused(formRefusal(checked.fieldErrors, ENTRY_FIELD_PARTS), values);
    }
    const { input } = checked;
    let result: EntryEditResult;
    try {
        result = addCatalogEntry(input);
    } catch (error) {
        return failed(`add an entry of catalog song ${input.songId}`, error, values);
    }
    if (!result.ok) {
        return refused(
            entryRefusal(result, () => twinLink(input.songId, () => input.bookId, input.variantNote, null)),
            values
        );
    }
    revalidateCatalogEdits();
    return {
        status: "success",
        message: `Added ${result.label}.`,
        values,
        entryId: result.entryId,
        label: result.label,
    };
}

/**
 * An entry's Save: change its number or location, or its position in a
 * book without numbers, and its variant note (`editCatalogEntry`), refused
 * as Add is. The form posts its song's id too, which only the link of a
 * clashing variant note uses.
 */
export async function editEntryAction(formData: FormData): Promise<EntryFormState> {
    await requireSession();
    const values = readValues(formData, ENTRY_FIELDS);
    const checked = validateEntryEdit(formData);
    if (!checked.ok) {
        return refused(formRefusal(checked.fieldErrors, ENTRY_FIELD_PARTS), values);
    }
    const { input } = checked;
    let result: EntryEditResult;
    try {
        result = editCatalogEntry(input);
    } catch (error) {
        return failed(`save catalog entry ${input.entryId}`, error, values);
    }
    if (!result.ok) {
        const songId = readId(formData, "songId", parseCatalogId);
        const bookOf = (entries: readonly LabelledEntry[]) =>
            entries.find(({ id }) => id === input.entryId)?.bookId;
        return refused(
            entryRefusal(result, () => twinLink(songId, bookOf, input.variantNote, input.entryId)),
            values
        );
    }
    revalidateCatalogEdits();
    return {
        status: "success",
        message: `Saved ${result.label}.`,
        values,
        entryId: result.entryId,
        label: result.label,
    };
}

/**
 * Delete, once the dialog has confirmed it: take the entry out of its book
 * (`deleteCatalogEntry`); in a book without numbers the entries after it
 * move up one. An entry already gone is refused with its message.
 */
export async function deleteEntryAction(formData: FormData): Promise<EntryDeleteState> {
    await requireSession();
    const values = readValues(formData, ["entryId"]);
    const checked = validateEntryDelete(formData);
    if (!checked.ok) {
        return refused(formRefusal(checked.fieldErrors, []), values);
    }
    const { entryId } = checked.input;
    let result: EntryDeleteResult;
    try {
        result = deleteCatalogEntry(entryId);
    } catch (error) {
        return failed(`delete catalog entry ${entryId}`, error, values);
    }
    if (!result.ok) {
        return errorState(result.problems[0]?.message ?? FORM_FAILURE_MESSAGE, values);
    }
    revalidateCatalogEdits();
    return { status: "success", message: `Deleted ${result.label}.`, values, label: result.label };
}

/**
 * Move up and Move down, in a book without numbers: swap the entry with
 * its neighbour (`moveCatalogEntry`). An entry already first (or last)
 * stays, and nothing is revalidated.
 */
export async function moveEntryAction(formData: FormData): Promise<EntryMoveState> {
    await requireSession();
    const values = readValues(formData, ["entryId", "direction"]);
    const checked = validateEntryMove(formData);
    if (!checked.ok) {
        return refused(formRefusal(checked.fieldErrors, []), values);
    }
    const { entryId, direction } = checked.input;
    let result: EntryMoveResult;
    try {
        result = moveCatalogEntry(entryId, direction);
    } catch (error) {
        return failed(`move catalog entry ${entryId} ${direction}`, error, values);
    }
    if (!result.ok) {
        return errorState(result.problems[0]?.message ?? FORM_FAILURE_MESSAGE, values);
    }
    if (result.changed) {
        revalidateCatalogEdits();
    }
    return {
        status: "success",
        message: result.changed ? `Moved ${direction}.` : "Not moved.",
        values,
        changed: result.changed,
        position: result.position,
    };
}

// ---------------------------------------------------------------------------
// The hymn
// ---------------------------------------------------------------------------

/** What the hymn's Save gives back. */
export type HymnFormState = FormState<HymnPart>;

/** What Add and Remove an other title give back. */
export type HymnAliasFormState = FormState<"hymn" | "alias">;

/** The hymn form's parts that are fields. The hymn is hidden. */
const HYMN_FIELD_PARTS: readonly HymnPart[] = ["title", "firstLine", "notes"];

/**
 * The hymn's Save: its title, first line and notes (`editCatalogHymn`). A
 * title another hymn has is an error on the title that links to that
 * hymn's song. On success the values are what was stored (cleaned), for
 * the form to show, and the message says what the rename did to the other
 * titles.
 */
export async function editHymnAction(formData: FormData): Promise<HymnFormState> {
    await requireSession();
    const values = readValues(formData, HYMN_FIELDS);
    const checked = validateHymnEdit(formData);
    if (!checked.ok) {
        return refused(formRefusal(checked.fieldErrors, HYMN_FIELD_PARTS), values);
    }
    const { input } = checked;
    let result: HymnEditResult;
    try {
        result = editCatalogHymn(input);
    } catch (error) {
        return failed(`save hymn ${input.hymnId}`, error, values);
    }
    if (!result.ok) {
        return refused(editRefusal(result.problems, HYMN_FIELD_PARTS), values);
    }
    revalidateCatalogEdits();
    return formSuccess(describeNameSaved("hymn", result), {
        hymnId: values.hymnId,
        title: input.title,
        firstLine: input.firstLine ?? "",
        notes: input.notes ?? "",
    });
}

/** Add another title: give the hymn another title, which Planning Center songs are matched by too. */
export async function addHymnAliasAction(formData: FormData): Promise<HymnAliasFormState> {
    await requireSession();
    const values = readValues(formData, HYMN_ALIAS_FIELDS);
    const checked = validateHymnAlias(formData);
    if (!checked.ok) {
        return refused(formRefusal(checked.fieldErrors, ["alias"]), values);
    }
    const { input } = checked;
    let result: HymnAliasResult;
    try {
        result = addCatalogHymnAlias(input);
    } catch (error) {
        return failed(`add another title to hymn ${input.hymnId}`, error, values);
    }
    if (!result.ok) {
        return refused(editRefusal(result.problems, ["alias"]), values);
    }
    revalidateCatalogEdits();
    return formSuccess(describeAliasAdded("hymn", result.alias), { ...values, alias: "" });
}

/** Remove, beside another title: take it off the hymn. The title is posted hidden, so any refusal is the form's message. */
export async function removeHymnAliasAction(formData: FormData): Promise<HymnAliasFormState> {
    await requireSession();
    const values = readValues(formData, HYMN_ALIAS_FIELDS);
    const checked = validateHymnAlias(formData);
    if (!checked.ok) {
        return refused(formRefusal(checked.fieldErrors, []), values);
    }
    const { input } = checked;
    let result: HymnAliasResult;
    try {
        result = removeCatalogHymnAlias(input);
    } catch (error) {
        return failed(`remove another title of hymn ${input.hymnId}`, error, values);
    }
    if (!result.ok) {
        return refused(editRefusal(result.problems, []), values);
    }
    revalidateCatalogEdits();
    return formSuccess(describeAliasRemoved("hymn", result.alias), values);
}

// ---------------------------------------------------------------------------
// Merge this hymn into…
// ---------------------------------------------------------------------------

/** What reading the hymns to merge into gives back. */
export type HymnOptionsState = { ok: true; options: HymnOption[] } | { ok: false; message: string };

/** What the merge's preview gives back: what the merge would do, or why it cannot be planned. */
export type MergePreviewState = { ok: true; preview: MergePreview } | { ok: false; message: string };

/**
 * What the merge gives back when it does not merge: why, with the plan
 * whose refusals say so when it was refused as it was written.
 */
export type MergeRefusalState = { ok: false; message: string; preview: MergePreview | null };

/**
 * What the merge gives back: what it did, which is the plan it carried out,
 * planned again where it wrote and so not always the preview that was
 * confirmed; or why it did not merge.
 */
export type MergeState = { ok: true; preview: MergePreview } | MergeRefusalState;

const HYMN_OPTIONS_FAILURE_MESSAGE =
    "The hymns could not be read. Try again; the server log has the details.";

/**
 * The hymns "Merge this hymn into…" chooses from (`getHymnOptions`): every
 * hymn, by title, with its other titles and tunes. It reads the whole
 * catalog, so the picker asks for it when it opens rather than the page on
 * every load. It writes and revalidates nothing.
 */
export async function listHymnOptionsAction(): Promise<HymnOptionsState> {
    await requireSession();
    try {
        return { ok: true, options: getHymnOptions() };
    } catch (error) {
        console.error("Failed to read the hymns to merge into:", error);
        return { ok: false, message: HYMN_OPTIONS_FAILURE_MESSAGE };
    }
}

/** The first message of a merge form's errors: the target to choose, or a hidden id that is not one. */
function mergeFormMessage(errors: Partial<Record<string, { message: string }>>): string {
    return errors.source?.message ?? errors.target?.message ?? STALE_PAGE_MESSAGE;
}

/**
 * The preview: what merging the posted hymn (`sourceId`) into the one
 * chosen (`targetId`) would do (`previewCatalogHymnMerge`): the songs that
 * move and merge, what else changes, and why it would be refused. Nothing
 * is written.
 */
export async function previewHymnMergeAction(formData: FormData): Promise<MergePreviewState> {
    await requireSession();
    const checked = validateMerge(formData, "hymn");
    if (!checked.ok) {
        return { ok: false, message: mergeFormMessage(checked.fieldErrors) };
    }
    const { sourceId, targetId } = checked.input;
    let result: MergePlanResult;
    try {
        result = previewCatalogHymnMerge(sourceId, targetId);
    } catch (error) {
        console.error(`Failed to preview merging hymn ${sourceId} into ${targetId}:`, error);
        return { ok: false, message: FORM_FAILURE_MESSAGE };
    }
    return result.ok ? { ok: true, preview: result.preview } : { ok: false, message: result.message };
}

/**
 * Merge, once the dialog has confirmed it: merge the posted hymn into the
 * one chosen (`mergeCatalogHymns`, which plans afresh and writes it all in
 * one transaction). Then every page that shows the catalog is revalidated,
 * and what the merge did comes back: its notice says that, not what the
 * preview showed. The panel then replaces the page, which may be gone, with
 * the song this page's song is now (`hymnMergeLanding`). A merge refused as
 * it is written comes back with its plan.
 */
export async function mergeHymnsAction(formData: FormData): Promise<MergeState> {
    await requireSession();
    const checked = validateMerge(formData, "hymn");
    if (!checked.ok) {
        return { ok: false, message: mergeFormMessage(checked.fieldErrors), preview: null };
    }
    const { sourceId, targetId } = checked.input;
    let result: MergeApplyResult;
    try {
        result = mergeCatalogHymns(sourceId, targetId);
    } catch (error) {
        console.error(`Failed to merge hymn ${sourceId} into ${targetId}:`, error);
        return { ok: false, message: FORM_FAILURE_MESSAGE, preview: null };
    }
    if (!result.ok) {
        return result.reason === "refused"
            ? { ok: false, message: MERGE_REFUSED_NOW_MESSAGE, preview: result.preview }
            : { ok: false, message: result.message, preview: null };
    }
    revalidateCatalogEdits();
    return { ok: true, preview: result.preview };
}
