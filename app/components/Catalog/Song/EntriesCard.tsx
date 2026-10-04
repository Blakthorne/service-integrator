"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
    deleteEntryAction,
    moveEntryAction,
    type EntryDeleteState,
    type EntryMoveState,
} from "@/app/(app)/catalog/songs/[songId]/editActions";
import Dialog from "@/app/components/ui/Dialog";
import { buttonClasses } from "@/app/components/ui/buttonClasses";
import {
    deleteEntryQuestion,
    describeEntryAdded,
    describeEntryDeleted,
    describeEntryMove,
    describeEntryPosition,
    describeEntrySaved,
    entryAfterRemoval,
    entryMoves,
    type EntryEditorBook,
} from "@/lib/catalog/entryEditor";
import { entryNotes } from "@/lib/catalog/entryNotes";
import type { MoveDirection } from "@/lib/catalog/validation";
import type { LabelledEntry } from "@/lib/domain";
import { routes } from "@/lib/routes";
import CatalogCard, { LINK_CLASS, NoValue } from "../CatalogCard";
import { HINT_CLASS } from "../SongForm/Fields";
import EditToggle from "./EditToggle";
import { FormAlert, StatusLine, TEXT_LINK_CLASS } from "./EditFields";
import EntryForm from "./EntryForm";
import { useEditForm } from "./useEditForm";

interface EntriesCardProps {
    songId: number;
    /** The song's entries, in book order. */
    entries: readonly LabelledEntry[];
    /** Every book, in use or not, in book order: an entry's book's name, numbering and size. */
    books: readonly EntryEditorBook[];
}

/** The look of an entry's label, the line's first and largest text. */
const LABEL_CLASS = "min-w-20 text-lg font-semibold tabular-nums";

/** The id of the card's body, which the Edit button shows and hides the editor in. */
const BODY_ID = "entries-card-body";

/** The id of the card's status region, which takes focus when no entry is left to take it. */
const STATUS_ID = "entries-status";

/** Where focus goes once the page shows a change: an element, after an entry has gone if one is named. */
interface FocusRequest {
    elementId: string;
    /** The entry that must be gone from the page first (one just deleted). */
    afterGone?: number;
}

/** The DOM id of an entry's button. */
function buttonId(entryId: number, which: "edit" | "delete" | MoveDirection): string {
    return `entry-${entryId}-${which}`;
}

/** An entry's label, its book (a link to the book's page) and its notes, as the card shows it. */
function EntryLine({ entry, book }: { entry: LabelledEntry; book: EntryEditorBook | undefined }) {
    const bookName = book?.name ?? entry.bookCode;
    // Default prefetch: a book's page reads only the local database.
    const bookHref = routes.catalogBook(entry.bookCode);
    const notes = entryNotes(book ?? { numbered: true }, entry);
    const position = book ? describeEntryPosition(entry, book) : null;
    return (
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            {entry.label === bookName ? (
                <Link href={bookHref} className={`${LABEL_CLASS} ${LINK_CLASS}`}>
                    {entry.label}
                </Link>
            ) : (
                <>
                    <span className={`${LABEL_CLASS} text-gray-900 dark:text-gray-100`}>{entry.label}</span>
                    <Link href={bookHref} className={LINK_CLASS}>
                        {bookName}
                    </Link>
                </>
            )}
            {(notes.length > 0 || position !== null) && (
                <span className="text-sm text-gray-600 dark:text-gray-400">
                    {[...notes, ...(position === null ? [] : [position])].join(" · ")}
                </span>
            )}
            {book && !book.active && (
                <span className="text-sm text-amber-700 dark:text-amber-300">(book not in use)</span>
            )}
        </div>
    );
}

/**
 * Where a song is in the books: for each entry, its label ("R-396"), its
 * book (a link to the book's page) and any variant or location note. When
 * the label is the book's name, as an unnumbered book's can be ("Chorus
 * Book"), the label is the link, rather than the name twice.
 *
 * Edit turns the card into the entries' editor: each entry gets Edit (its
 * number or location, its position in a book without numbers, and its
 * variant note), Delete (confirmed in a dialog) and, in a book without
 * numbers, Move up and Move down; under them, Add entry, for a book in use.
 * Every action is called from a click or `onSubmit` with its state in
 * `useState` (convention 15), and says what it did in the card's status
 * region. Focus follows: an entry's form takes it when it opens and gives
 * it back to the entry's Edit; a deleted entry hands it to the next entry's
 * Edit (else the one before, else the status region); a move keeps it on
 * its button; Add keeps it where it was, for the next.
 */
