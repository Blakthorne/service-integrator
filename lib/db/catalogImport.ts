import "server-only";
import type { DatabaseSync, SQLOutputValue } from "node:sqlite";
import type { BookCsvReport, ImportCounts } from "@/lib/domain";
import {
    InvalidStoredBookCsvRowsError,
    parseStoredBookCsvRows,
    planBookCsvImport,
    planBookCsvText,
    type BookCsvBook,
    type BookCsvCatalog,
    type BookCsvRef,
    type PlannedBookRows,
} from "@/lib/import/bookCsv";
import {
    InvalidPlannedRowsError,
    parsePlannedRows,
    type PlannedCatalogRows,
} from "@/lib/import/rows";
import {
    createImportRun,
    finishImportRun,
    ImportRunError,
    isImportRunKind,
    type ImportRunErrorReason,
} from "./importRuns";
import { withTransaction } from "./transaction";

/**
 * Applying the catalog's imports: the seed from hymns.json, which creates
 * the catalog once, and a book's CSV file, which adds entries (and the
 * hymns, tunes and songs they need) to one book. Each apply is one
 * transaction that refuses, writing nothing, a run it cannot apply as it
 * was previewed.
 */

/** The key of a planned song: its hymn's and its tune's keys. */
function songKey(hymnKey: string, tuneKey: string | null): string {
    return JSON.stringify([hymnKey, tuneKey]);
}

/** The id a key maps to; a key with none means the planned rows do not hang together. */
function idOf(ids: Map<string, number>, key: string): number {
    const id = ids.get(key);
    if (id === undefined) {
        throw new ImportRunError("invalid-rows");
    }
    return id;
}

/** Insert the planned rows, in order, and count what was inserted. */
function insertRows(db: DatabaseSync, rows: PlannedCatalogRows): ImportCounts {
    const insert = (sql: string) => {
        const statement = db.prepare(sql);
        return (...params: (string | number | null)[]) =>
            Number(statement.run(...params).lastInsertRowid);
    };
    const insertBook = insert(
        "INSERT INTO books (code, name, short_name, numbered, label_format, sort_order, active) VALUES (?, ?, ?, ?, ?, ?, 1)"
    );
    const insertHymn = insert("INSERT INTO hymns (title) VALUES (?)");
    const insertHymnAlias = insert(
        "INSERT INTO hymn_aliases (hymn_id, alias, normalized) VALUES (?, ?, ?)"
    );
    const insertTune = insert("INSERT INTO tunes (name) VALUES (?)");
    const insertTuneAlias = insert(
        "INSERT INTO tune_aliases (tune_id, alias, normalized) VALUES (?, ?, ?)"
    );
    const insertSong = insert("INSERT INTO songs (hymn_id, tune_id) VALUES (?, ?)");
    const insertEntry = insert(
        "INSERT INTO entries (book_id, song_id, number, position, location_label, variant_note) VALUES (?, ?, ?, ?, ?, ?)"
    );

    const books = new Map<string, number>();
    for (const book of rows.books) {
        books.set(
            book.code,
            insertBook(
                book.code,
                book.name,
                book.shortName,
                book.numbered ? 1 : 0,
                book.labelFormat,
                book.sortOrder
            )
        );
    }
    const hymns = new Map<string, number>();
    let hymnAliases = 0;
    for (const hymn of rows.hymns) {
        const id = insertHymn(hymn.title);
        hymns.set(hymn.key, id);
        for (const { alias, normalized } of hymn.aliases) {
            insertHymnAlias(id, alias, normalized);
            hymnAliases += 1;
        }
    }
    const tunes = new Map<string, number>();
    let tuneAliases = 0;
    for (const tune of rows.tunes) {
        const id = insertTune(tune.name);
        tunes.set(tune.key, id);
        for (const { alias, normalized } of tune.aliases) {
            insertTuneAlias(id, alias, normalized);
            tuneAliases += 1;
        }
    }
    const songs = new Map<string, number>();
    for (const song of rows.songs) {
        songs.set(
            songKey(song.hymnKey, song.tuneKey),
            insertSong(
                idOf(hymns, song.hymnKey),
                song.tuneKey === null ? null : idOf(tunes, song.tuneKey)
            )
        );
    }
    for (const entry of rows.entries) {
        insertEntry(
            idOf(books, entry.bookCode),
            idOf(songs, songKey(entry.hymnKey, entry.tuneKey)),
            entry.number,
            entry.position,
            entry.locationLabel,
            entry.variantNote
        );
    }

    return {
        books: books.size,
        hymns: hymns.size,
        hymnAliases,
        tunes: tunes.size,
        tuneAliases,
        songs: songs.size,
        songsWithoutTune: rows.songs.filter((song) => song.tuneKey === null).length,
        entries: rows.entries.length,
    };
}

