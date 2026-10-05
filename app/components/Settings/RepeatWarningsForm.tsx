"use client";

import { saveRepeatWarningsAction } from "@/app/(app)/settings/actions";
import { fieldErrorOf } from "@/lib/forms";
import { DEFAULT_SETTINGS, REPEAT_WARNING_WEEKS_MAX } from "@/lib/settings";
import { REPEAT_WARNING_WEEKS_FIELD } from "@/lib/settingsForms";
import { previewRepeatWarnings } from "@/lib/settingsText";
import { SettingsFormFooter, SettingsTextField } from "./SettingsFields";
import { useSettingsForm } from "./useSettingsForm";

interface RepeatWarningsFormProps {
    /** The saved window, in weeks. */
    repeatWarningWeeks: number;
}

/**
 * The Repeat warnings card's form: how many weeks back a song counts as sung
 * lately, with what a song's card then says, as it will read. Its action
 * (`saveRepeatWarningsAction`) saves it; a refusal shows on the field, with a
 * summary above Save.
 */
export default function RepeatWarningsForm({ repeatWarningWeeks }: RepeatWarningsFormProps) {
    const form = useSettingsForm(
        { [REPEAT_WARNING_WEEKS_FIELD]: String(repeatWarningWeeks) },
        saveRepeatWarningsAction
    );
    const weeks = form.values[REPEAT_WARNING_WEEKS_FIELD];

    return (
        <form onSubmit={form.onSubmit} className="space-y-4">
            <SettingsTextField
                id="repeat-warning-weeks"
                name={REPEAT_WARNING_WEEKS_FIELD}
                label="Weeks to look back"
                hint={`A whole number from 0 to ${REPEAT_WARNING_WEEKS_MAX}; 0 turns the warnings off. The default is ${DEFAULT_SETTINGS.repeatWarningWeeks}.`}
                value={weeks}
                onChange={(value) => form.setValue(REPEAT_WARNING_WEEKS_FIELD, value)}
                preview={previewRepeatWarnings(weeks)}
                error={fieldErrorOf(form.state, REPEAT_WARNING_WEEKS_FIELD)}
                inputMode="numeric"
                readOnly={form.pending}
            />
            <SettingsFormFooter form={form} saveLabel="Save repeat warnings" />
        </form>
    );
}
