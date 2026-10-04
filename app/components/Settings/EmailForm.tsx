"use client";

import { saveEmailAction } from "@/app/(app)/settings/actions";
import { fieldErrorOf } from "@/lib/forms";
import { EMAIL_RECIPIENTS_FIELD, EMAIL_SUBJECT_FIELD } from "@/lib/settingsForms";
import {
    EMAIL_RECIPIENTS_HINT,
    EMAIL_SUBJECT_HINT,
    EMAIL_SUBJECT_SAMPLE_PLAN,
    previewEmailSubject,
    previewRecipients,
} from "@/lib/settingsText";
import {
    PreviewSample,
    SettingsFormFooter,
    SettingsTextArea,
    SettingsTextField,
} from "./SettingsFields";
import { useSettingsForm } from "./useSettingsForm";

interface EmailFormProps {
    /** The saved recipients. */
    recipients: readonly string[];
    /** The saved subject template. */
    subjectTemplate: string;
}

/**
 * The Email card's form: the recipients, one address on each line or
 * separated by commas, with how many people the email goes to (or which
 * entries are not addresses) as they are typed, and the subject's template,
 * with the subject it makes for a sample plan. Its action (`saveEmailAction`)
 * checks every address and saves; a refusal shows on the field, with a
 * summary above Save.
 */
export default function EmailForm({ recipients, subjectTemplate }: EmailFormProps) {
    const form = useSettingsForm(
        {
            [EMAIL_RECIPIENTS_FIELD]: recipients.join("\n"),
            [EMAIL_SUBJECT_FIELD]: subjectTemplate,
        },
        saveEmailAction
    );
    const { values, state } = form;
    const subject = previewEmailSubject(values[EMAIL_SUBJECT_FIELD]);

    return (
        <form onSubmit={form.onSubmit} className="space-y-6">
            <SettingsTextArea
                id="email-recipients"
                name={EMAIL_RECIPIENTS_FIELD}
                label="Recipients"
                hint={EMAIL_RECIPIENTS_HINT}
                value={values[EMAIL_RECIPIENTS_FIELD]}
                onChange={(value) => form.setValue(EMAIL_RECIPIENTS_FIELD, value)}
                preview={previewRecipients(values[EMAIL_RECIPIENTS_FIELD])}
                error={fieldErrorOf(state, EMAIL_RECIPIENTS_FIELD)}
                placeholder="pastor@example.org"
                readOnly={form.pending}
            />
            <SettingsTextField
                id="email-subject"
                name={EMAIL_SUBJECT_FIELD}
                label="Subject"
                hint={EMAIL_SUBJECT_HINT}
                value={values[EMAIL_SUBJECT_FIELD]}
                onChange={(value) => form.setValue(EMAIL_SUBJECT_FIELD, value)}
                preview={
                    subject === null ? undefined : (
                        <>
                            For {EMAIL_SUBJECT_SAMPLE_PLAN} it reads:{" "}
                            <PreviewSample>{subject}</PreviewSample>
                        </>
                    )
                }
                error={fieldErrorOf(state, EMAIL_SUBJECT_FIELD)}
                readOnly={form.pending}
            />
            <SettingsFormFooter form={form} saveLabel="Save email" />
        </form>
    );
}
