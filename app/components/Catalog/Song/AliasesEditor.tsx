"use client";

import { useEffect, useRef, useState } from "react";
import { buttonClasses } from "@/app/components/ui/buttonClasses";
import { fieldErrorOf, type FormState } from "@/lib/forms";
import { NoValue } from "../CatalogCard";
import { EditTextField, FormAlert, PendingSubmit, StatusLine } from "./EditFields";
import { useEditForm } from "./useEditForm";

/** The words of each kind's other names. */
const WORDS = {
    hymn: { heading: "Other titles", one: "other title", add: "Add another title", button: "Add title" },
    tune: { heading: "Other names", one: "other name", add: "Add another name", button: "Add name" },
} as const;

interface AliasesEditorProps {
    kind: "hymn" | "tune";
    /** The prefix of the controls' ids, unique on the page. */
    idPrefix: string;
    /** The hidden field that names the hymn or tune ("hymnId", "tuneId"), and its id. */
    idField: { name: string; value: number };
    /** Its other names, as the page has them. */
    aliases: readonly string[];
    /** The longest name the field takes. */
    maxLength: number;
    addAlias: (formData: FormData) => Promise<FormState>;
    removeAlias: (formData: FormData) => Promise<FormState>;
}

/**
 * A hymn's other titles, or a tune's other names, with Remove beside each
 * and a field to add another. Planning Center songs are matched by them
 * too, so each is unique: one another hymn (or tune) has is refused on the
 * field, with a link to it.
 *
 * Adding empties the field and leaves focus there, for the next. Removing
 * takes the name out of the list once the page has it, and hands focus to
 * the next name's Remove (else the one before, else the field), so focus
 * is never left on a button that has gone. Each says what it did in the
 * status region under the list.
 */
export default function AliasesEditor({
    kind,
    idPrefix,
    idField,
    aliases,
    maxLength,
    addAlias,
    removeAlias,
}: AliasesEditorProps) {
    const words = WORDS[kind];
    const [alias, setAlias] = useState("");
    /** What the last change said, for the status region. */
    const [said, setSaid] = useState("");
    /** The name being removed, while its Remove runs. */
    const [removing, setRemoving] = useState<string | null>(null);
    /** After a Remove: the name that goes, and the one whose Remove takes focus once it has (null: the field). */
    const focusAfter = useRef<{ gone: string; next: string | null } | null>(null);
    const fieldRef = useRef<HTMLInputElement>(null);

    const add = useEditForm(addAlias, (state) => {
        if (state.status === "success") {
            setAlias("");
            setSaid(state.message);
        }
    });
    const remove = useEditForm(removeAlias, (state) => {
        if (state.status === "success") {
            setSaid(state.message);
        } else {
            focusAfter.current = null;
        }
    });

    useEffect(() => {
        const request = focusAfter.current;
        if (request === null || aliases.includes(request.gone)) {
            return;
        }
        focusAfter.current = null;
        const index = request.next === null ? -1 : aliases.indexOf(request.next);
        if (index === -1) {
            fieldRef.current?.focus();
        } else {
            document.getElementById(`${idPrefix}-remove-${index}`)?.focus();
        }
    }, [aliases, idPrefix]);

    function removeOne(name: string, index: number) {
        if (remove.pending || add.pending) {
            return;
        }
        setSaid("");
        setRemoving(name);
        focusAfter.current = { gone: name, next: aliases[index + 1] ?? aliases[index - 1] ?? null };
        const formData = new FormData();
        formData.set(idField.name, String(idField.value));
        formData.set("alias", name);
        void remove.submit(formData).finally(() => setRemoving(null));
    }

    return (
        <div className="space-y-3">
            <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">{words.heading}</h3>
            <FormAlert state={remove.state} />
            {aliases.length === 0 ? (
                <p>
                    <NoValue>None</NoValue>
                </p>
            ) : (
                <ul className="divide-y divide-gray-200 dark:divide-gray-700">
                    {aliases.map((name, index) => (
                        <li key={name} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2">
                            <span className="min-w-0 break-words text-gray-900 dark:text-gray-100">{name}</span>
                            <button
                                id={`${idPrefix}-remove-${index}`}
                                type="button"
                                aria-disabled={remove.pending || add.pending}
                                onClick={() => removeOne(name, index)}
                                className={buttonClasses("secondary", remove.pending || add.pending)}
                            >
                                {removing === name ? "Removing…" : "Remove"}
                                <span className="sr-only">
                                    {" "}
                                    the {words.one} {name}
                                </span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            <form
                onSubmit={(event) => {
                    setSaid("");
                    add.onSubmit(event);
                }}
                className="space-y-3"
            >
                <input type="hidden" name={idField.name} value={idField.value} />
                <EditTextField
                    id={`${idPrefix}-alias`}
                    name="alias"
                    label={words.add}
                    value={alias}
                    onChange={(value) => {
                        if (!add.pending) {
                            setAlias(value);
                        }
                    }}
                    error={fieldErrorOf(add.state, "alias")}
                    readOnly={add.pending}
                    maxLength={maxLength}
                    inputRef={fieldRef}
                />
                <FormAlert state={add.state} />
                <PendingSubmit pending={add.pending} pendingLabel="Adding…" variant="secondary">
                    {words.button}
                </PendingSubmit>
            </form>
            <StatusLine text={add.pending || remove.pending ? "" : said} />
        </div>
    );
}
