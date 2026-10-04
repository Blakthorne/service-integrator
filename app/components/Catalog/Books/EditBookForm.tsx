"use client";

import { saveBookAction } from "@/app/(app)/catalog/books/actions";
import {
    SettingsFormFooter,
    SettingsTextField,
} from "@/app/components/Settings/SettingsFields";
import { useSettingsForm } from "@/app/components/Settings/useSettingsForm";
import Segmented from "@/app/components/ui/Segmented";
import {
    NOT_IN_USE_EXPLANATION,
    bookEditValues,
    labelFormatHint,
    previewBookLabel,
} from "@/lib/catalog/bookForms";
import { BOOK_NO, BOOK_YES } from "@/lib/catalog/validation";
import type { Book } from "@/lib/domain";
import { fieldErrorOf } from "@/lib/forms";
import LabelPreviewText from "./LabelPreviewText";

interface EditBookFormProps {
    book: Pick<Book, "id" | "code" | "name" | "shortName" | "labelFormat" | "numbered" | "active">;
}

/** The id of the sentence under the in-use choice, which its buttons are described by. */
const IN_USE_HINT_ID = "edit-book-in-use-hint";

/**
 * A book's Edit form: its name, short name, label and whether it is in use.
 * Its code and whether it numbers its songs are fixed (the code is the
 * book's address, and its entries' numbers or positions depend on the
 * other), so they are shown and not edited. The label has a preview as the
 * fields make it, and the in-use choice says what a book that is not in use
 * leaves out.
 *
 * It calls `saveBookAction` from `onSubmit`, with its state in `useState`
 * (`useSettingsForm`). The fields are what was saved, not the page's props:
 * a revalidation after a save must never overwrite what is being typed.
 */
export default function EditBookForm({ book }: EditBookFormProps) {
    const form = useSettingsForm(bookEditValues(book), saveBookAction);
    const { values, setValue } = form;
    const preview = previewBookLabel({
        code: book.code,
        name: values.name,
        shortName: values.shortName,
        labelFormat: values.labelFormat,
        numbered: book.numbered,
    });

    return (
        <form onSubmit={form.onSubmit} noValidate className="space-y-4">
            <input type="hidden" name="bookId" value={values.bookId} />
            <p className="text-sm text-gray-600 dark:text-gray-400">
                Code <strong className="font-semibold text-gray-900 dark:text-gray-100">{book.code}</strong>
                {" · "}
                {book.numbered ? "Numbered" : "Not numbered"}. Neither can change: the code
                is the book&apos;s address, and its entries&apos; numbers or positions depend on
                whether it has numbers.
            </p>
            <SettingsTextField
                id="edit-book-name"
                name="name"
                label="Name"
                value={values.name}
                onChange={(value) => setValue("name", value)}
                error={fieldErrorOf(form.state, "name")}
                autoCapitalize="sentences"
                readOnly={form.pending}
            />
            <SettingsTextField
                id="edit-book-short-name"
                name="shortName"
                label="Short name"
                hint="For tight places, such as the songs list's book filter. Leave blank to use the name."
                value={values.shortName}
                onChange={(value) => setValue("shortName", value)}
                error={fieldErrorOf(form.state, "shortName")}
                autoCapitalize="sentences"
                readOnly={form.pending}
            />
            <SettingsTextField
                id="edit-book-label-format"
                name="labelFormat"
                label="Label"
                hint={labelFormatHint(book.numbered, book.code)}
                value={values.labelFormat}
                onChange={(value) => setValue("labelFormat", value)}
                preview={preview && <LabelPreviewText preview={preview} />}
                error={fieldErrorOf(form.state, "labelFormat")}
                readOnly={form.pending}
            />
            <div className="space-y-1">
                <p className="block mb-1 text-sm font-medium text-gray-700 dark:text-gray-300">
                    In use
                </p>
                <p id={IN_USE_HINT_ID} className="text-sm text-gray-600 dark:text-gray-400">
                    {NOT_IN_USE_EXPLANATION}
                </p>
                <Segmented
                    ariaLabel="Whether the book is in use"
                    value={values.active}
                    options={[
                        { value: BOOK_YES, label: "In use" },
                        { value: BOOK_NO, label: "Not in use" },
                    ]}
                    onChange={(value) => setValue("active", value)}
                    describedBy={IN_USE_HINT_ID}
                />
                <input type="hidden" name="active" value={values.active} />
            </div>
            <SettingsFormFooter form={form} saveLabel="Save book" />
        </form>
    );
}
