"use client";

import { saveCopyrightAction } from "@/app/(app)/settings/actions";
import { fieldErrorOf } from "@/lib/forms";
import { CCLI_LICENSE_NUMBER_FIELD } from "@/lib/settingsForms";
import { previewCopyrightFooter } from "@/lib/settingsText";
import { PreviewSample, SettingsFormFooter, SettingsTextField } from "./SettingsFields";
import { useSettingsForm } from "./useSettingsForm";

interface CopyrightFormProps {
    /** The saved CCLI license number. */
    ccliLicenseNumber: string;
}

/**
 * The Copyright card's form: the CCLI Streaming License number, with the
 * line of the copyright text it ends up in, as it will read. Its action
 * (`saveCopyrightAction`) saves it; a refusal shows on the field, with a
 * summary above Save.
 */
export default function CopyrightForm({ ccliLicenseNumber }: CopyrightFormProps) {
    const form = useSettingsForm(
        { [CCLI_LICENSE_NUMBER_FIELD]: ccliLicenseNumber },
        saveCopyrightAction
    );
    const number = form.values[CCLI_LICENSE_NUMBER_FIELD];
    const footer = previewCopyrightFooter(number);

    return (
        <form onSubmit={form.onSubmit} className="space-y-4">
            <SettingsTextField
                id="ccli-license-number"
                name={CCLI_LICENSE_NUMBER_FIELD}
                label="CCLI Streaming License number"
                hint="Digits only, such as 1564484."
                value={number}
                onChange={(value) => form.setValue(CCLI_LICENSE_NUMBER_FIELD, value)}
                preview={
                    footer && (
                        <>
                            Every copyright text ends with: <PreviewSample>{footer}</PreviewSample>
                        </>
                    )
                }
                error={fieldErrorOf(form.state, CCLI_LICENSE_NUMBER_FIELD)}
                inputMode="numeric"
                readOnly={form.pending}
            />
            <SettingsFormFooter form={form} saveLabel="Save copyright" />
        </form>
    );
}
