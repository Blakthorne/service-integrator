"use client";

import { useEffect, useRef, useState } from "react";
import { saveCreditsAction } from "@/app/(app)/settings/actions";
import {
    CREDIT_PAIR_PHRASE_FIELD,
    addCreditRow,
    canAddCreditRow,
    canRemoveCreditRow,
    creditFormValues,
    creditPhraseField,
    creditRoleField,
    creditRowsOf,
    moveCreditRow,
    removeCreditRow,
} from "@/lib/creditRows";
import { fieldErrorOf } from "@/lib/forms";
import { CREDIT_ROLES_MAX, type CreditPhrases } from "@/lib/settings";
import { CREDIT_ROLES_FIELD } from "@/lib/settingsForms";
import {
    creditPairPhraseHint,
    creditPhraseHint,
    creditRoleLegend,
    previewCreditLines,
} from "@/lib/settingsText";
import { FieldErrorText, FormPart, HINT_CLASS } from "../Catalog/SongForm/Fields";
import { PreviewSample, SettingsFormFooter, SettingsTextField } from "./SettingsFields";
import { useSettingsForm } from "./useSettingsForm";

interface CreditsFormProps {
    /** The saved credit roles, in order. */
    creditRoles: readonly string[];
    /** The saved credit phrases, by role. */
    creditPhrases: CreditPhrases;
}

/** A small button of a role's row (Move up, Move down, Remove), white or the dark card's grey, with a ring that shows. */
const ROW_BUTTON_BASE =
    "px-3 py-1.5 text-sm font-medium bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors cursor-pointer aria-disabled:opacity-60 aria-disabled:cursor-not-allowed aria-disabled:hover:bg-white dark:aria-disabled:hover:bg-gray-700";

const ROW_BUTTON_CLASS = `${ROW_BUTTON_BASE} text-gray-700 dark:text-gray-300`;

/** Remove is red in words and colour: 6.5:1 on white, and on the dark card 6.3:1. */
const REMOVE_BUTTON_CLASS = `${ROW_BUTTON_BASE} text-red-700 dark:text-red-300`;

/** The ids of a row's controls, which focus is handed to after a row is added, removed or moved. */
const roleInputId = (index: number) => `credit-role-${index}`;
const upButtonId = (index: number) => `credit-up-${index}`;
const downButtonId = (index: number) => `credit-down-${index}`;

/**
 * The Credits card's form: the credit roles as a list of rows, each with the
 * phrase the copyright text prints before its names (Add a role, and Move
 * up, Move down and Remove on each row), the phrase for the first two roles
 * when the same people hold both, and a preview of a credit line as it will
 * print. Its action (`saveCreditsAction`) saves them and reads every song's
 * author again with the new roles, and says how many songs that was.
 *
 * The fields are a flat map like the other forms' (`lib/creditRows.ts` adds,
 * removes and moves rows in it), so the row buttons and the keyboard work
 * as the form's other controls do. A row that is added, removed or moved
 * hands focus to the control that stands for it now, and says what was done
 * in a status line, so a keyboard or screen reader user is never left on a
 * button that has gone. The buttons that cannot act (the first row's Move
 * up, Remove at two roles) are `aria-disabled` and keep focus.
 */