export default function EntriesCard({ songId, entries, books }: EntriesCardProps) {
    const [editing, setEditing] = useState(false);
    /** The entry whose form is open, if any. */
    const [formEntryId, setFormEntryId] = useState<number | null>(null);
    /** The entry the Delete dialog asks about. */
    const [deleting, setDeleting] = useState<LabelledEntry | null>(null);
    const [dialogOpen, setDialogOpen] = useState(false);
    /** What the last change said, for the status region. */
    const [said, setSaid] = useState("");
    const focusRequest = useRef<FocusRequest | null>(null);
    const deleteButtonRef = useRef<HTMLButtonElement | null>(null);
    const bookById = new Map(books.map((book) => [book.id, book]));
    const activeBooks = books.filter(({ active }) => active);

    const remove = useEditForm<EntryDeleteState>(deleteEntryAction, (state) => {
        if (state.status === "success" && deleting) {
            const book = bookById.get(deleting.bookId);
            setSaid(book ? describeEntryDeleted(state.label, book) : state.message);
            const next = entryAfterRemoval(
                entries.map(({ id }) => id),
                deleting.id
            );
            focusRequest.current = {
                elementId: next === null ? STATUS_ID : buttonId(next, "edit"),
                afterGone: deleting.id,
            };
            deleteButtonRef.current = null;
            setDialogOpen(false);
        }
    });

    /** The entry the last Move was for, and its book, to word the response and hand focus back. */
    const [moved, setMoved] = useState<{ entryId: number; direction: MoveDirection; book: EntryEditorBook } | null>(
        null
    );
    /** The button of the Move under way, read when its response comes (state would be a render behind). */
    const movingButton = useRef<string | null>(null);
    const move = useEditForm<EntryMoveState>(moveEntryAction, (state) => {
        if (state.status === "success" && movingButton.current !== null) {
            // A move can reorder the song's entries in one book: keep focus on the button.
            focusRequest.current = { elementId: movingButton.current };
        }
    });

    // Applies a focus request once the page shows the change it waits for.
    useEffect(() => {
        const request = focusRequest.current;
        if (request === null) {
            return;
        }
        if (request.afterGone !== undefined && entries.some(({ id }) => id === request.afterGone)) {
            return;
        }
        focusRequest.current = null;
        document.getElementById(request.elementId)?.focus();
    });

    function moveEntry(entry: LabelledEntry, direction: MoveDirection) {
        const book = bookById.get(entry.bookId);
        if (move.pending || !book) {
            return;
        }
        setSaid("");
        setMoved({ entryId: entry.id, direction, book });
        movingButton.current = buttonId(entry.id, direction);
        const formData = new FormData();
        formData.set("entryId", String(entry.id));
        formData.set("direction", direction);
        void move.submit(formData);
    }

    const moveSaid =
        move.state.status === "success" && moved !== null
            ? describeEntryMove(moved.direction, move.state, moved.book)
            : "";
    const status = remove.pending || move.pending ? "" : moveSaid || said;

    function toggle() {
        setEditing((current) => !current);
        setFormEntryId(null);
        setSaid("");
        move.reset();
    }

    const deleteQuestion = deleting
        ? deleteEntryQuestion(deleting, bookById.get(deleting.bookId) ?? { name: deleting.bookCode, numbered: true })
        : null;

    return (
        <CatalogCard
            title="Books"
            headingId="entries-heading"
            action={<EditToggle editing={editing} onToggle={toggle} what="the entries" controls={BODY_ID} />}
        >
            <div id={BODY_ID} className="space-y-4">
                {editing && <StatusLine id={STATUS_ID} text={status} />}
                {editing && <FormAlert state={move.state} />}
                {entries.length === 0 ? (
                    <p>
                        <NoValue>This song is not in any book.</NoValue>
                    </p>
                ) : (
                    <ul className="-my-2 divide-y divide-gray-200 dark:divide-gray-700">
                        {entries.map((entry) => {
                            const book = bookById.get(entry.bookId);
                            if (!editing) {
                                return (
                                    <li key={entry.id} className="py-2">
                                        <EntryLine entry={entry} book={book} />
                                    </li>
                                );
                            }
                            if (formEntryId === entry.id && book) {
                                return (
                                    <li key={entry.id} className="space-y-3 py-3">
                                        <EntryLine entry={entry} book={book} />
                                        <EntryForm
                                            mode="edit"
                                            idPrefix={`entry-${entry.id}-form`}
                                            songId={songId}
                                            entry={entry}
                                            book={book}
                                            onDone={(state, entryBook) => {
                                                setSaid(describeEntrySaved(state.label, entryBook));
                                                setFormEntryId(null);
                                                focusRequest.current = { elementId: buttonId(entry.id, "edit") };
                                            }}
                                            onCancel={() => {
                                                setFormEntryId(null);
                                                focusRequest.current = { elementId: buttonId(entry.id, "edit") };
                                            }}
                                        />
                                    </li>
                                );
                            }
                            const moves = book ? entryMoves(entry, book) : { up: false, down: false };
                            const unnumbered = book !== undefined && !book.numbered;
                            const name = book?.numbered === false ? `in ${book.name}` : entry.label;
                            return (
                                <li key={entry.id} className="space-y-2 py-3">
                                    <EntryLine entry={entry} book={book} />
                                    <div className="flex flex-wrap gap-2">
                                        {unnumbered &&
                                            (["up", "down"] as const).map((direction) => {
                                                const can = moves[direction];
                                                const busy = move.pending || !can;
                                                return (
                                                    <button
                                                        key={direction}
                                                        id={buttonId(entry.id, direction)}
                                                        type="button"
                                                        aria-disabled={busy}
                                                        onClick={() => {
                                                            if (!busy) {
                                                                moveEntry(entry, direction);
                                                            }
                                                        }}
                                                        className={buttonClasses("secondary", busy)}
                                                    >
                                                        Move {direction}
                                                        <span className="sr-only"> the entry {name}</span>
                                                    </button>
                                                );
                                            })}
                                        <button
                                            id={buttonId(entry.id, "edit")}
                                            type="button"
                                            onClick={() => {
                                                setSaid("");
                                                move.reset();
                                                setFormEntryId(entry.id);
                                            }}
                                            className={buttonClasses("secondary")}
                                        >
                                            Edit<span className="sr-only"> the entry {name}</span>
                                        </button>
                                        <button
                                            id={buttonId(entry.id, "delete")}
                                            type="button"
                                            onClick={(event) => {
                                                deleteButtonRef.current = event.currentTarget;
                                                remove.reset();
                                                setDeleting(entry);
                                                setDialogOpen(true);
                                            }}
                                            className={buttonClasses("secondary")}
                                        >
                                            Delete<span className="sr-only"> the entry {name}</span>
                                        </button>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}
                {editing && (
                    <section aria-labelledby="add-entry-heading" className="space-y-3 border-t border-gray-200 pt-4 dark:border-gray-700">
                        <h3 id="add-entry-heading" className="font-semibold text-gray-900 dark:text-gray-100">
                            Add to a book
                        </h3>
                        {activeBooks.length === 0 ? (
                            <p className={HINT_CLASS}>
                                No book is in use.{" "}
                                <Link href={routes.catalogBooks()} className={TEXT_LINK_CLASS}>
                                    Add a book
                                </Link>{" "}
                                first.
                            </p>
                        ) : (
                            <EntryForm
                                mode="add"
                                idPrefix="add-entry"
                                songId={songId}
                                books={activeBooks}
                                onDone={(state, book) => {
                                    move.reset();
                                    setSaid(describeEntryAdded(state.label, book));
                                }}
                            />
                        )}
                    </section>
                )}
            </div>
            {deleting && deleteQuestion && (
                <Dialog
                    open={dialogOpen}
                    onClose={() => setDialogOpen(false)}
                    title={deleteQuestion.title}
                    description={deleteQuestion.description}
                    returnFocusRef={deleteButtonRef}
                    dismissible={!remove.pending}
                >
                    <form
                        onSubmit={(event) => {
                            setSaid("");
                            move.reset();
                            remove.onSubmit(event);
                        }}
                        className="space-y-4"
                    >
                        <input type="hidden" name="entryId" value={deleting.id} />
                        <FormAlert state={remove.state} />
                        <div className="flex flex-wrap justify-end gap-3">
                            {!remove.pending && (
                                <button
                                    type="button"
                                    onClick={() => setDialogOpen(false)}
                                    className={buttonClasses("secondary")}
                                >
                                    Cancel
                                </button>
                            )}
                            <button
                                type="submit"
                                aria-disabled={remove.pending}
                                onClick={(event) => {
                                    if (remove.pending) {
                                        event.preventDefault();
                                    }
                                }}
                                className={buttonClasses("danger", remove.pending)}
                            >
                                {remove.pending ? "Deleting…" : "Delete"}
                            </button>
                        </div>
                    </form>
                </Dialog>
            )}
        </CatalogCard>
    );
}
