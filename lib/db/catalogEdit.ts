import "server-only";
import type { DatabaseSync, SQLOutputValue } from "node:sqlite";
import { formatEntryLabel } from "@/lib/catalog/labels";
import { normalizeTuneName } from "@/lib/catalog/normalize";
import type {
    EntryEditInput,
    EntryPart,
    EntryPlacement,
    HymnAliasInput,
    HymnEditInput,
    HymnPart,
    MoveDirection,
    NewEntryInput,
    TuneAliasInput,
    TuneEditInput,
    TunePart,
} from "@/lib/catalog/validation";
import { normalizeTitle } from "@/lib/normalizeTitle";
import { readTuneHint } from "@/lib/reconcile";
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

// ---------------------------------------------------------------------------
// Hymns and tunes, and their other names
//
// A hymn's title and other titles are compared by `normalizeTitle`, a tune's
// name and other names by `normalizeTuneName`. An other name ("alias") is
// unique across all hymns (or all tunes): `hymn_aliases.normalized` and
// `tune_aliases.normalized` say so. A hymn's title is not unique in the
// schema (two texts can share one), but an edit, like the new-song form,
// never gives a hymn a title another hymn has as its title or other title:
// the way to make two hymns one is to merge them (lib/db/catalogMerge.ts).
// Tunes likewise.
// ---------------------------------------------------------------------------

/** Why a hymn or tune edit was refused. */
export type NameProblemReason =
    /** The hymn is not in the catalog (any more). */
    | "hymn-not-found"
    /** The tune is not in the catalog (any more). */
    | "tune-not-found"
    /** Another hymn (or tune) has that title (or name), or has it as another title (or name). */
    | "name-taken"
    /** The other name is the hymn's own title (or the tune's own name). */
    | "alias-is-name"
    /** The hymn (or tune) already has that other name. */
    | "alias-exists"
    /** The other name to remove is not one of the hymn's (or tune's). */
    | "alias-not-found";

/**
 * What renaming a hymn or tune did to its other names: the old name kept
 * as another one (see `editHymn`), and another name dropped because it is
 * the new name now; null for each when nothing was.
 */
export interface RenameOutcome {
    aliasKept: string | null;
    aliasDropped: string | null;
}

export type HymnEditResult = EditResult<{ hymnId: number } & RenameOutcome, NameProblemReason, HymnPart>;

export type TuneEditResult = EditResult<{ tuneId: number } & RenameOutcome, NameProblemReason, TunePart>;

/** What adding or removing another title or name did: the other name, as stored. */
export type HymnAliasResult = EditResult<{ alias: string }, NameProblemReason, "hymn" | "alias">;

export type TuneAliasResult = EditResult<{ alias: string }, NameProblemReason, "tune" | "alias">;

/** A song of hymn `hymnId`, the first by tune name (an unknown tune last), as a row to link to, or null. */
function firstSongOfHymn(db: DatabaseSync, hymnId: number): CatalogRowRef | null {
    const row = db
        .prepare(
            `SELECT s.id FROM ${SONG_WITH_NAMES}
             WHERE s.hymn_id = ?
             ORDER BY t.name IS NULL, t.name COLLATE NOCASE, s.id
             LIMIT 1`
        )
        .get(hymnId);
    return row ? songRef(db, Number(row.id)) : null;
}

/** Another hymn or tune that has a name, by its own name or by another one. */
interface NameHolder {
    id: number;
    /** Its own title or name. */
    name: string;
    /** The other name of it that matched; null when its own did. */
    alias: string | null;
}

/** The kind of row a name belongs to: hymns (titles) or tunes (names), with how each is matched. */
interface NameKind {
    table: "hymns" | "tunes";
    nameColumn: "title" | "name";
    aliasTable: "hymn_aliases" | "tune_aliases";
    ownerColumn: "hymn_id" | "tune_id";
    normalize: (text: string) => string;
}

const HYMN_NAMES: NameKind = {
    table: "hymns",
    nameColumn: "title",
    aliasTable: "hymn_aliases",
    ownerColumn: "hymn_id",
    normalize: normalizeTitle,
};

const TUNE_NAMES: NameKind = {
    table: "tunes",
    nameColumn: "name",
    aliasTable: "tune_aliases",
    ownerColumn: "tune_id",
    normalize: normalizeTuneName,
};

/**
 * The hymn or tune other than `exceptId` whose name, or one of whose other
 * names, is `key` (already normalized), or null. Names are compared in
 * TypeScript, since the normalizations are not SQL; other names by their
 * stored form.
 */
