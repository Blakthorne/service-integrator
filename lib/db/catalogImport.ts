import "server-only";
import type { DatabaseSync } from "node:sqlite";
import type { ImportCounts } from "@/lib/domain";
import {
    InvalidPlannedRowsError,
    parsePlannedRows,
    type PlannedCatalogRows,
} from "@/lib/import/rows";
import {
    finishImportRun,
    ImportRunError,
    isImportRunKind,
    type ImportRunErrorReason,
} from "./importRuns";
import { withTransaction } from "./transaction";

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

/**
 * Why applying run `id` would be refused now, or null when it would go ahead
 * (unless its rows are damaged): "not-found" for no such run (or one of a
 * kind this build does not know), "not-preview" for a run already applied or
 * discarded, "catalog-not-empty" while the catalog has books.
 */
export function findApplyRefusal(
    db: DatabaseSync,
    id: number
): ImportRunErrorReason | null {
    const run = db.prepare("SELECT kind, status FROM import_runs WHERE id = ?").get(id);
    if (!run || !isImportRunKind(run.kind)) {
        return "not-found";
    }
    if (run.status !== "preview") {
        return "not-preview";
    }
    if (db.prepare("SELECT 1 FROM books LIMIT 1").get()) {
        return "catalog-not-empty";
    }
    return null;
}

/**
 * Apply a previewed import: insert every row it planned and mark it applied,
 * all in one transaction, so a failure leaves the catalog as it was. Returns
 * what it inserted, which is what the preview's report planned.
 *
 * It refuses, with an `ImportRunError`, a run that does not exist (or is of
 * a kind this build does not know), one that is not a preview, any run while
 * the catalog has books (so the seed can never run twice), and rows of the
 * wrong shape or that do not hang together. A row the schema forbids throws
 * the database's error; either way nothing is written.
 */
export function applyImportRun(db: DatabaseSync, id: number): ImportCounts {
    return withTransaction(db, () => {
        const refusal = findApplyRefusal(db, id);
        if (refusal !== null) {
            throw new ImportRunError(refusal);
        }
        const stored = db.prepare("SELECT rows FROM import_runs WHERE id = ?").get(id);
        let rows: PlannedCatalogRows;
        try {
            rows = parsePlannedRows(JSON.parse(String(stored?.rows)));
        } catch (error) {
            if (error instanceof InvalidPlannedRowsError || error instanceof SyntaxError) {
                throw new ImportRunError("invalid-rows", { cause: error });
            }
            throw error;
        }
        const counts = insertRows(db, rows);
        finishImportRun(db, id, "applied");
        return counts;
    });
}
