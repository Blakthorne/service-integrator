import "server-only";
import type { DatabaseSync, SQLOutputValue } from "node:sqlite";
import { formatEntryLabel } from "@/lib/catalog/labels";
import type {
    EntryEditInput,
    EntryPart,
    EntryPlacement,
    MoveDirection,
    NewEntryInput,
} from "@/lib/catalog/validation";
import { songLabelOf } from "./catalog";
import type { ExistingRow } from "./catalogWrites";
import { withTransaction } from "./transaction";

/**
 * The catalog's edits from the song, tune and book pages: a song's entries
 * in books, hymns and tunes with their other names. Each edit is one
 * transaction. An edit the catalog's rules refuse (a number taken, a name
 * another hymn has) comes back as a value, with every problem found before
 * anything was written, each naming the part of the form it is about and
 * the row it clashes with; nothing is written then. Anything else, such as
 * a database that cannot be opened, throws.
 */

/** A catalog row a problem is about, for a link to it: a song's page, a tune's or a book's. */
export type CatalogRowRef = ExistingRow | { kind: "book"; code: string; label: string };

/** One reason an edit was refused, with a message fit to show. */
export interface EditProblem<R extends string, P extends string> {
    reason: R;
    /** The part of the form it is about. */
    part: P;
    message: string;
    /** What it clashes with, such as the song that has the number; null when nothing does. */
    existing: CatalogRowRef | null;
}

/** What an edit did: what it reports on success, or every problem it found. */
export type EditResult<T, R extends string, P extends string> =
    | ({ ok: true } & T)
    | { ok: false; problems: EditProblem<R, P>[] };

function problem<R extends string, P extends string>(
    reason: R,
    part: P,
    message: string,
    existing: CatalogRowRef | null = null
): EditProblem<R, P> {
    return { reason, part, message, existing };
}

function refused<R extends string, P extends string>(
    ...problems: EditProblem<R, P>[]
): { ok: false; problems: EditProblem<R, P>[] } {
    return { ok: false, problems };
}

function nullableText(value: SQLOutputValue): string | null {
    return value === null ? null : String(value);
}

function nullableInt(value: SQLOutputValue): number | null {
    return value === null ? null : Number(value);
}

/** The FROM clause that gives a song (`s`) its hymn's title (`h`) and tune's name (`t`). */
const SONG_WITH_NAMES = `songs s
     JOIN hymns h ON h.id = s.hymn_id
     LEFT JOIN tunes t ON t.id = s.tune_id`;

/** A song as a row to link to: its id and label ("Amazing Grace (NEW BRITAIN)"), or null. */
function songRef(db: DatabaseSync, songId: number): Extract<CatalogRowRef, { kind: "song" }> | null {
    const row = db
        .prepare(`SELECT s.id, h.title, t.name AS tune_name FROM ${SONG_WITH_NAMES} WHERE s.id = ?`)
        .get(songId);
    return row
        ? {
              kind: "song",
              songId: Number(row.id),
              label: songLabelOf(String(row.title), nullableText(row.tune_name)),
          }
        : null;
}

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

/** Why an entry edit was refused. */
export type EntryProblemReason =
    /** The song is not in the catalog (any more). */
    | "song-not-found"
    /** The book is not in the catalog. */
    | "book-not-found"
    /** The entry is not in the catalog (any more). */
    | "entry-not-found"
    /** The placement does not suit the book: a number or location in a book without numbers, or the reverse. */
    | "entry-not-placed"
    /** Another entry has the number in that book. */
    | "number-taken"
    /** The song already has an entry in that book with the same variant note (or none). */
    | "song-already-in-book";

export type EntryProblem = EditProblem<EntryProblemReason, EntryPart>;

/** What adding or editing an entry did: the entry's id and its label, such as "R-396". */
export type EntryEditResult = EditResult<{ entryId: number; label: string }, EntryProblemReason, EntryPart>;

/** What deleting an entry did: the song it was of, and the label it had. */
export type EntryDeleteResult = EditResult<{ songId: number; label: string }, EntryProblemReason, EntryPart>;