// ---------------------------------------------------------------------------
// A book's CSV file
// ---------------------------------------------------------------------------

/** A book as a CSV import needs it, or null when there is no such book. */
function findCsvBook(db: DatabaseSync, bookId: number): BookCsvBook | null {
    const row = db
        .prepare("SELECT id, code, name, numbered, label_format FROM books WHERE id = ?")
        .get(bookId);
    return row
        ? {
              id: Number(row.id),
              code: String(row.code),
              name: String(row.name),
              numbered: row.numbered === 1,
              labelFormat: String(row.label_format),
          }
        : null;
}

/** Other names by the row they belong to, from rows of `owner`, `alias`. */
function aliasesByOwner(db: DatabaseSync, sql: string): Map<number, string[]> {
    const aliases = new Map<number, string[]>();
    for (const row of db.prepare(sql).all()) {
        const owner = Number(row.owner);
        aliases.set(owner, [...(aliases.get(owner) ?? []), String(row.alias)]);
    }
    return aliases;
}

/**
 * What a book's import is planned against: every hymn and tune with their
 * other names, every song, and the book's entries. Six queries.
 */
export function readBookCsvCatalog(db: DatabaseSync, bookId: number): BookCsvCatalog {
    const hymnAliases = aliasesByOwner(
        db,
        "SELECT hymn_id AS owner, alias FROM hymn_aliases ORDER BY id"
    );
    const tuneAliases = aliasesByOwner(
        db,
        "SELECT tune_id AS owner, alias FROM tune_aliases ORDER BY id"
    );
    return {
        hymns: db
            .prepare("SELECT id, title FROM hymns ORDER BY id")
            .all()
            .map((row) => ({
                id: Number(row.id),
                title: String(row.title),
                aliases: hymnAliases.get(Number(row.id)) ?? [],
            })),
        tunes: db
            .prepare("SELECT id, name FROM tunes ORDER BY id")
            .all()
            .map((row) => ({
                id: Number(row.id),
                name: String(row.name),
                aliases: tuneAliases.get(Number(row.id)) ?? [],
            })),
        songs: db
            .prepare("SELECT id, hymn_id, tune_id FROM songs ORDER BY id")
            .all()
            .map((row) => ({
                id: Number(row.id),
                hymnId: Number(row.hymn_id),
                tuneId: row.tune_id === null ? null : Number(row.tune_id),
            })),
        entries: db
            .prepare(
                "SELECT song_id, number, position, variant_note FROM entries WHERE book_id = ? ORDER BY id"
            )
            .all(bookId)
            .map((row) => ({
                songId: Number(row.song_id),
                number: row.number === null ? null : Number(row.number),
                position: row.position === null ? null : Number(row.position),
                variantNote: row.variant_note === null ? null : String(row.variant_note),
            })),
    };
}

/** A book file to preview: the book, the file's name and its text. */
export interface BookCsvUpload {
    bookId: number;
    sourceName: string;
    text: string;
}

/**
 * Plan importing a CSV file into book `bookId` (`planBookCsvText`) and
 * store the plan as a preview, at `at`, in one transaction, so the plan is
 * of one state of the catalog. Returns the new run's id, or null when there
 * is no such book. A file with problems is stored too: its report says
 * what they are, and applying it is refused.
 */