function nameHolder(db: DatabaseSync, kind: NameKind, key: string, exceptId: number): NameHolder | null {
    for (const row of db
        .prepare(`SELECT id, ${kind.nameColumn} AS name FROM ${kind.table} WHERE id <> ? ORDER BY id`)
        .all(exceptId)) {
        if (kind.normalize(String(row.name)) === key) {
            return { id: Number(row.id), name: String(row.name), alias: null };
        }
    }
    const alias = db
        .prepare(
            `SELECT a.${kind.ownerColumn} AS owner, a.alias, o.${kind.nameColumn} AS name
             FROM ${kind.aliasTable} a JOIN ${kind.table} o ON o.id = a.${kind.ownerColumn}
             WHERE a.normalized = ? AND a.${kind.ownerColumn} <> ?`
        )
        .get(key, exceptId);
    return alias
        ? { id: Number(alias.owner), name: String(alias.name), alias: String(alias.alias) }
        : null;
}

/** A row's other name whose stored form is `key`, or null. */
function ownAlias(db: DatabaseSync, kind: NameKind, ownerId: number, key: string): string | null {
    const row = db
        .prepare(`SELECT alias FROM ${kind.aliasTable} WHERE ${kind.ownerColumn} = ? AND normalized = ?`)
        .get(ownerId, key);
    return row ? String(row.alias) : null;
}

/** Whether any row of the kind has `key` as another name. */
function aliasTaken(db: DatabaseSync, kind: NameKind, key: string): boolean {
    return (
        db.prepare(`SELECT 1 FROM ${kind.aliasTable} WHERE normalized = ?`).get(key) !== undefined
    );
}

function addAliasRow(db: DatabaseSync, kind: NameKind, ownerId: number, alias: string): void {
    db.prepare(
        `INSERT INTO ${kind.aliasTable} (${kind.ownerColumn}, alias, normalized) VALUES (?, ?, ?)`
    ).run(ownerId, alias, kind.normalize(alias));
}

function dropAliasRow(db: DatabaseSync, kind: NameKind, ownerId: number, key: string): void {
    db.prepare(`DELETE FROM ${kind.aliasTable} WHERE ${kind.ownerColumn} = ? AND normalized = ?`).run(
        ownerId,
        key
    );
}

/**
 * The titles of the Planning Center songs a person may still link, as
 * matching reads them: the mirror's songs neither deleted from Planning
 * Center nor set aside as not hymnal material (Ignore).
 */
function linkablePcoTitles(db: DatabaseSync): string[] {
    return db
        .prepare("SELECT title FROM pco_songs WHERE removed_at IS NULL AND ignored_at IS NULL")
        .all()
        .map((row) => String(row.title));
}

/**
 * Whether a Planning Center song's title matches a hymn titled `key` (by
 * `normalizeTitle`), as `suggestLinks` reads titles: the whole title, or the
 * title before a trailing parenthetical that may name the tune ("Abba,
 * Father (PRITCHARD)").
 */
function pcoTitleMatchesHymn(pcoTitle: string, key: string): boolean {
    const hint = readTuneHint(pcoTitle);
    return normalizeTitle(pcoTitle) === key || (hint !== null && normalizeTitle(hint.base) === key);
}

/**
 * Whether a Planning Center song's title names a tune called `key` (by
 * `normalizeTuneName`) in a trailing parenthetical, as `tunesNamedBy` reads
 * one ("Abba, Father (PRITCHARD)").
 */
function pcoTitleNamesTune(pcoTitle: string, key: string): boolean {
    return (readTuneHint(pcoTitle)?.names ?? []).some((name) => normalizeTuneName(name) === key);
}

/**
 * The problem with giving a hymn or tune a name that `holder`, another one,
 * has as its own name or as another name, on `part` of the form, with a
 * link to it (a hymn's first song, or the tune).
 */
function nameTakenProblem<P extends string>(
    db: DatabaseSync,
    kind: NameKind,
    holder: NameHolder,
    part: P
): EditProblem<NameProblemReason, P> {
    const isHymn = kind === HYMN_NAMES;
    const existing = isHymn
        ? firstSongOfHymn(db, holder.id)
        : ({ kind: "tune", tuneId: holder.id, label: holder.name } as const);
    const message = isHymn
        ? holder.alias === null
            ? `The catalog already has a hymn titled "${holder.name}". To make the two one, merge this hymn into it.`
            : `"${holder.alias}" is another title of "${holder.name}". To make the two one, merge this hymn into it.`
        : holder.alias === null
          ? `The catalog already has the tune ${holder.name}. To make the two one, merge this tune into it.`
          : `${holder.alias} is another name of the tune ${holder.name}. To make the two one, merge this tune into it.`;
    return problem("name-taken", part, message, existing);
}

