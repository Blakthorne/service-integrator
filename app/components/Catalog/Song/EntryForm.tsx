"use client";

import { useEffect, useRef, useState } from "react";
import {
    addEntryAction,
    editEntryAction,
    type EntryFormState,
} from "@/app/(app)/catalog/songs/[songId]/editActions";
import Segmented, { type SegmentedOption } from "@/app/components/ui/Segmented";
import { buttonClasses } from "@/app/components/ui/buttonClasses";
import {
    editEntryValues,
    entryFormLabel,
    newEntryValues,
    type EntryEditorBook,
    type EntryFormValues,
} from "@/lib/catalog/entryEditor";
import {
    ENTRY_POSITION_MAX,
    LOCATION_MAX_LENGTH,
    VARIANT_NOTE_MAX_LENGTH,
} from "@/lib/catalog/validation";
import type { LabelledEntry } from "@/lib/domain";
import { fieldErrorOf } from "@/lib/forms";
import { HINT_CLASS, LABEL_CLASS } from "../SongForm/Fields";
import { EditTextField, FieldErrorText, FormAlert, PendingSubmit } from "./EditFields";
import { useEditForm } from "./useEditForm";

const PLACEMENT_OPTIONS: readonly SegmentedOption<"number" | "location">[] = [
    { value: "number", label: "Number" },
    { value: "location", label: "Location", title: "A place without a number, such as the front cover" },
];

const VARIANT_HINT =
    "Optional, such as Descant - last stanza only. A song is in a book once without one; a descant or round with a number of its own has one.";

type EntryFormProps = {
    /** The prefix of the controls' ids, unique on the page. */
    idPrefix: string;
    songId: number;
    /** Called with each successful response, and the book it was about. */
    onDone: (state: Extract<EntryFormState, { status: "success" }>, book: EntryEditorBook) => void;
} & (
    | {
          mode: "add";
          /** The books the song can be added to: those in use, in book order. */
          books: readonly EntryEditorBook[];
      }
    | {
          mode: "edit";
          entry: LabelledEntry;
          /** The entry's book. */
          book: EntryEditorBook;
          onCancel: () => void;
      }
);

/**
 * An entry's form, to add the song to a book or to change one of its
 * entries. In a numbered book it takes a number, or a location such as the
 * front cover; in a book without numbers an added entry goes at the end, and
 * an entry's form can give it another position (the entries between move
 * one). Both take a variant note. Under the fields, the label the entry
 * will have.
 *
 * Its action is called from `onSubmit` (`useEditForm`). A refusal marks its
 * field, with a link to what it clashes with: the song that has a number,
 * or the song's entry with the same variant note. The modes and the book
 * are chosen with buttons and posted in hidden fields, as the new-song form
 * does. The Edit form takes focus when it opens, since the row it replaces
 * had it.
 */
