"use client";

import { saveHymnalNotesAction } from "@/app/(app)/settings/actions";
import { fieldErrorOf } from "@/lib/forms";
import { CATEGORY_NAME_FIELD, INCLUDES_TUNE_FIELD, NO, YES } from "@/lib/settingsForms";
import { previewHymnNote } from "@/lib/settingsText";
import { FieldErrorText, HINT_CLASS } from "../Catalog/SongForm/Fields";
import { PreviewSample, SettingsFormFooter, SettingsTextField } from "./SettingsFields";
import { useSettingsForm } from "./useSettingsForm";

interface HymnalNotesFormProps {
    /** The saved name of the item note category the notes go in. */
    categoryName: string;
    /** Whether a note names the tune after the numbers. */
    includesTune: boolean;
    /** The saved number separator, which the notes join the numbers with. */
    numberSeparator: string;
}

/**
 * The Hymnal notes card's form: the name of the item note category the notes
 * go in, and whether a note names the tune, with a preview of a note as it
 * would read. The yes or no is posted through a hidden field, and the
 * checkbox beside it has no name of its own, so the action reads it as it
 * does the other fields.
 */
export default function HymnalNotesForm({
    categoryName,
    includesTune,
    numberSeparator,
}: HymnalNotesFormProps) {
    const form = useSettingsForm(
        { [CATEGORY_NAME_FIELD]: categoryName, [INCLUDES_TUNE_FIELD]: includesTune ? YES : NO },
        saveHymnalNotesAction
    );
    const { values, state } = form;
    const tuneChecked = values[INCLUDES_TUNE_FIELD] === YES;
    const tuneError = fieldErrorOf(state, INCLUDES_TUNE_FIELD);
    const preview = previewHymnNote({ numberSeparator, hymnNoteIncludesTune: tuneChecked });

    return (
        <form onSubmit={form.onSubmit} className="space-y-4">
            <SettingsTextField
                id="hymnal-category-name"
                name={CATEGORY_NAME_FIELD}
                label="Item note category"
                hint="The category the notes are written in. The app finds it by this name in each service type, ignoring capital letters."
                value={values[CATEGORY_NAME_FIELD]}
                onChange={(value) => form.setValue(CATEGORY_NAME_FIELD, value)}
                error={fieldErrorOf(state, CATEGORY_NAME_FIELD)}
            />
            <div className="space-y-1">
                <input type="hidden" name={INCLUDES_TUNE_FIELD} value={tuneChecked ? YES : NO} />
                <label className="flex items-start gap-3 text-sm font-medium text-gray-700 dark:text-gray-300">
                    <input
                        type="checkbox"
                        checked={tuneChecked}
                        onChange={(event) =>
                            form.setValue(INCLUDES_TUNE_FIELD, event.target.checked ? YES : NO)
                        }
                        aria-describedby={[
                            "hymnal-includes-tune-preview",
                            tuneError ? "hymnal-includes-tune-error" : null,
                        ]
                            .filter(Boolean)
                            .join(" ")}
                        aria-invalid={tuneError ? true : undefined}
                        className="mt-0.5 size-4 shrink-0 cursor-pointer accent-blue-600"
                    />
                    <span>Name the tune after the numbers</span>
                </label>
                <p id="hymnal-includes-tune-preview" className={`pl-7 ${HINT_CLASS}`}>
                    A note reads: <PreviewSample>{preview}</PreviewSample>
                </p>
                <div className="pl-7">
                    <FieldErrorText id="hymnal-includes-tune-error" error={tuneError} />
                </div>
            </div>
            <SettingsFormFooter form={form} saveLabel="Save hymnal notes" />
        </form>
    );
}