/**
 * Rename a hymn or tune from `oldName` to `newName` and keep its other names
 * in step: an other name that is the new name is dropped (the name says it
 * now), and the old name is kept as another one when a Planning Center
 * song's title still matches it (`matches`) and no row has it as another
 * name already. Writes nothing when the two names are the same by the
 * kind's normalization.
 */
function renameAliases(
    db: DatabaseSync,
    kind: NameKind,
    ownerId: number,
    oldName: string,
    newName: string,
    matches: (pcoTitle: string, key: string) => boolean
): RenameOutcome {
    const oldKey = kind.normalize(oldName);
    const newKey = kind.normalize(newName);
    if (oldKey === newKey) {
        return { aliasKept: null, aliasDropped: null };
    }
    const aliasDropped = ownAlias(db, kind, ownerId, newKey);
    if (aliasDropped !== null) {
        dropAliasRow(db, kind, ownerId, newKey);
    }
    const keep =
        !aliasTaken(db, kind, oldKey) &&
        linkablePcoTitles(db).some((pcoTitle) => matches(pcoTitle, oldKey));
    if (keep) {
        addAliasRow(db, kind, ownerId, oldName);
    }
    return { aliasKept: keep ? oldName : null, aliasDropped };
}

/**
 * Change hymn `hymnId`'s title, first line and notes, in one transaction.
 *
 * **Renaming keeps a Planning Center match.** Planning Center songs are
 * matched to hymns by title (`suggestLinks`), so a rename could leave a
 * song of the mirror that matched the old title matching nothing. So the
 * old title is kept as another title of the hymn when a song of the mirror
 * that a person may still link (not deleted from Planning Center, not
 * ignored) has a title that matches it, whole or before a trailing
 * parenthetical, linked or not; otherwise it goes, so fixing a typo leaves
 * no typo behind. An other title that is the new title is dropped. The
 * result says which (`aliasKept`, `aliasDropped`).
 *
 * Refused, writing nothing, when there is no such hymn, or another hymn has
 * the new title as its title or another title (merge the two instead).
 */
export function editHymn(db: DatabaseSync, input: HymnEditInput): HymnEditResult {
    return withTransaction(db, (): HymnEditResult => {
        const row = db.prepare("SELECT title FROM hymns WHERE id = ?").get(input.hymnId);
        if (!row) {
            return refused(problem("hymn-not-found", "hymn", "That hymn is not in the catalog."));
        }
        const holder = nameHolder(db, HYMN_NAMES, normalizeTitle(input.title), input.hymnId);
        if (holder) {
            return refused(nameTakenProblem(db, HYMN_NAMES, holder, "title"));
        }
        const outcome = renameAliases(
            db,
            HYMN_NAMES,
            input.hymnId,
            String(row.title),
            input.title,
            pcoTitleMatchesHymn
        );
        db.prepare("UPDATE hymns SET title = ?, first_line = ?, notes = ? WHERE id = ?").run(
            input.title,
            input.firstLine,
            input.notes,
            input.hymnId
        );
        return { ok: true, hymnId: input.hymnId, ...outcome };
    });
}

/**
 * Change tune `tuneId`'s name, meter and notes, in one transaction. As
 * with a hymn's title (`editHymn`), the old name is kept as another name
 * of the tune when a song of the mirror that a person may still link names
 * it in a trailing parenthetical ("Abba, Father (PRITCHARD)"), and another
 * name that is the new name is dropped. Refused, writing nothing, when
 * there is no such tune, or another tune has the new name as its name or
 * another name (merge the two instead).
 */
export function editTune(db: DatabaseSync, input: TuneEditInput): TuneEditResult {
    return withTransaction(db, (): TuneEditResult => {
        const row = db.prepare("SELECT name FROM tunes WHERE id = ?").get(input.tuneId);
        if (!row) {
            return refused(problem("tune-not-found", "tune", "That tune is not in the catalog."));
        }
        const holder = nameHolder(db, TUNE_NAMES, normalizeTuneName(input.name), input.tuneId);
        if (holder) {
            return refused(nameTakenProblem(db, TUNE_NAMES, holder, "name"));
        }
        const outcome = renameAliases(
            db,
            TUNE_NAMES,
            input.tuneId,
            String(row.name),
            input.name,
            pcoTitleNamesTune
        );
        db.prepare("UPDATE tunes SET name = ?, meter = ?, notes = ? WHERE id = ?").run(
            input.name,
            input.meter,
            input.notes,
            input.tuneId
        );
        return { ok: true, tuneId: input.tuneId, ...outcome };
    });
}

