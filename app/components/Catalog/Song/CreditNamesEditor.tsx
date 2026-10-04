"use client";

import { useEffect, useRef, useState } from "react";
import {
    addCreditName,
    canSplitCreditName,
    creditNameProblem,
    removeCreditName,
    setCreditName,
    splitCreditName,
    type CreditNamesRow,
} from "@/lib/catalog/creditsEditor";
import { INPUT_CLASS } from "../SongForm/Fields";
import { ADD_NAME_BUTTON_CLASS, REMOVE_BUTTON_CLASS, SMALL_BUTTON_CLASS } from "./styles";

/** The id of the field of name `nameIndex` of row `rowIndex`, which focus is handed to. */
function nameFieldId(idPrefix: string, rowIndex: number, nameIndex: number): string {
    return `${idPrefix}-${rowIndex}-${nameIndex}`;
}

/** A name field's accessible name: "Words, name 1". */
function nameLabel(role: string, nameIndex: number): string {
    return `${role}, name ${nameIndex + 1}`;
}

interface CreditNameFieldProps {
    id: string;
    role: string;
    nameIndex: number;
    value: string;
    /** What is wrong with the name, or null. */
    problem: string | null;
    /** Whether Remove shows: a role keeps one field. */
    removable: boolean;
    readOnly: boolean;
    onChange: (value: string) => void;
    onRemove: () => void;
    onSplit: () => void;
}

/**
 * One name of a role: its field, Remove when the role has others, and under
 * it what is wrong with the name, with "Split into names" for a field that
 * holds several ("Isaac Watts, Lowell Mason").
 */