export default function CreditsForm({ creditRoles, creditPhrases }: CreditsFormProps) {
    const form = useSettingsForm(creditFormValues(creditRoles, creditPhrases), saveCreditsAction);
    const { values, state } = form;
    const rows = creditRowsOf(values);
    const canAdd = canAddCreditRow(values);
    const canRemove = canRemoveCreditRow(values);
    const rolesError = fieldErrorOf(state, CREDIT_ROLES_FIELD);
    const preview = previewCreditLines(rows, values[CREDIT_PAIR_PHRASE_FIELD] ?? "");
    const [announcement, setAnnouncement] = useState("");
    /** The id of the control that takes focus once the rows have changed. */
    const focusRef = useRef<string | null>(null);

    useEffect(() => {
        if (focusRef.current !== null) {
            document.getElementById(focusRef.current)?.focus();
            focusRef.current = null;
        }
    }, [values]);

    function addRole() {
        if (form.pending || !canAdd) {
            return;
        }
        focusRef.current = roleInputId(rows.length);
        setAnnouncement(`Added role ${rows.length + 1}.`);
        form.replaceValues(addCreditRow);
    }

    function removeRole(index: number) {
        if (form.pending || !canRemove) {
            return;
        }
        const left = rows.length - 1;
        focusRef.current = roleInputId(Math.min(index, left - 1));
        setAnnouncement(`Removed role ${index + 1}. ${left} roles left.`);
        form.replaceValues((current) => removeCreditRow(current, index));
    }

    function moveRole(index: number, by: -1 | 1) {
        const target = index + by;
        if (form.pending || target < 0 || target >= rows.length) {
            return;
        }
        focusRef.current = by < 0 ? upButtonId(target) : downButtonId(target);
        setAnnouncement(
            `Moved ${rows[index].role.trim() || `role ${index + 1}`} to position ${target + 1}.`
        );
        form.replaceValues((current) => moveCreditRow(current, index, by));
    }

    return (
        <form onSubmit={form.onSubmit} className="space-y-6">
            <FormPart
                legend="Roles"
                description="List the roles in the order they are written and printed. The first role is the words and the second is the music: an author with no labels, such as “John Newton”, is read as naming those two."
                errorId={rolesError ? "credit-roles-error" : undefined}
            >
                <p className={HINT_CLASS}>
                    Saving reads every song&apos;s author again with these roles. A song whose
                    author text uses a label that no role matches is flagged as unparsed on its
                    page, and its copyright text stays as it was.
                </p>
                <ul role="list" className="space-y-4">
                    {rows.map((row, index) => {
                        const roleField = creditRoleField(index);
                        const phraseField = creditPhraseField(index);
                        const first = index === 0;
                        const last = index === rows.length - 1;
                        return (
                            <li key={index}>
                                <fieldset className="min-w-0 space-y-3 rounded-md border border-gray-200 p-4 dark:border-gray-700">
                                    <legend className="px-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
                                        {creditRoleLegend(index)}
                                    </legend>
                                    <SettingsTextField
                                        id={roleInputId(index)}
                                        name={roleField}
                                        label="Role"
                                        value={row.role}
                                        onChange={(value) => form.setValue(roleField, value)}
                                        error={fieldErrorOf(state, roleField)}
                                        readOnly={form.pending}
                                    />
                                    <SettingsTextField
                                        id={`credit-phrase-${index}`}
                                        name={phraseField}
                                        label="Printed before its names"
                                        hint={creditPhraseHint(row.role)}
                                        value={row.phrase}
                                        onChange={(value) => form.setValue(phraseField, value)}
                                        error={fieldErrorOf(state, phraseField)}
                                        readOnly={form.pending}
                                    />
                                    <div className="flex flex-wrap gap-2">
                                        <button
                                            id={upButtonId(index)}
                                            type="button"
                                            onClick={() => moveRole(index, -1)}
                                            aria-disabled={first || form.pending}
                                            aria-label={`Move role ${index + 1} up`}
                                            className={ROW_BUTTON_CLASS}
                                        >
                                            Move up
                                        </button>
                                        <button
                                            id={downButtonId(index)}
                                            type="button"
                                            onClick={() => moveRole(index, 1)}
                                            aria-disabled={last || form.pending}
                                            aria-label={`Move role ${index + 1} down`}
                                            className={ROW_BUTTON_CLASS}
                                        >
                                            Move down
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => removeRole(index)}
                                            aria-disabled={!canRemove || form.pending}
                                            aria-label={`Remove role ${index + 1}`}
                                            className={REMOVE_BUTTON_CLASS}
                                        >
                                            Remove
                                        </button>
                                    </div>
                                </fieldset>
                            </li>
                        );
                    })}
                </ul>
                <FieldErrorText id="credit-roles-error" error={rolesError} />
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <button
                        type="button"
                        onClick={addRole}
                        aria-disabled={!canAdd || form.pending}
                        aria-describedby="credit-roles-limit"
                        className={ROW_BUTTON_CLASS}
                    >
                        Add a role
                    </button>
                    <p id="credit-roles-limit" className={HINT_CLASS}>
                        At least 2 roles, and at most {CREDIT_ROLES_MAX}.
                    </p>
                </div>
            </FormPart>
            <hr className="border-gray-200 dark:border-gray-700" />
            <FormPart
                legend="One person for both"
                description="When the same people hold the first two roles, the text prints one phrase for them, in place of the two above."
            >
                <SettingsTextField
                    id="credit-pair-phrase"
                    name={CREDIT_PAIR_PHRASE_FIELD}
                    label="Printed before their names"
                    hint={creditPairPhraseHint(rows[0]?.role ?? "", rows[1]?.role ?? "")}
                    value={values[CREDIT_PAIR_PHRASE_FIELD] ?? ""}
                    onChange={(value) => form.setValue(CREDIT_PAIR_PHRASE_FIELD, value)}
                    error={fieldErrorOf(state, CREDIT_PAIR_PHRASE_FIELD)}
                    readOnly={form.pending}
                />
            </FormPart>
            {preview && (
                <>
                    <hr className="border-gray-200 dark:border-gray-700" />
                    <FormPart
                        legend="Preview"
                        description="A credit line as the copyright text prints it, with sample names."
                    >
                        <p className={HINT_CLASS}>
                            Different people: <PreviewSample>{preview.apart}</PreviewSample>
                        </p>
                        <p className={HINT_CLASS}>
                            The same person: <PreviewSample>{preview.together}</PreviewSample>
                        </p>
                    </FormPart>
                </>
            )}
            <SettingsFormFooter form={form} saveLabel="Save credits" />
            <p role="status" className="sr-only">
                {announcement}
            </p>
        </form>
    );
}