/** What moving an entry did: its position now; `changed` is false when it was already first (or last). */
export type EntryMoveResult = EditResult<
    { changed: boolean; position: number },
    EntryProblemReason,
    EntryPart
>;

/** A book as the entry edits need it. */
interface EntryBook {
    id: number;
    name: string;
    numbered: boolean;
    labelFormat: string;
}

function findEntryBook(db: DatabaseSync, bookId: number): EntryBook | null {
    const row = db
        .prepare("SELECT id, name, numbered, label_format FROM books WHERE id = ?")
        .get(bookId);
    return row
        ? {
              id: Number(row.id),
              name: String(row.name),
              numbered: row.numbered === 1,
              labelFormat: String(row.label_format),
          }
        : null;
}

/** An entry as the edits need it. */
interface StoredEntry {
    id: number;
    bookId: number;
    songId: number;
    number: number | null;
    position: number | null;
    locationLabel: string | null;
    variantNote: string | null;
}

function toStoredEntry(row: Record<string, SQLOutputValue>): StoredEntry {
    return {
        id: Number(row.id),
        bookId: Number(row.book_id),
        songId: Number(row.song_id),
        number: nullableInt(row.number),
        position: nullableInt(row.position),
        locationLabel: nullableText(row.location_label),
        variantNote: nullableText(row.variant_note),
    };
}

function findStoredEntry(db: DatabaseSync, entryId: number): StoredEntry | null {
    const row = db
        .prepare(
            "SELECT id, book_id, song_id, number, position, location_label, variant_note FROM entries WHERE id = ?"
        )
        .get(entryId);
    return row ? toStoredEntry(row) : null;
}

/** Whether a placement suits a book: numbers and locations in a numbered book, the order in one without. */
function suitsBook(placement: EntryPlacement, book: EntryBook): boolean {
    const numbered = placement.kind === "number" || placement.kind === "location";
    return numbered === book.numbered;
}

function notPlaced(book: EntryBook): EntryProblem {
    return problem(
        "entry-not-placed",
        "placement",
        book.numbered
            ? `${book.name} numbers its songs: give the song's number, or where the book has it.`
            : `${book.name} has no numbers: place the song by its position in the book.`
    );
}

/** An entry's label in its book, such as "R-396" or "G-Front Cover". */
function labelIn(book: EntryBook, entry: Pick<StoredEntry, "number" | "locationLabel">): string {
    return formatEntryLabel(book, entry);
}

/**
 * Where an entry is in its book, for a message: "as R-108" in a numbered
 * book, "at position 3" in one without (whose label is only its name).
 */
function placeIn(book: EntryBook, entry: StoredEntry): string {
    return book.numbered || entry.position === null
        ? `as ${labelIn(book, entry)}`
        : `at position ${entry.position}`;
}

/** The number a placement gives, if any. */
function numberOf(placement: EntryPlacement): number | null {
    return placement.kind === "number" ? placement.number : null;
}

/** The location a placement gives, if any. */
function locationOf(placement: EntryPlacement): string | null {
    return placement.kind === "location" ? placement.locationLabel : null;
}

/**
 * The problems of placing song `songId`'s entry in `book` with
 * `variantNote`, as entry `entryId` (null for a new one): a number another
 * entry has, or another entry of the song in the book with the same variant
 * note (or none: a song is in a book once plainly).
 */
function placementProblems(
    db: DatabaseSync,
    book: EntryBook,
    songId: number,
    placement: EntryPlacement,
    variantNote: string | null,
    entryId: number | null
): EntryProblem[] {
    const problems: EntryProblem[] = [];
    const number = numberOf(placement);
    if (number !== null) {
        const holder = db
            .prepare("SELECT song_id FROM entries WHERE book_id = ? AND number = ? AND id IS NOT ?")
            .get(book.id, number, entryId);
        if (holder) {
            const song = songRef(db, Number(holder.song_id));
            const label = labelIn(book, { number, locationLabel: null });
            problems.push(
                problem("number-taken", "placement", `${label} is taken by "${song?.label}".`, song)
            );
        }
    }
    const twin = db
        .prepare(
            `SELECT id, book_id, song_id, number, position, location_label, variant_note
             FROM entries WHERE book_id = ? AND song_id = ? AND variant_note IS ? AND id IS NOT ?`
        )
        .get(book.id, songId, variantNote, entryId);
    if (twin) {
        const where = placeIn(book, toStoredEntry(twin));
        problems.push(
            problem(
                "song-already-in-book",
                "variantNote",
                variantNote === null
                    ? `This song is already in ${book.name} ${where}. Give this entry a variant note, such as "Descant", to tell the two apart.`
                    : `This song is already in ${book.name} ${where} with the variant note "${variantNote}".`
            )
        );
    }
    return problems;
}

