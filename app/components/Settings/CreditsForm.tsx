"use client";

import { useEffect, useRef, useState } from "react";
import { saveCreditsAction } from "@/app/(app)/settings/actions";
import {
    NO_ROLES_IMPACT,
    ROLES_IMPACT_EXPLANATION,
    ROLES_IMPACT_UNKNOWN_NOTICE,
    confirmRolesImpactLabel,
    creditRolesImpact,
    rolesImpactHeadline,
    rolesImpactKey,
    rolesImpactLabels,
    type CreditLabelSet,
    type CreditRolesImpact,
} from "@/lib/creditRoleImpact";
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
import { fieldErrorOf, type FieldError } from "@/lib/forms";
import { CREDIT_ROLES_MAX, type CreditPhrases } from "@/lib/settings";
import { CREDIT_ROLES_CONFIRM_FIELD, CREDIT_ROLES_FIELD } from "@/lib/settingsForms";
import {
    creditPairPhraseHint,
    creditPhraseHint,
    creditRoleLegend,
    previewCreditLines,
} from "@/lib/settingsText";
import { FieldErrorText, FormNotice, FormPart, HINT_CLASS } from "../Catalog/SongForm/Fields";
import { PreviewSample, SettingsFormFooter, SettingsTextField } from "./SettingsFields";
import { useSettingsForm } from "./useSettingsForm";

interface CreditsFormProps {
    /** The saved credit roles, in order. */
    creditRoles: readonly string[];
    /** The saved credit phrases, by role. */
    creditPhrases: CreditPhrases;
    /** The labels the songs' authors use, read with the saved roles; null when they could not be read. */
    labelSets: readonly CreditLabelSet[] | null;
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

/** The ids of the impact notice's parts, which describe its checkbox. */
const IMPACT_HEADLINE_ID = "credit-roles-impact-headline";
const IMPACT_LABELS_ID = "credit-roles-impact-labels";
const IMPACT_EXPLANATION_ID = "credit-roles-impact-explanation";
const CONFIRM_ERROR_ID = "credit-roles-confirm-error";

interface RolesImpactNoticeProps {
    /** What the roles in the form would do to songs. */
    impact: CreditRolesImpact;
    /** True when the songs' labels could not be read, so the impact is not known. */
    unknown: boolean;
    /** Whether the checkbox confirms this impact. */
    confirmed: boolean;
    onConfirmedChange: (confirmed: boolean) => void;
    /** What the action found wrong with the confirmation. */
    error: FieldError | undefined;
    /** True while the form saves: the checkbox takes no change. */
    pending: boolean;
}

/**
 * What saving the roles in the form would do to songs, above Save: how many
 * songs' copyright text would change, the labels their authors use that
 * would no longer be roles, what those songs would print, and a checkbox
 * that confirms it, which the action requires (`saveCreditsAction`). The
 * checkbox posts how many songs it confirms, and the parts of the notice
 * describe it. Nothing when no song would change; when the songs' labels
 * could not be read, a note that says so.
 */
function RolesImpactNotice({
    impact,
    unknown,
    confirmed,
    onConfirmedChange,
    error,
    pending,
}: RolesImpactNoticeProps) {
    if (unknown) {
        return (
            <FormNotice tone="warning">
                <p>{ROLES_IMPACT_UNKNOWN_NOTICE}</p>
                <FieldErrorText id={CONFIRM_ERROR_ID} error={error} />
            </FormNotice>
        );
    }
    if (impact.songs === 0) {
        return null;
    }
    return (
        <FormNotice tone="warning">
            <p id={IMPACT_HEADLINE_ID} className="font-semibold">
                {rolesImpactHeadline(impact.songs)}
            </p>
            <p id={IMPACT_LABELS_ID}>{rolesImpactLabels(impact)}</p>
            <p id={IMPACT_EXPLANATION_ID}>{ROLES_IMPACT_EXPLANATION}</p>
            <div className="space-y-1">
                <label className="flex items-start gap-3 font-medium">
                    <input
                        type="checkbox"
                        name={CREDIT_ROLES_CONFIRM_FIELD}
                        value={String(impact.songs)}
                        checked={confirmed}
                        // Not `disabled`, which would grey the box for the moment a
                        // save lasts; the form ignores a change while it saves.
                        aria-disabled={pending || undefined}
                        onChange={(event) => onConfirmedChange(event.target.checked)}
                        aria-describedby={[
                            IMPACT_HEADLINE_ID,
                            IMPACT_LABELS_ID,
                            IMPACT_EXPLANATION_ID,
                            error ? CONFIRM_ERROR_ID : null,
                        ]
                            .filter(Boolean)
                            .join(" ")}
                        aria-invalid={error ? true : undefined}
                        className="mt-0.5 size-4 shrink-0 cursor-pointer accent-blue-600"
                    />
                    <span>{confirmRolesImpactLabel(impact.songs)}</span>
                </label>
                <div className="pl-7">
                    <FieldErrorText id={CONFIRM_ERROR_ID} error={error} />
                </div>
            </div>
        </FormNotice>
    );
}

/**
 * The Credits card's form: the credit roles as a list of rows, each with the
 * phrase the copyright text prints before its names (Add a role, and Move
 * up, Move down and Remove on each row), the phrase for the first two roles
 * when the same people hold both, and a preview of a credit line as it will
 * print. Its action (`saveCreditsAction`) saves them and reads every song's
 * author again with the new roles, and says how many songs that was.
 *
 * Renaming or removing a role that songs' authors use as a label changes
 * those songs' copyright text, so the form shows, as the roles are edited,
 * how many songs that would be and which labels (`creditRolesImpact`, from
 * the page's `labelSets`), and saves only once a checkbox confirms it. The
 * confirmation holds for the impact it was given: any change to what would
 * change clears it. The action checks the same against the mirror.
 *
 * The fields are a flat map like the other forms' (`lib/creditRows.ts` adds,
 * removes and moves rows in it), so the row buttons and the keyboard work
 * as the form's other controls do. A row that is added, removed or moved
 * hands focus to the control that stands for it now, and says what was done
 * in a status line, so a keyboard or screen reader user is never left on a
 * button that has gone. The buttons that cannot act (the first row's Move
 * up, Remove at two roles) are `aria-disabled` and keep focus.
 */
export default function CreditsForm({ creditRoles, creditPhrases, labelSets }: CreditsFormProps) {
    const form = useSettingsForm(creditFormValues(creditRoles, creditPhrases), saveCreditsAction);
    const { values, state } = form;
    const rows = creditRowsOf(values);
    const canAdd = canAddCreditRow(values);
    const canRemove = canRemoveCreditRow(values);
    const rolesError = fieldErrorOf(state, CREDIT_ROLES_FIELD);
    const preview = previewCreditLines(rows, values[CREDIT_PAIR_PHRASE_FIELD] ?? "");
    // While the fields show what was just saved, no song would change, though
    // `labelSets` may still be the ones read with the roles before, until the
    // page the save revalidated arrives.
    const impact =
        labelSets === null || form.saved
            ? NO_ROLES_IMPACT
            : creditRolesImpact(labelSets, rows.map((row) => row.role));
    const impactKey = rolesImpactKey(impact);
    /** The impact the checkbox was ticked for; it confirms only that one. */
    const [confirmedKey, setConfirmedKey] = useState<string | null>(null);
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
        if (canAdd && form.replaceValues(addCreditRow)) {
            focusRef.current = roleInputId(rows.length);
            setAnnouncement(`Added role ${rows.length + 1}.`);
        }
    }

