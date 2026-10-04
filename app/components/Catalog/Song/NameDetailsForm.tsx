"use client";

import { useState } from "react";
import { fieldErrorOf, type FormState } from "@/lib/forms";
import { EditTextArea, EditTextField, FormAlert, PendingSubmit, StatusLine } from "./EditFields";
import { useEditForm } from "./useEditForm";

/** One field of the form: its name in the form data, its label and hint, and its longest text. */
export interface NameDetailsField {
    name: string;
    label: string;
    hint?: string;
    maxLength: number;
    /** A text area (notes) rather than one line. */
    multiline?: boolean;
}

interface NameDetailsFormProps {
    /** The prefix of the fields' ids, unique on the page: "hymn", "tune". */
    idPrefix: string;
    /** The hidden field that names the hymn or tune ("hymnId", "tuneId"), and its id. */
    idField: { name: string; value: number };
    /** The fields, in order: the title (or name), the first line (or meter), the notes. */
    fields: readonly NameDetailsField[];
    /** What the fields start with, by name: the hymn or tune as stored. */
    initial: Record<string, string>;
    action: (formData: FormData) => Promise<FormState>;
    /** The button's text: "Save hymn". */
    saveLabel: string;
}

/**
 * The details of a hymn (title, first line, notes) or a tune (name, meter,
 * notes), as a form: the fields are controlled, and once a save succeeds
 * they hold what was stored (cleaned), with what the save did in the status
 * region until a field changes. A refusal marks its field, with a link to
 * what it clashes with, and is an alert above Save, where focus stays.
 */
export default function NameDetailsForm({
    idPrefix,
    idField,
    fields,
    initial,
    action,
    saveLabel,
}: NameDetailsFormProps) {
    const [values, setValues] = useState(initial);
    /** True once a field changed after the last save, so "Saved." is no longer true. */
    const [edited, setEdited] = useState(false);
    const form = useEditForm(action, (state) => {
        if (state.status === "success") {
            setValues((current) => ({ ...current, ...pick(state.values, fields) }));
            setEdited(false);
        }
    });
    const status = !form.pending && !edited && form.state.status === "success" ? form.state.message : "";

    return (
        <form onSubmit={form.onSubmit} className="space-y-4">
            <input type="hidden" name={idField.name} value={idField.value} />
            {fields.map((field) => {
                const props = {
                    id: `${idPrefix}-${field.name}`,
                    name: field.name,
                    label: field.label,
                    hint: field.hint,
                    maxLength: field.maxLength,
                    value: values[field.name] ?? "",
                    onChange: (value: string) => {
                        if (!form.pending) {
                            setValues((current) => ({ ...current, [field.name]: value }));
                            setEdited(true);
                        }
                    },
                    error: fieldErrorOf(form.state, field.name),
                    readOnly: form.pending,
                };
                return field.multiline ? (
                    <EditTextArea key={field.name} {...props} />
                ) : (
                    <EditTextField key={field.name} {...props} />
                );
            })}
            <FormAlert state={form.state} />
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <PendingSubmit pending={form.pending} pendingLabel="Saving…">
                    {saveLabel}
                </PendingSubmit>
                <StatusLine text={status} />
            </div>
        </form>
    );
}

/** The values a save gave back for the form's own fields: what was stored. */
function pick(values: Record<string, string>, fields: readonly NameDetailsField[]): Record<string, string> {
    const picked: Record<string, string> = {};
    for (const { name } of fields) {
        if (Object.hasOwn(values, name)) {
            picked[name] = values[name];
        }
    }
    return picked;
}