export function previewBookCsvRun(
    db: DatabaseSync,
    { bookId, sourceName, text }: BookCsvUpload,
    at: Date = new Date()
): number | null {
    return withTransaction(db, () => {
        const book = findCsvBook(db, bookId);
        if (!book) {
            return null;
        }
        const plan = planBookCsvText(book, text, readBookCsvCatalog(db, bookId));
        return createImportRun(
            db,
            { kind: "csv", sourceName, bookId, report: plan.report, rows: plan.stored },
            at
        );
    });
}

/** What re-planning a stored book file gives: the fresh plan, or why it cannot be applied. */
type BookCsvReplan =
    | { ok: true; rows: PlannedBookRows }
    | { ok: false; reason: ImportRunErrorReason };

/**
 * Plan a stored book file again against the catalog as it is now, and say
 * whether applying it would add exactly what its preview showed: refused
 * when its report has problems, its book is gone or changed kind, its rows
 * are damaged, or the plan differs from the preview's (the catalog has
 * changed since: a number taken, a hymn added that a row now matches, …).
 */
function replanBookCsv(db: DatabaseSync, run: Record<string, SQLOutputValue>): BookCsvReplan {
    const report = JSON.parse(String(run.report)) as BookCsvReport;
    if (!Array.isArray(report.problems) || report.problems.length > 0) {
        return { ok: false, reason: "has-problems" };
    }
    const book = run.book_id === null ? null : findCsvBook(db, Number(run.book_id));
    if (!book || book.numbered !== report.book?.numbered) {
        return { ok: false, reason: "book-not-found" };
    }
    let stored;
    try {
        stored = parseStoredBookCsvRows(JSON.parse(String(run.rows)));
    } catch (error) {
        if (error instanceof InvalidStoredBookCsvRowsError || error instanceof SyntaxError) {
            return { ok: false, reason: "invalid-rows" };
        }
        throw error;
    }
    const plan = planBookCsvImport(book, stored.records, readBookCsvCatalog(db, book.id));
    if (plan.report.problems.length > 0 || JSON.stringify(plan.rows) !== JSON.stringify(stored.planned)) {
        return { ok: false, reason: "stale" };
    }
    return { ok: true, rows: plan.rows };
}

/** The id of a ref: a hymn or tune of the catalog, or one the import has just added. */
function idOfRef(ids: Map<string, number>, ref: BookCsvRef): number {
    if ("id" in ref) {
        return ref.id;
    }
    const id = ids.get(ref.key);
    if (id === undefined) {
        throw new ImportRunError("invalid-rows");
    }
    return id;
}

/** Insert a book file's planned rows, in order, and count what was inserted. */
function insertBookRows(db: DatabaseSync, rows: PlannedBookRows): ImportCounts {
    const insert = (sql: string) => {
        const statement = db.prepare(sql);
        return (...params: (string | number | null)[]) => Number(statement.run(...params).lastInsertRowid);
    };
    const insertHymn = insert("INSERT INTO hymns (title) VALUES (?)");
    const insertTune = insert("INSERT INTO tunes (name) VALUES (?)");
    const insertSong = insert("INSERT INTO songs (hymn_id, tune_id) VALUES (?, ?)");
    const insertEntry = insert(
        "INSERT INTO entries (book_id, song_id, number, position, location_label, variant_note) VALUES (?, ?, ?, ?, NULL, ?)"
    );
    const findSong = db.prepare("SELECT id FROM songs WHERE hymn_id = ? AND tune_id IS ?");

    const hymns = new Map(rows.hymns.map(({ key, title }) => [key, insertHymn(title)]));
    const tunes = new Map(rows.tunes.map(({ key, name }) => [key, insertTune(name)]));
    const songIdOf = (hymn: BookCsvRef, tune: BookCsvRef | null) => {
        const hymnId = idOfRef(hymns, hymn);
        const tuneId = tune === null ? null : idOfRef(tunes, tune);
        const found = findSong.get(hymnId, tuneId);
        if (!found) {
            throw new ImportRunError("invalid-rows");
        }
        return Number(found.id);
    };
    for (const song of rows.songs) {
        insertSong(idOfRef(hymns, song.hymn), song.tune === null ? null : idOfRef(tunes, song.tune));
    }
    for (const entry of rows.entries) {
        insertEntry(
            rows.bookId,
            songIdOf(entry.hymn, entry.tune),
            entry.number,
            entry.position,
            entry.variantNote
        );
    }
    return {
        books: 0,
        hymns: rows.hymns.length,
        hymnAliases: 0,
        tunes: rows.tunes.length,
        tuneAliases: 0,
        songs: rows.songs.length,
        songsWithoutTune: rows.songs.filter(({ tune }) => tune === null).length,
        entries: rows.entries.length,
    };
}

