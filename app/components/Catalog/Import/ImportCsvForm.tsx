"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { previewBookCsvAction } from "@/app/(app)/catalog/import/actions";
import { buttonClasses } from "@/app/components/ui/buttonClasses";
import {
    CSV_COULD_NOT_SEND_MESSAGE,
    CSV_FILE_RULES,
    CSV_FIX_FIELDS_MESSAGE,
    describeBookColumns,
    describeBookOption,
} from "@/lib/catalog/importText";
import { validateBookCsvUpload, type BookCsvPart } from "@/lib/catalog/validation";
import {
    IDLE_FORM,
    fieldErrorOf,
    formError,
    formStateKey,
    type FormState,
} from "@/lib/forms";
import { routes } from "@/lib/routes";
import { ALERT_CLASS, TEXT_LINK_CLASS } from "../Books/styles";
import { FieldErrorText, HINT_CLASS, INPUT_CLASS, LABEL_CLASS } from "../SongForm/Fields";

/** A book as the form's list offers it. */
export interface ImportBookOption {
    id: number;
    name: string;
    code: string;
    numbered: boolean;
    active: boolean;
}

interface ImportCsvFormProps {
    /** Every book, in book order. */
    books: ImportBookOption[];
}

/**
 * The look of the file field. The browser draws the field and its "Choose
 * file" button; the classes dress the button like the app's quieter ones.
 */
const FILE_INPUT_CLASS =
    "block w-full rounded-md text-sm text-gray-900 dark:text-gray-100 file:mr-4 file:cursor-pointer file:rounded-md file:border file:border-gray-300 file:bg-white file:px-4 file:py-2 file:text-sm file:font-medium file:text-gray-700 hover:file:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:file:border-gray-600 dark:file:bg-gray-700 dark:file:text-gray-300 dark:hover:file:bg-gray-600 aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-red-500";

/** The ids of the form's hints and errors, which its fields are described by. */
const BOOK_HINT_ID = "csv-book-hint";
const BOOK_ERROR_ID = "csv-book-error";
const FILE_HINT_ID = "csv-file-hint";
const FILE_ERROR_ID = "csv-file-error";

/** The ids a field is described by: its hint, and its error when it has one. */
function describedBy(hintId: string, errorId: string, hasError: boolean): string {
    return hasError ? `${hintId} ${errorId}` : hintId;
}

/**
 * The Import a book from CSV form: the book the rows go into (a book of the
 * catalog, which the form lists) and the file. Choosing a book says which
 * columns its file needs. Preview checks the file against the catalog and goes
 * to the run's page, which lists what is wrong with it.
 *
 * It checks the fields in the browser first (`validateBookCsvUpload`, the
 * reader the action uses): a file over 1 MB is refused before it is sent.
 * Then it calls `previewBookCsvAction` from `onSubmit`, with its state and
 * pending flag in `useState`, as Settings' forms do (convention 15), and goes
 * to the run itself. The form is not reset by a refusal, so what was chosen
 * stays.
 *
 * A refusal shows on its field and as an alert above the button, keyed per
 * attempt (`formStateKey`) so the same words twice are announced twice; the
 * status region is always rendered, empty until a preview is under way.
 */
export default function ImportCsvForm({ books }: ImportCsvFormProps) {
    const router = useRouter();
    const [bookId, setBookId] = useState("");
    const [state, setState] = useState<FormState<BookCsvPart>>(IDLE_FORM);
    const [pending, setPending] = useState(false);
    // Read by the handler, which may run again before a render shows `pending`.
    const sending = useRef(false);

    const chosen = books.find(({ id }) => String(id) === bookId);
    const bookError = fieldErrorOf(state, "book");
    const fileError = fieldErrorOf(state, "file");

    async function send(formData: FormData): Promise<void> {
        sending.current = true;
        setPending(true);
        setState(IDLE_FORM);
        let previewed = false;
        try {
            const next = await previewBookCsvAction(formData);
            if (next.status === "previewed") {
                // Stay pending: the page is on its way out.
                previewed = true;
                router.push(routes.catalogImportRun(next.runId));
            } else {
                setState(next);
            }
        } catch (error) {
            console.error("Previewing the CSV file failed:", error);
            setState(formError(CSV_COULD_NOT_SEND_MESSAGE));
        } finally {
            if (!previewed) {
                sending.current = false;
                setPending(false);
            }
        }
    }

    function handleSubmit(event: FormEvent<HTMLFormElement>) {
        // The browser's own submit would load a page.
        event.preventDefault();
        if (sending.current) {
            return;
        }
        // Read before anything is awaited: the event is gone after.
        const formData = new FormData(event.currentTarget);
        const checked = validateBookCsvUpload(formData);
        if (!checked.ok) {
            setState(formError(CSV_FIX_FIELDS_MESSAGE, { fieldErrors: checked.fieldErrors }));
            return;
        }
        void send(formData);
    }

    return (
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
            <div>
                <label htmlFor="csv-book" className={LABEL_CLASS}>
                    Book
                </label>
                <p id={BOOK_HINT_ID} className={`mb-1 ${HINT_CLASS}`}>
                    The book the rows go into. Not in the list?{" "}
                    <Link href={routes.catalogBookAdd()} className={TEXT_LINK_CLASS}>
                        Add a book first
                    </Link>
                    .
                </p>
                <select
                    id="csv-book"
                    name="bookId"
                    value={bookId}
                    onChange={(event) => setBookId(event.target.value)}
                    aria-describedby={describedBy(BOOK_HINT_ID, BOOK_ERROR_ID, bookError !== undefined)}
                    aria-invalid={bookError ? true : undefined}
                    className={INPUT_CLASS}
                >
                    <option value="">Choose a book&hellip;</option>
                    {books.map((book) => (
                        <option key={book.id} value={book.id}>
                            {describeBookOption(book)}
                        </option>
                    ))}
                </select>
                <FieldErrorText id={BOOK_ERROR_ID} error={bookError} />
            </div>
            <div>
                <label htmlFor="csv-file" className={LABEL_CLASS}>
                    CSV file
                </label>
                <p id={FILE_HINT_ID} className={`mb-1 ${HINT_CLASS}`}>
                    {chosen ? `${describeBookColumns(chosen)} ` : ""}
                    At most 1 MB.
                </p>
                <input
                    id="csv-file"
                    name="file"
                    type="file"
                    accept=".csv,text/csv"
                    aria-describedby={describedBy(FILE_HINT_ID, FILE_ERROR_ID, fileError !== undefined)}
                    aria-invalid={fileError ? true : undefined}
                    className={FILE_INPUT_CLASS}
                />
                <FieldErrorText id={FILE_ERROR_ID} error={fileError} />
            </div>
            <p className={HINT_CLASS}>{CSV_FILE_RULES}</p>
            {state.status === "error" && (
                <p key={formStateKey(state)} role="alert" className={ALERT_CLASS}>
                    {state.message}
                </p>
            )}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <button
                    type="submit"
                    aria-disabled={pending}
                    onClick={(event) => {
                        // Stops the form submitting again; Enter in a field submits through this click too.
                        if (pending) {
                            event.preventDefault();
                        }
                    }}
                    className={buttonClasses("primary", pending)}
                >
                    {pending ? "Reading the file…" : "Preview import"}
                </button>
                {/* Always rendered, so a screen reader announces what appears in it. */}
                <p role="status" className="text-sm text-gray-600 dark:text-gray-300">
                    {pending ? "Reading the file and checking it against the catalog…" : ""}
                </p>
            </div>
        </form>
    );
}
