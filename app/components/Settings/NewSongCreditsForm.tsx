"use client";

import { saveNewSongCreditsAction } from "@/app/(app)/settings/actions";
import LocalTime from "@/app/components/ui/LocalTime";
import { fieldErrorOf } from "@/lib/forms";
import { CREDIT_AUTO_LABEL_FIELD, NO, YES } from "@/lib/settingsForms";
import { FieldErrorText, HINT_CLASS } from "../Catalog/SongForm/Fields";
import { SettingsFormFooter } from "./SettingsFields";
import { useSettingsForm } from "./useSettingsForm";

interface NewSongCreditsFormProps {
    /** When labelling new songs automatically was turned on; null while it is off. */
    since: string | null;
}

/**
 * The New songs' credits card's form: whether the app labels new songs'
 * authors by itself. The yes or no is posted through a hidden field, as the
 * Hymnal notes form's is; the action turns it into when it was turned on.
 * While it is on, the form says since when.
 */
export default function NewSongCreditsForm({ since }: NewSongCreditsFormProps) {
    const form = useSettingsForm({ [CREDIT_AUTO_LABEL_FIELD]: since === null ? NO : YES }, saveNewSongCreditsAction);
    const { values, state } = form;
    const checked = values[CREDIT_AUTO_LABEL_FIELD] === YES;
    const error = fieldErrorOf(state, CREDIT_AUTO_LABEL_FIELD);

    return (
        <form onSubmit={form.onSubmit} className="space-y-4">
            <div className="space-y-1">
                <input type="hidden" name={CREDIT_AUTO_LABEL_FIELD} value={checked ? YES : NO} />
                <label className="flex items-start gap-3 text-sm font-medium text-gray-700 dark:text-gray-300">
                    <input
                        type="checkbox"
                        checked={checked}
                        // Not `disabled`, which would grey the box for the moment a
                        // save lasts; the form ignores a change while it saves.
                        aria-disabled={form.pending || undefined}
                        onChange={(event) =>
                            form.setValue(CREDIT_AUTO_LABEL_FIELD, event.target.checked ? YES : NO)
                        }
                        aria-describedby={["new-song-credits-hint", error ? "new-song-credits-error" : null]
                            .filter(Boolean)
                            .join(" ")}
                        aria-invalid={error ? true : undefined}
                        className="mt-0.5 size-4 shrink-0 cursor-pointer accent-blue-600"
                    />
                    <span>Label new songs automatically</span>
                </label>
                <p id="new-song-credits-hint" className={`pl-7 ${HINT_CLASS}`}>
                    {since === null ? (
                        "Off: new songs wait on the Credits page, like the rest."
                    ) : (
                        <>
                            On since <LocalTime iso={since} />: songs created in Planning Center
                            since then are labelled within about a quarter of an hour.
                        </>
                    )}
                </p>
                <div className="pl-7">
                    <FieldErrorText id="new-song-credits-error" error={error} />
                </div>
            </div>
            <SettingsFormFooter form={form} saveLabel="Save new songs' credits" />
        </form>
    );
}
