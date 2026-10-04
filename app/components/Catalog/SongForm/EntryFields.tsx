"use client";

import Segmented, { type SegmentedOption } from "@/app/components/ui/Segmented";
import {
    LOCATION_MAX_LENGTH,
    previewEntryLabel,
    type NewSongValues,
    type Placement,
} from "@/lib/catalog/validation";
import type { FieldError } from "@/lib/forms";
import type { NewSongFormBook } from "@/lib/queries/catalogEdit";
import { FieldErrorText, FormPart, HINT_CLASS, TextField } from "./Fields";

/** The book choice for no entry: never a book's id, which is a number. */
const NO_BOOK = "";

const PLACEMENT_OPTIONS: readonly SegmentedOption<Placement>[] = [
    { value: "number", label: "Number" },
    { value: "location", label: "Location", title: "A place without a number, such as the front cover" },
];

interface EntryFieldsProps {
    /** The active books, in book order. */
    books: readonly NewSongFormBook[];
    values: Pick<NewSongValues, "bookId" | "placement" | "number" | "location">;
    onChange: (changes: Partial<NewSongValues>) => void;
    error: FieldError | undefined;
}

/**
 * The song's first entry, if it has one: a book, then, in a numbered book,
 * its number or a location such as the front cover. A book without numbers
 * takes the song at its end. Under the fields, the label the entry will
 * have.
 */
export default function EntryFields({ books, values, onChange, error }: EntryFieldsProps) {
    const errorId = error ? "entry-error" : undefined;
    const book = books.find(({ id }) => String(id) === values.bookId);
    const placement: Placement = values.placement === "location" ? "location" : "number";
    const bookOptions: SegmentedOption<string>[] = [
        { value: NO_BOOK, label: "No book" },
        ...books.map(({ id, name, shortName }) => ({
            value: String(id),
            label: shortName,
            title: name,
        })),
    ];
    const label = book ? previewEntryLabel(book, { ...values, placement }) : null;

    return (
        <FormPart
            legend="First entry"
            description="Optional: where a book has the song, by number or by place."
            errorId={errorId}
        >
            <input type="hidden" name="bookId" value={book ? String(book.id) : NO_BOOK} />
            <div>
                <Segmented
                    value={book ? String(book.id) : NO_BOOK}
                    options={bookOptions}
                    onChange={(bookId) => onChange({ bookId })}
                    ariaLabel="Book"
                />
            </div>
            {book?.numbered && (
                <>
                    <input type="hidden" name="placement" value={placement} />
                    <div>
                        <Segmented
                            value={placement}
                            options={PLACEMENT_OPTIONS}
                            onChange={(next) => onChange({ placement: next })}
                            ariaLabel={`Where ${book.name} has the song`}
                        />
                    </div>
                    {placement === "number" ? (
                        <TextField
                            id="entry-number"
                            name="number"
                            label={`Number in ${book.name}`}
                            value={values.number}
                            onChange={(number) => onChange({ number })}
                            errorId={errorId}
                            inputMode="numeric"
                        />
                    ) : (
                        <TextField
                            id="entry-location"
                            name="location"
                            label={`Location in ${book.name}`}
                            value={values.location}
                            onChange={(location) => onChange({ location })}
                            errorId={errorId}
                            placeholder="front cover"
                            maxLength={LOCATION_MAX_LENGTH}
                        />
                    )}
                    {label && (
                        <p className={HINT_CLASS}>
                            Its label will be{" "}
                            <span className="font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                                {label}
                            </span>
                            .
                        </p>
                    )}
                </>
            )}
            {book && !book.numbered && (
                <p className={HINT_CLASS}>
                    {book.name} has no numbers: the song goes at its end, labelled{" "}
                    <span className="font-semibold text-gray-900 dark:text-gray-100">
                        {label}
                    </span>
                    .
                </p>
            )}
            {errorId && <FieldErrorText id={errorId} error={error} />}
        </FormPart>
    );
}