// ---------------------------------------------------------------------------
// Either kind
// ---------------------------------------------------------------------------

/** What applying a run would do, checked: the seed's stored rows, a book file's fresh plan, or why it is refused. */
type ApplyCheck =
    | { ok: true; kind: "hymns-json"; rows: SQLOutputValue }
    | { ok: true; kind: "csv"; rows: PlannedBookRows }
    | { ok: false; reason: ImportRunErrorReason };

/**
 * Check whether run `id` can be applied now (see `findApplyRefusal`),
 * planning a book's file again on the way, so apply writes the plan it
 * checked.
 */
function checkRun(db: DatabaseSync, id: number): ApplyCheck {
    const run = db
        .prepare("SELECT kind, status, book_id, report, rows FROM import_runs WHERE id = ?")
        .get(id);
    if (!run || !isImportRunKind(run.kind)) {
        return { ok: false, reason: "not-found" };
    }
    if (run.status !== "preview") {
        return { ok: false, reason: "not-preview" };
    }
    if (run.kind === "csv") {
        const replanned = replanBookCsv(db, run);
        return replanned.ok ? { ok: true, kind: "csv", rows: replanned.rows } : replanned;
    }
    if (db.prepare("SELECT 1 FROM books LIMIT 1").get()) {
        return { ok: false, reason: "catalog-not-empty" };
    }
    return { ok: true, kind: "hymns-json", rows: run.rows };
}

/**
 * Why applying run `id` would be refused now, or null when it would go
 * ahead: "not-found" for no such run (or one of a kind this build does not
 * know), "not-preview" for a run already applied or discarded; for the seed
 * (unless its rows are damaged), "catalog-not-empty" while the catalog has
 * books; for a book's file, why its plan would not be what the preview
 * showed (see `replanBookCsv`: "has-problems", "book-not-found",
 * "invalid-rows" or "stale").
 */
export function findApplyRefusal(
    db: DatabaseSync,
    id: number
): ImportRunErrorReason | null {
    const check = checkRun(db, id);
    return check.ok ? null : check.reason;
}

/**
 * Apply a previewed import: insert every row it planned and mark it applied,
 * all in one transaction, so a failure leaves the catalog as it was. Returns
 * what it inserted, which is what the preview's report planned.
 *
 * It refuses, with an `ImportRunError`, a run that does not exist (or is of
 * a kind this build does not know) and one that is not a preview. The seed
 * is refused while the catalog has books (so it can never run twice), and
 * for rows of the wrong shape or that do not hang together. A book's file
 * is planned again against the catalog as it is, and refused unless that
 * plan is the preview's, with no problems (see `findApplyRefusal`): it adds
 * exactly what its report showed, or nothing. A row the schema forbids
 * throws the database's error; either way nothing is written.
 */
export function applyImportRun(db: DatabaseSync, id: number): ImportCounts {
    return withTransaction(db, () => {
        const check = checkRun(db, id);
        if (!check.ok) {
            throw new ImportRunError(check.reason);
        }
        let counts: ImportCounts;
        if (check.kind === "csv") {
            counts = insertBookRows(db, check.rows);
        } else {
            let rows: PlannedCatalogRows;
            try {
                rows = parsePlannedRows(JSON.parse(String(check.rows)));
            } catch (error) {
                if (error instanceof InvalidPlannedRowsError || error instanceof SyntaxError) {
                    throw new ImportRunError("invalid-rows", { cause: error });
                }
                throw error;
            }
            counts = insertRows(db, rows);
        }
        finishImportRun(db, id, "applied");
        return counts;
    });
}