/**
 * Give a hymn or tune another name, in one transaction. Refused, writing
 * nothing, when there is no such row, the name is its own, it has that
 * other name already, or another row has it as its name or another name.
 */
function addAlias<P extends "hymn" | "tune">(
    db: DatabaseSync,
    kind: NameKind,
    part: P,
    ownerId: number,
    alias: string
): EditResult<{ alias: string }, NameProblemReason, P | "alias"> {
    type Result = EditResult<{ alias: string }, NameProblemReason, P | "alias">;
    const isHymn = kind === HYMN_NAMES;
    return withTransaction(db, (): Result => {
        const row = db
            .prepare(`SELECT ${kind.nameColumn} AS name FROM ${kind.table} WHERE id = ?`)
            .get(ownerId);
        if (!row) {
            return refused(
                problem(
                    isHymn ? "hymn-not-found" : "tune-not-found",
                    part,
                    `That ${part} is not in the catalog.`
                )
            );
        }
        const key = kind.normalize(alias);
        if (kind.normalize(String(row.name)) === key) {
            return refused(
                problem(
                    "alias-is-name",
                    "alias",
                    isHymn ? `"${alias}" is the hymn's title.` : `${alias} is the tune's name.`
                )
            );
        }
        const own = ownAlias(db, kind, ownerId, key);
        if (own !== null) {
            return refused(
                problem(
                    "alias-exists",
                    "alias",
                    isHymn
                        ? `"${own}" is already another title of this hymn.`
                        : `${own} is already another name of this tune.`
                )
            );
        }
        const holder = nameHolder(db, kind, key, ownerId);
        if (holder) {
            return refused(nameTakenProblem(db, kind, holder, "alias"));
        }
        addAliasRow(db, kind, ownerId, alias);
        return { ok: true, alias };
    });
}

/**
 * Take another name off a hymn or tune, found by its normalized form, in
 * one transaction. Refused when there is no such row, or it has no such
 * other name.
 */
function removeAlias<P extends "hymn" | "tune">(
    db: DatabaseSync,
    kind: NameKind,
    part: P,
    ownerId: number,
    alias: string
): EditResult<{ alias: string }, NameProblemReason, P | "alias"> {
    type Result = EditResult<{ alias: string }, NameProblemReason, P | "alias">;
    const isHymn = kind === HYMN_NAMES;
    return withTransaction(db, (): Result => {
        if (!db.prepare(`SELECT 1 FROM ${kind.table} WHERE id = ?`).get(ownerId)) {
            return refused(
                problem(
                    isHymn ? "hymn-not-found" : "tune-not-found",
                    part,
                    `That ${part} is not in the catalog.`
                )
            );
        }
        const key = kind.normalize(alias);
        const own = ownAlias(db, kind, ownerId, key);
        if (own === null) {
            return refused(
                problem(
                    "alias-not-found",
                    "alias",
                    isHymn
                        ? `"${alias}" is not another title of this hymn. It may have been removed already.`
                        : `${alias} is not another name of this tune. It may have been removed already.`
                )
            );
        }
        dropAliasRow(db, kind, ownerId, key);
        return { ok: true, alias: own };
    });
}

/**
 * Give hymn `hymnId` another title (by `normalizeTitle`), which Planning
 * Center songs are then matched by too. Refused when there is no such hymn,
 * the title is its own, it has it already, or another hymn has it as its
 * title or another title.
 */
export function addHymnAlias(db: DatabaseSync, { hymnId, alias }: HymnAliasInput): HymnAliasResult {
    return addAlias(db, HYMN_NAMES, "hymn", hymnId, alias);
}

/** Take another title off hymn `hymnId`. Refused when there is no such hymn, or it has no such title. */
export function removeHymnAlias(db: DatabaseSync, { hymnId, alias }: HymnAliasInput): HymnAliasResult {
    return removeAlias(db, HYMN_NAMES, "hymn", hymnId, alias);
}

/**
 * Give tune `tuneId` another name (by `normalizeTuneName`). Refused when
 * there is no such tune, the name is its own, it has it already, or another
 * tune has it as its name or another name.
 */
export function addTuneAlias(db: DatabaseSync, { tuneId, alias }: TuneAliasInput): TuneAliasResult {
    return addAlias(db, TUNE_NAMES, "tune", tuneId, alias);
}

/** Take another name off tune `tuneId`. Refused when there is no such tune, or it has no such name. */
export function removeTuneAlias(db: DatabaseSync, { tuneId, alias }: TuneAliasInput): TuneAliasResult {
    return removeAlias(db, TUNE_NAMES, "tune", tuneId, alias);
}