    function removeRole(index: number) {
        if (canRemove && form.replaceValues((current) => removeCreditRow(current, index))) {
            const left = rows.length - 1;
            focusRef.current = roleInputId(Math.min(index, left - 1));
            setAnnouncement(`Removed role ${index + 1}. ${left} roles left.`);
        }
    }

    function moveRole(index: number, by: -1 | 1) {
        const target = index + by;
        if (
            target >= 0 &&
            target < rows.length &&
            form.replaceValues((current) => moveCreditRow(current, index, by))
        ) {
            focusRef.current = by < 0 ? upButtonId(target) : downButtonId(target);
            setAnnouncement(
                `Moved ${rows[index].role.trim() || `role ${index + 1}`} to position ${target + 1}.`
            );
        }
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
                    author is labelled with a role you rename or remove, such as “Music:”, then
                    prints its whole author in place of its credit line, and its page flags it, so
                    the form asks you to confirm such a change before it saves.
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
            <RolesImpactNotice
                impact={impact}
                unknown={labelSets === null}
                confirmed={impact.songs > 0 && confirmedKey === impactKey}
                onConfirmedChange={(confirmed) => {
                    if (!form.pending) {
                        setConfirmedKey(confirmed ? impactKey : null);
                    }
                }}
                error={fieldErrorOf(state, CREDIT_ROLES_CONFIRM_FIELD)}
                pending={form.pending}
            />
            <SettingsFormFooter form={form} saveLabel="Save credits" />
            <p role="status" className="sr-only">
                {announcement}
            </p>
        </form>
    );
}
