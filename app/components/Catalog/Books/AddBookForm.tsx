"use client";

import { addBookAction } from "@/app/(app)/catalog/books/actions";
import {
    SettingsFormFooter,
    SettingsTextField,
} from "@/app/components/Settings/SettingsFields";
import { useSettingsForm } from "@/app/components/Settings/useSettingsForm";
import Segmented from "@/app/components/ui/Segmented";
import { EMPTY_NEW_BOOK, labelFormatHint, previewBookLabel } from "@/lib/catalog/bookForms";
import { BOOK_NO, BOOK_YES } from "@/lib/catalog/validation";
import { fieldErrorOf } from "@/lib/forms";
import LabelPreviewText from "./LabelPreviewText";

/** The id of the sentence under the numbering choice, which its buttons are described by. */
const NUMBERING_HINT_ID = "new-book-numbered-hint";

/**
 * The Add a book form: a code, a name, a short name, whether the book numbers
 * its songs, and the label of its entries, with a preview of that label as
 * the fields make it. The code, the name and the numbering are the ones that
 * must be given; the rest have defaults, which the hints name.
 *
 * It calls `addBookAction` from `onSubmit`, with its state in `useState`, as
 * Settings' forms do (`useSettingsForm`). A refusal shows on its field and
 * above the button, and keeps what was typed; once the book is added the
 * fields are empty again and a status line says what was added, until the
 * next one is typed.
 */
export default function AddBookForm() {
    const form = useSettingsForm({ ...EMPTY_NEW_BOOK }, addBookAction);
    const { values, setValue } = form;
    const numbered = values.numbered === BOOK_YES;
    const preview = previewBookLabel({
        code: values.code,
        name: values.name,
        shortName: values.shortName,
        labelFormat: values.labelFormat,
        numbered,
    });

    return (
        <form onSubmit={form.onSubmit} noValidate className="space-y-4">
            <SettingsTextField
                id="new-book-code"
                name="code"
                label="Code"
                hint="A letter, then up to 7 letters, digits, - or _, such as CB. It is the book's address on this site, and the start of its labels."
                value={values.code}
                onChange={(value) => setValue("code", value)}
                error={fieldErrorOf(form.state, "code")}
                autoCapitalize="none"
                readOnly={form.pending}
            />
            <SettingsTextField
                id="new-book-name"
                name="name"
                label="Name"
                hint="The book's full title, such as Chorus Book."
                value={values.name}
                onChange={(value) => setValue("name", value)}
                error={fieldErrorOf(form.state, "name")}
                autoCapitalize="sentences"
                readOnly={form.pending}
            />
            <SettingsTextField
                id="new-book-short-name"
                name="shortName"
                label="Short name (optional)"
                hint="For tight places, such as the songs list's book filter. Leave blank to use the name."
                value={values.shortName}
                onChange={(value) => setValue("shortName", value)}
                error={fieldErrorOf(form.state, "shortName")}
                autoCapitalize="sentences"
                readOnly={form.pending}
            />
            <div className="space-y-1">
                <p className="block mb-1 text-sm font-medium text-gray-700 dark:text-gray-300">
                    Numbering
                </p>
                <p
                    id={NUMBERING_HINT_ID}
                    className="text-sm text-gray-600 dark:text-gray-400"
                >
                    A numbered book places each song at a number, such as R-396. A book
                    without numbers keeps its songs in a list you can put in order, and
                    labels each one with the book&apos;s name.
                </p>
                <Segmented
                    ariaLabel="Numbering"
                    value={values.numbered}
                    options={[
                        { value: BOOK_YES, label: "Numbered" },
                        { value: BOOK_NO, label: "Not numbered" },
                    ]}
                    onChange={(value) => setValue("numbered", value)}
                    describedBy={NUMBERING_HINT_ID}
                />
                {/* The segmented buttons are not fields: the choice is posted from here. */}
                <input type="hidden" name="numbered" value={values.numbered} />
            </div>
            <SettingsTextField
                id="new-book-label-format"
                name="labelFormat"
                label="Label (optional)"
                hint={labelFormatHint(numbered, values.code)}
                value={values.labelFormat}
                onChange={(value) => setValue("labelFormat", value)}
                preview={preview && <LabelPreviewText preview={preview} />}
                error={fieldErrorOf(form.state, "labelFormat")}
                readOnly={form.pending}
            />
            <SettingsFormFooter form={form} saveLabel="Add book" />
        </form>
    );
}