/**
 * The ids of an unnumbered book's entries in its order: by position (an
 * entry with none, which only older rows could have, last), then by id.
 */
function bookOrder(db: DatabaseSync, bookId: number): number[] {
    return db
        .prepare("SELECT id FROM entries WHERE book_id = ? ORDER BY position IS NULL, position, id")
        .all(bookId)
        .map((row) => Number(row.id));
}

/**
 * Give an unnumbered book's entries the positions 1, 2, 3, … in the order
 * of `ids`. Each position is unique in a book (`entries_book_position`), so
 * every entry first takes a negative stand-in (its id, negated: unique, and
 * never a position), then its new position.
 */
function writeOrder(db: DatabaseSync, bookId: number, ids: readonly number[]): void {
    db.prepare("UPDATE entries SET position = -id WHERE book_id = ?").run(bookId);
    const update = db.prepare("UPDATE entries SET position = ? WHERE id = ?");
    ids.forEach((id, index) => update.run(index + 1, id));
}

/**
 * Put entry `entryId` into its unnumbered book's order: at `placement`'s
 * position (1 is first; past the end is the end), or at the end. The order
 * is written afresh, so positions stay 1, 2, 3, ….
 */
function placeInOrder(
    db: DatabaseSync,
    bookId: number,
    entryId: number,
    placement: Extract<EntryPlacement, { kind: "end" | "position" }>
): void {
    const ids = bookOrder(db, bookId).filter((id) => id !== entryId);
    const index =
        placement.kind === "position" ? Math.min(placement.position - 1, ids.length) : ids.length;
    ids.splice(index, 0, entryId);
    writeOrder(db, bookId, ids);
}

/** Insert a row and return its id. */
function insert(db: DatabaseSync, sql: string, ...params: (string | number | null)[]): number {
    return Number(db.prepare(sql).run(...params).lastInsertRowid);
}

/**
 * Add an entry of song `songId` to book `bookId`, in one transaction: at a
 * number or location in a numbered book, or in the order of one without
 * (at the end, or at a position, moving the entries from there on down).
 *
 * Refused, with every problem found and nothing written: no such song or
 * book; a placement the book does not take; a number another entry has in
 * the book; or another entry of the song in the book with the same variant
 * note, or with none (a song is in a book once plainly; a descant or round
 * is a variant entry beside that one).
 */
export function addEntry(db: DatabaseSync, input: NewEntryInput): EntryEditResult {
    return withTransaction(db, (): EntryEditResult => {
        const song = songRef(db, input.songId);
        const book = findEntryBook(db, input.bookId);
        const problems: EntryProblem[] = [];
        if (!song) {
            problems.push(problem("song-not-found", "song", "That song is not in the catalog."));
        }
        if (!book) {
            problems.push(
                problem("book-not-found", "book", "That book is not in the catalog. Choose one from the list.")
            );
        } else if (!suitsBook(input.placement, book)) {
            problems.push(notPlaced(book));
        } else if (song) {
            problems.push(
                ...placementProblems(db, book, input.songId, input.placement, input.variantNote, null)
            );
        }
        if (problems.length > 0 || !book) {
            return refused(...problems);
        }
        const number = numberOf(input.placement);
        const locationLabel = locationOf(input.placement);
        const entryId = insert(
            db,
            "INSERT INTO entries (book_id, song_id, number, position, location_label, variant_note) VALUES (?, ?, ?, NULL, ?, ?)",
            book.id,
            input.songId,
            number,
            locationLabel,
            input.variantNote
        );
        if (input.placement.kind === "end" || input.placement.kind === "position") {
            placeInOrder(db, book.id, entryId, input.placement);
        }
        return { ok: true, entryId, label: labelIn(book, { number, locationLabel }) };
    });
}

