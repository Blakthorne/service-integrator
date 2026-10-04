"use client";

import { saveScheduleTextAction } from "@/app/(app)/settings/actions";
import { fieldErrorOf, type FormValues } from "@/lib/forms";
import { NUMBER_SEPARATOR_FIELD, headerLabelField } from "@/lib/settingsForms";
import { headerLabelHint, previewNumbers, type HeaderLabelRow } from "@/lib/settingsText";
import { FormPart } from "../Catalog/SongForm/Fields";
import { PreviewSample, SettingsFormFooter, SettingsTextField } from "./SettingsFields";
import { useSettingsForm } from "./useSettingsForm";

interface ScheduleTextFormProps {
    /**
     * A row for each service type Planning Center listed, with its saved
     * label; none when Planning Center could not be reached, and then only
     * the separator can be edited.
     */
    rows: readonly HeaderLabelRow[];
    /** The saved number separator. */
    numberSeparator: string;
}

/** What the fields start with: the saved labels and separator. */
function initialValues(rows: readonly HeaderLabelRow[], numberSeparator: string): FormValues {
    return {
        [NUMBER_SEPARATOR_FIELD]: numberSeparator,
        ...Object.fromEntries(rows.map((row) => [headerLabelField(row.serviceTypeId), row.label])),
    };
}

/**
 * The Schedule text card's form: a header label for each service type, each
 * saying what it gets when left blank, and the number separator with a
 * preview of the numbers it makes. One Save saves all of them
 * (`saveScheduleTextAction`); a label the action refuses is marked on its
 * own field.
 */
export default function ScheduleTextForm({ rows, numberSeparator }: ScheduleTextFormProps) {
    const form = useSettingsForm(initialValues(rows, numberSeparator), saveScheduleTextAction);
    const { values, state } = form;
    const separator = values[NUMBER_SEPARATOR_FIELD];
    const preview = previewNumbers(separator);

    return (
        <form onSubmit={form.onSubmit} className="space-y-6">
            {rows.length > 0 && (
                <>
                    <FormPart
                        legend="Header labels"
                        description={
                            'The text starts with a line that has the label and the plan\'s date, such as "Sunday AM 10/4/26".'
                        }
                    >
                        <div className="space-y-4">
                            {rows.map((row) => {
                                const field = headerLabelField(row.serviceTypeId);
                                return (
                                    <SettingsTextField
                                        key={row.serviceTypeId}
                                        id={`header-label-${row.serviceTypeId}`}
                                        name={field}
                                        label={row.serviceTypeName}
                                        hint={headerLabelHint(row.defaultLabel)}
                                        placeholder={row.defaultLabel ?? undefined}
                                        value={values[field] ?? row.label}
                                        onChange={(value) => form.setValue(field, value)}
                                        error={fieldErrorOf(state, field)}
                                        readOnly={form.pending}
                                    />
                                );
                            })}
                        </div>
                    </FormPart>
                    <hr className="border-gray-200 dark:border-gray-700" />
                </>
            )}
            <SettingsTextField
                id="number-separator"
                name={NUMBER_SEPARATOR_FIELD}
                label="Number separator"
                hint={
                    'What goes between a song\'s numbers, in this text and in the hymnal notes. Spaces count: the default is " / ", a slash with a space on each side.'
                }
                value={separator}
                onChange={(value) => form.setValue(NUMBER_SEPARATOR_FIELD, value)}
                preview={
                    preview === null ? undefined : (
                        <>
                            A song in both books reads: <PreviewSample>{preview}</PreviewSample>
                        </>
                    )
                }
                error={fieldErrorOf(state, NUMBER_SEPARATOR_FIELD)}
                autoCapitalize="none"
                readOnly={form.pending}
            />
            <SettingsFormFooter form={form} saveLabel="Save schedule text" />
        </form>
    );
}
