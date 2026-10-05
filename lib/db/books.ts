import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { parseBookCode } from "@/lib/catalog/ids";
import {
    defaultLabelFormat,
    labelFormatProblem,
    type BookEditInput,
    type BookPart,
    type MoveDirection,
    type NewBookInput,
} from "@/lib/catalog/validation";
import type { EditProblem, EditResult } from "./catalogEdit";
import { withTransaction } from "./transaction";

/**
 * The catalog's books from the books page: add one, numbered or not, edit
 * its names, label and whether it is in use, and move it up or down the
 * order books are listed in (and a song's entries are ordered by). A book's
 * code and whether it numbers its songs never change: the code is its
 * address, and its entries' numbers or positions depend on the other. Each
 * edit is one transaction, and a refusal is a value, as in
 * lib/db/catalogEdit.ts.
 */

/** Why a book edit was refused. */
export type BookProblemReason =
    /** The book is not in the catalog. */
    | "book-not-found"
    /** The code is not one `parseBookCode` accepts. */
    | "code-invalid"
    /** Another book has the code, in any case. */
    | "code-taken"
    /** The label format does not suit the book (see `labelFormatProblem`). */
    | "label-format";

export type BookProblem = EditProblem<BookProblemReason, BookPart>;

/** What adding or editing a book did: its id and code. */
export type BookEditResult = EditResult<{ bookId: number; code: string }, BookProblemReason, BookPart>;

/** What moving a book did: its place in the order now (1 is first); `changed` is false when it was already first (or last). */
export type BookMoveResult = EditResult<
    { changed: boolean; sortOrder: number },
    BookProblemReason,
    BookPart
>;

const BOOK_NOT_FOUND: BookProblem = {
    reason: "book-not-found",
    part: "book",
    message: "That book is not in the catalog.",
    existing: null,
};

/** The ids of every book in the order they are listed. */
function bookOrder(db: DatabaseSync): number[] {
    return db
        .prepare("SELECT id FROM books ORDER BY sort_order, code, id")
        .all()
        .map((row) => Number(row.id));
}

/** Give the books the sort orders 1, 2, 3, … in the order of `ids`. */
function writeBookOrder(db: DatabaseSync, ids: readonly number[]): void {
    const update = db.prepare("UPDATE books SET sort_order = ? WHERE id = ?");
    ids.forEach((id, index) => update.run(index + 1, id));
}

/**
 * Add a book, last in the order and in use, in one transaction, with its
 * code as given (`parseBookCode` checks it here too, and the database's
 * CHECK after that), its name, short name, whether it numbers its songs
 * and its label format. Refused, writing nothing, for a code that is not
 * one, a code another book has in any case ("cb" when there is a "CB"),
 * or a label format that does not suit the book.
 */
export function addBook(db: DatabaseSync, input: NewBookInput): BookEditResult {
    return withTransaction(db, (): BookEditResult => {
        const problems: BookProblem[] = [];
        const code = parseBookCode(input.code);
        if (code === null) {
            problems.push({
                reason: "code-invalid",
                part: "code",
                message: "A code is a letter, then up to 7 letters, digits, - or _, such as CB.",
                existing: null,
            });
        } else {
            // The column compares without regard to case (COLLATE NOCASE).
            const holder = db.prepare("SELECT code, name FROM books WHERE code = ?").get(code);
            if (holder) {
                problems.push({
                    reason: "code-taken",
                    part: "code",
                    message: `The code ${String(holder.code)} is taken by ${String(holder.name)}. Choose another.`,
                    existing: { kind: "book", code: String(holder.code), label: String(holder.name) },
                });
            }
        }
        const labelProblem = labelFormatProblem(input.labelFormat, input.numbered);
        if (labelProblem !== null) {
            problems.push({ reason: "label-format", part: "labelFormat", message: labelProblem, existing: null });
        }
        if (problems.length > 0 || code === null) {
            return { ok: false, problems };
        }
        const sortOrder = Number(
            db.prepare("SELECT coalesce(max(sort_order), 0) + 1 AS next FROM books").get()?.next
        );
        const bookId = Number(
            db
                .prepare(
                    "INSERT INTO books (code, name, short_name, numbered, label_format, sort_order, active) VALUES (?, ?, ?, ?, ?, ?, 1)"
                )
                .run(code, input.name, input.shortName, input.numbered ? 1 : 0, input.labelFormat, sortOrder)
                .lastInsertRowid
        );
        return { ok: true, bookId, code };
    });
}

/**
 * Change book `bookId`'s name, short name (its name when null), label
 * format (its default when null: `CODE-{n}` for a numbered book, its short
 * name for one without numbers) and whether it is in use, in one
 * transaction. A book that is not in use stays in the catalog, browsable,
 * but its entries are left out of the schedule text, the hymnal notes and
 * the songs list's book filter. Refused, writing nothing, when there is no
 * such book or the label format does not suit it.
 */
export function editBook(db: DatabaseSync, input: BookEditInput): BookEditResult {
    return withTransaction(db, (): BookEditResult => {
        const row = db.prepare("SELECT code, numbered FROM books WHERE id = ?").get(input.bookId);
        if (!row) {
            return { ok: false, problems: [BOOK_NOT_FOUND] };
        }
        const code = String(row.code);
        const numbered = row.numbered === 1;
        const shortName = input.shortName ?? input.name;
        const labelFormat = input.labelFormat ?? defaultLabelFormat(code, numbered, shortName);
        const labelProblem = labelFormatProblem(labelFormat, numbered);
        if (labelProblem !== null) {
            return {
                ok: false,
                problems: [{ reason: "label-format", part: "labelFormat", message: labelProblem, existing: null }],
            };
        }
        db.prepare(
            "UPDATE books SET name = ?, short_name = ?, label_format = ?, active = ? WHERE id = ?"
        ).run(input.name, shortName, labelFormat, input.active ? 1 : 0, input.bookId);
        return { ok: true, bookId: input.bookId, code };
    });
}

/**
 * Move book `bookId` one place up (earlier) or down the order, swapping it
 * with its neighbour, in one transaction; the books' sort orders become 1,
 * 2, 3, …. The first book moved up, or the last moved down, stays
 * (`changed` false). Refused when there is no such book.
 */
export function moveBook(db: DatabaseSync, bookId: number, direction: MoveDirection): BookMoveResult {
    return withTransaction(db, (): BookMoveResult => {
        const ids = bookOrder(db);
        const index = ids.indexOf(bookId);
        if (index === -1) {
            return { ok: false, problems: [BOOK_NOT_FOUND] };
        }
        const target = direction === "up" ? index - 1 : index + 1;
        const changed = target >= 0 && target < ids.length;
        if (changed) {
            [ids[index], ids[target]] = [ids[target], ids[index]];
            writeBookOrder(db, ids);
        }
        return { ok: true, changed, sortOrder: ids.indexOf(bookId) + 1 };
    });
}