/**
 * Change entry `entryId` in place, in one transaction: its number or
 * location (a numbered book), its place in the order (a book without
 * numbers: at the end, or at a position, the entries between moving up or
 * down one), and its variant note. Its book and song stay as they are: to
 * move a song to another book, add the entry there and delete this one.
 *
 * Refused, with nothing written, as `addEntry` refuses, and when there is
 * no such entry.
 */
export function editEntry(db: DatabaseSync, input: EntryEditInput): EntryEditResult {
    return withTransaction(db, (): EntryEditResult => {
        const entry = findStoredEntry(db, input.entryId);
        if (!entry) {
            return refused(
                problem("entry-not-found", "entry", "That entry is not in the catalog. It may have been deleted.")
            );
        }
        const book = findEntryBook(db, entry.bookId)!;
        if (!suitsBook(input.placement, book)) {
            return refused(notPlaced(book));
        }
        const problems = placementProblems(
            db,
            book,
            entry.songId,
            input.placement,
            input.variantNote,
            entry.id
        );
        if (problems.length > 0) {
            return refused(...problems);
        }
        const number = numberOf(input.placement);
        const locationLabel = locationOf(input.placement);
        db.prepare(
            "UPDATE entries SET number = ?, location_label = ?, variant_note = ? WHERE id = ?"
        ).run(number, locationLabel, input.variantNote, entry.id);
        if (input.placement.kind === "end" || input.placement.kind === "position") {
            placeInOrder(db, book.id, entry.id, input.placement);
        }
        return { ok: true, entryId: entry.id, label: labelIn(book, { number, locationLabel }) };
    });
}

/**
 * Delete entry `entryId`, in one transaction. In a book without numbers the
 * entries after it move up one, so the positions stay 1, 2, 3, …. Refused
 * when there is no such entry.
 */
export function deleteEntry(db: DatabaseSync, entryId: number): EntryDeleteResult {
    return withTransaction(db, (): EntryDeleteResult => {
        const entry = findStoredEntry(db, entryId);
        if (!entry) {
            return refused(
                problem("entry-not-found", "entry", "That entry is not in the catalog. It may have been deleted.")
            );
        }
        const book = findEntryBook(db, entry.bookId)!;
        db.prepare("DELETE FROM entries WHERE id = ?").run(entryId);
        if (!book.numbered) {
            writeOrder(db, book.id, bookOrder(db, book.id));
        }
        return { ok: true, songId: entry.songId, label: labelIn(book, entry) };
    });
}

/**
 * Move entry `entryId` of a book without numbers one place up (towards the
 * start) or down, swapping it with its neighbour, in one transaction; the
 * positions stay 1, 2, 3, …. The first entry moved up, or the last moved
 * down, stays (`changed` false). Refused when there is no such entry, or its
 * book numbers its songs.
 */
export function moveEntry(
    db: DatabaseSync,
    entryId: number,
    direction: MoveDirection
): EntryMoveResult {
    return withTransaction(db, (): EntryMoveResult => {
        const entry = findStoredEntry(db, entryId);
        if (!entry) {
            return refused(
                problem("entry-not-found", "entry", "That entry is not in the catalog. It may have been deleted.")
            );
        }
        const book = findEntryBook(db, entry.bookId)!;
        if (book.numbered) {
            return refused(
                problem(
                    "entry-not-placed",
                    "placement",
                    `${book.name} numbers its songs: change the entry's number instead.`
                )
            );
        }
        const ids = bookOrder(db, book.id);
        const index = ids.indexOf(entryId);
        const target = direction === "up" ? index - 1 : index + 1;
        const changed = target >= 0 && target < ids.length;
        if (changed) {
            [ids[index], ids[target]] = [ids[target], ids[index]];
            writeOrder(db, book.id, ids);
        }
        return { ok: true, changed, position: ids.indexOf(entryId) + 1 };
    });
}