function CreditNameField({
    id,
    role,
    nameIndex,
    value,
    problem,
    removable,
    readOnly,
    onChange,
    onRemove,
    onSplit,
}: CreditNameFieldProps) {
    const label = nameLabel(role, nameIndex);
    const problemId = `${id}-problem`;
    return (
        <div>
            <div className="flex gap-2">
                <input
                    id={id}
                    type="text"
                    value={value}
                    onChange={(event) => onChange(event.target.value)}
                    aria-label={label}
                    aria-invalid={problem ? true : undefined}
                    aria-describedby={problem ? problemId : undefined}
                    readOnly={readOnly}
                    autoComplete="off"
                    spellCheck={false}
                    className={INPUT_CLASS}
                />
                {removable && (
                    <button
                        type="button"
                        onClick={onRemove}
                        aria-disabled={readOnly}
                        aria-label={`Remove ${label}`}
                        className={REMOVE_BUTTON_CLASS}
                    >
                        Remove
                    </button>
                )}
            </div>
            {problem && (
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <p id={problemId} className="text-sm text-red-600 dark:text-red-400">
                        {problem}
                    </p>
                    {canSplitCreditName(value) && (
                        <button
                            type="button"
                            onClick={onSplit}
                            aria-disabled={readOnly}
                            aria-label={`Split into names (${label})`}
                            className={SMALL_BUTTON_CLASS}
                        >
                            Split into names
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}

interface CreditRoleRowProps {
    idPrefix: string;
    row: CreditNamesRow;
    rowIndex: number;
    roles: readonly string[];
    readOnly: boolean;
    onSet: (nameIndex: number, value: string) => void;
    onAdd: () => void;
    onRemove: (nameIndex: number) => void;
    onSplit: (nameIndex: number) => void;
}

/**
 * One role and its names: the role beside its fields from `sm`, above them
 * on a phone, and "Add a name" under them.
 */
function CreditRoleRow({
    idPrefix,
    row,
    rowIndex,
    roles,
    readOnly,
    onSet,
    onAdd,
    onRemove,
    onSplit,
}: CreditRoleRowProps) {
    const labelId = `${idPrefix}-role-${rowIndex}`;
    return (
        <div
            role="group"
            aria-labelledby={labelId}
            className="sm:grid sm:grid-cols-[6rem_minmax(0,1fr)] sm:gap-x-4"
        >
            <span
                id={labelId}
                className="block break-words text-sm font-medium text-gray-700 dark:text-gray-300 sm:pt-2"
            >
                {row.role}
            </span>
            <div className="mt-1 flex flex-col gap-2 sm:mt-0">
                {row.names.map((name, nameIndex) => (
                    <CreditNameField
                        // The fields are controlled, so a field reused for the
                        // name after it, once one is removed, shows that name.
                        key={nameIndex}
                        id={nameFieldId(idPrefix, rowIndex, nameIndex)}
                        role={row.role}
                        nameIndex={nameIndex}
                        value={name}
                        problem={creditNameProblem(name, roles)}
                        removable={row.names.length > 1}
                        readOnly={readOnly}
                        onChange={(value) => onSet(nameIndex, value)}
                        onRemove={() => onRemove(nameIndex)}
                        onSplit={() => onSplit(nameIndex)}
                    />
                ))}
                <button
                    type="button"
                    onClick={onAdd}
                    aria-disabled={readOnly}
                    aria-label={`Add a name to ${row.role}`}
                    className={ADD_NAME_BUTTON_CLASS}
                >
                    <span aria-hidden="true">+ </span>Add a name
                </button>
            </div>
        </div>
    );
}

interface CreditNamesEditorProps {
    /** Starts the id of each of its fields; unique on the page. */
    idPrefix: string;
    /** A row per role, each with its names (`lib/catalog/creditsEditor.ts`). */
    rows: readonly CreditNamesRow[];
    /** The `creditRoles` setting, which each name is checked against. */
    roles: readonly string[];
    onChange: (rows: CreditNamesRow[]) => void;
    /** True while an action runs: the fields take no input, and the buttons do nothing. */
    readOnly: boolean;
}

/**
 * The credit editor's rows, a role each, with one or more names: what the
 * song page's Credits card and the "Create in Planning Center" form edit.
 * The rows live in the parent's state, and every change goes through the
 * pure functions of `lib/catalog/creditsEditor.ts`. A name that cannot be
 * written is marked as it is typed, with why (`creditNameProblem`).
 *
 * Adding, removing or splitting a name hands focus to the field that
 * stands for it now, so a keyboard user is never left on a button that
 * has gone, and says what was done in a status line.
 */
export default function CreditNamesEditor({
    idPrefix,
    rows,
    roles,
    onChange,
    readOnly,
}: CreditNamesEditorProps) {
    const [announcement, setAnnouncement] = useState("");
    /** The id of the field that takes focus once the rows have changed. */
    const focusRef = useRef<string | null>(null);

    useEffect(() => {
        if (focusRef.current !== null) {
            document.getElementById(focusRef.current)?.focus();
            focusRef.current = null;
        }
    }, [rows]);

    /** Apply a change made with a button, then hand focus to `focusId` and say `said`. */
    function change(next: CreditNamesRow[], focusId: string, said: string) {
        if (readOnly) {
            return;
        }
        focusRef.current = focusId;
        setAnnouncement(said);
        onChange(next);
    }

    return (
        <div className="space-y-4">
            {rows.map((row, rowIndex) => (
                <CreditRoleRow
                    key={rowIndex}
                    idPrefix={idPrefix}
                    row={row}
                    rowIndex={rowIndex}
                    roles={roles}
                    readOnly={readOnly}
                    onSet={(nameIndex, value) => {
                        if (!readOnly) {
                            onChange(setCreditName(rows, rowIndex, nameIndex, value));
                        }
                    }}
                    onAdd={() =>
                        change(
                            addCreditName(rows, rowIndex),
                            nameFieldId(idPrefix, rowIndex, row.names.length),
                            `Added a name to ${row.role}.`
                        )
                    }
                    onRemove={(nameIndex) =>
                        change(
                            removeCreditName(rows, rowIndex, nameIndex),
                            nameFieldId(idPrefix, rowIndex, Math.max(0, nameIndex - 1)),
                            `Removed ${nameLabel(row.role, nameIndex)}.`
                        )
                    }
                    onSplit={(nameIndex) => {
                        const next = splitCreditName(rows, rowIndex, nameIndex);
                        const added = next[rowIndex].names.length - row.names.length;
                        change(
                            next,
                            nameFieldId(idPrefix, rowIndex, nameIndex),
                            `Split into ${added + 1} names under ${row.role}.`
                        );
                    }}
                />
            ))}
            <p role="status" className="sr-only">
                {announcement}
            </p>
        </div>
    );
}