export default function EntryForm(props: EntryFormProps) {
    const { idPrefix, songId, onDone } = props;
    const addBooks = props.mode === "add" ? props.books : [];
    const [bookId, setBookId] = useState<number | null>(
        props.mode === "add" ? (props.books[0]?.id ?? null) : props.book.id
    );
    const book = props.mode === "add" ? addBooks.find(({ id }) => id === bookId) : props.book;
    const [values, setValues] = useState<EntryFormValues>(() =>
        props.mode === "add"
            ? newEntryValues(props.books[0] ?? { numbered: true })
            : editEntryValues(props.entry, props.book)
    );
    const firstFieldRef = useRef<HTMLInputElement>(null);
    const form = useEditForm(props.mode === "add" ? addEntryAction : editEntryAction, (state) => {
        if (state.status === "success" && book) {
            if (props.mode === "add") {
                setValues((current) => ({ ...newEntryValues(book), placement: current.placement }));
            }
            onDone(state, book);
        }
    });

    const editing = props.mode === "edit";
    useEffect(() => {
        if (editing) {
            firstFieldRef.current?.focus();
        }
    }, [editing]);

    if (book === undefined) {
        return null;
    }

    function change(changes: Partial<EntryFormValues>) {
        if (!form.pending) {
            setValues((current) => ({ ...current, ...changes }));
        }
    }

    function chooseBook(id: string) {
        const next = addBooks.find((option) => String(option.id) === id);
        if (next && !form.pending) {
            setBookId(next.id);
            setValues((current) => ({ ...current, placement: newEntryValues(next).placement }));
        }
    }

    const placementError = fieldErrorOf(form.state, "placement");
    const bookError = fieldErrorOf(form.state, "book");
    const label = entryFormLabel(book, values);
    const placement = values.placement === "location" ? "location" : "number";
    // The placement's error is under the number or location field, and describes the mode buttons too.
    const placementErrorId = placementError ? `${idPrefix}-${placement}-error` : undefined;

    return (
        <form onSubmit={form.onSubmit} className="space-y-4">
            <input type="hidden" name="songId" value={songId} />
            {props.mode === "add" ? (
                <input type="hidden" name="bookId" value={book.id} />
            ) : (
                <input type="hidden" name="entryId" value={props.entry.id} />
            )}
            <input type="hidden" name="placement" value={values.placement} />
            {props.mode === "add" && (
                <div className="space-y-1">
                    <span className={LABEL_CLASS}>Book</span>
                    <div>
                        <Segmented
                            value={String(book.id)}
                            options={addBooks.map(({ id, name, shortName }) => ({
                                value: String(id),
                                label: shortName,
                                title: name,
                            }))}
                            onChange={chooseBook}
                            ariaLabel="Book"
                            describedBy={bookError ? `${idPrefix}-book-error` : undefined}
                        />
                    </div>
                    <FieldErrorText id={`${idPrefix}-book-error`} error={bookError} />
                </div>
            )}
            {book.numbered ? (
                <>
                    <div>
                        <Segmented
                            value={placement}
                            options={PLACEMENT_OPTIONS}
                            onChange={(next) => change({ placement: next })}
                            ariaLabel={`Where ${book.name} has the song`}
                            describedBy={placementErrorId}
                        />
                    </div>
                    {placement === "number" ? (
                        <EditTextField
                            id={`${idPrefix}-number`}
                            name="number"
                            label={`Number in ${book.name}`}
                            value={values.number}
                            onChange={(number) => change({ number })}
                            error={placementError}
                            readOnly={form.pending}
                            inputMode="numeric"
                            inputRef={firstFieldRef}
                        />
                    ) : (
                        <EditTextField
                            id={`${idPrefix}-location`}
                            name="location"
                            label={`Location in ${book.name}`}
                            value={values.location}
                            onChange={(location) => change({ location })}
                            error={placementError}
                            readOnly={form.pending}
                            placeholder="front cover"
                            maxLength={LOCATION_MAX_LENGTH}
                            inputRef={firstFieldRef}
                        />
                    )}
                </>
            ) : props.mode === "edit" ? (
                <EditTextField
                    id={`${idPrefix}-position`}
                    name="position"
                    label={`Position in ${book.name}`}
                    hint={`1 is first; the entries between move one. Up to ${book.entryCount}.`}
                    value={values.position}
                    onChange={(position) => change({ position })}
                    error={placementError}
                    readOnly={form.pending}
                    inputMode="numeric"
                    maxLength={String(ENTRY_POSITION_MAX).length}
                    inputRef={firstFieldRef}
                />
            ) : (
                <>
                    <p className={HINT_CLASS}>
                        {book.name} has no numbers: the song goes at its end, as position {book.entryCount + 1}. Move
                        it up afterwards.
                    </p>
                    <FieldErrorText id={`${idPrefix}-placement-error`} error={placementError} />
                </>
            )}
            <EditTextField
                id={`${idPrefix}-variant`}
                name="variantNote"
                label="Variant note"
                hint={VARIANT_HINT}
                value={values.variantNote}
                onChange={(variantNote) => change({ variantNote })}
                error={fieldErrorOf(form.state, "variantNote")}
                readOnly={form.pending}
                maxLength={VARIANT_NOTE_MAX_LENGTH}
            />
            {label && book.numbered && (
                <p className={HINT_CLASS}>
                    Its label will be{" "}
                    <span className="font-semibold tabular-nums text-gray-900 dark:text-gray-100">{label}</span>.
                </p>
            )}
            <FormAlert state={form.state} />
            <div className="flex flex-wrap gap-3">
                <PendingSubmit pending={form.pending} pendingLabel={props.mode === "add" ? "Adding…" : "Saving…"}>
                    {props.mode === "add" ? "Add entry" : "Save entry"}
                </PendingSubmit>
                {props.mode === "edit" && (
                    <button
                        type="button"
                        onClick={() => {
                            if (!form.pending) {
                                props.onCancel();
                            }
                        }}
                        className={buttonClasses("secondary", form.pending)}
                        aria-disabled={form.pending}
                    >
                        Cancel
                    </button>
                )}
            </div>
        </form>
    );
}
