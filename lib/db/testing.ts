import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { normalizeTuneName } from "@/lib/catalog/normalize";
import type { SongLinkSource } from "@/lib/domain";
import { planHymnsJsonImport } from "@/lib/import/hymnsJson";
import { normalizeTitle } from "@/lib/normalizeTitle";
import { openDatabase } from "./connection";
import { migrate } from "./migrate";

/**
 * A new in-memory database with the app's connection settings and every
 * migration applied, for tests of `lib/db/*` (and of `lib/queries/*`, with
 * `getDb` mocked to return it). Each call is a separate, empty database.
 * Close it in `afterEach`.
 */
export function openTestDb(): DatabaseSync {
    const db = openDatabase(":memory:");
    migrate(db);
    return db;
}

// Seed builders: each inserts one row (and its aliases), filling in what the
// caller leaves out, and returns the new row's id. They write straight to the
// tables, so a test of a read function does not depend on the code that
// writes the catalog.

/** Run an INSERT and return the new row's id. */
function insert(db: DatabaseSync, sql: string, ...params: SQLInputValue[]): number {
    return Number(db.prepare(sql).run(...params).lastInsertRowid);
}

/** One more than the rows of `table`, for default names that tell rows apart. */
function nextOrdinal(db: DatabaseSync, table: string): number {
    return Number(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n) + 1;
}

/** The fields of a book; `seedBook` fills in the rest. */
export interface SeedBookFields {
    code?: string;
    name?: string;
    shortName?: string;
    numbered?: boolean;
    labelFormat?: string;
    sortOrder?: number;
    active?: boolean;
}

/**
 * Insert a book. By default it is numbered and active, coded "B1", "B2", …
 * (the first free one), named "Book <code>", with its name as its short name,
 * labelled "<code>-{n}" (an unnumbered book: its short name), and sorted
 * after the books already there.
 */
export function seedBook(db: DatabaseSync, fields: SeedBookFields = {}): number {
    let code = fields.code;
    if (code === undefined) {
        const taken = db.prepare("SELECT 1 FROM books WHERE code = ?");
        let ordinal = nextOrdinal(db, "books");
        while (taken.get(`B${ordinal}`)) {
            ordinal += 1;
        }
        code = `B${ordinal}`;
    }
    const name = fields.name ?? `Book ${code}`;
    const shortName = fields.shortName ?? name;
    const numbered = fields.numbered ?? true;
    const sortOrder =
        fields.sortOrder ??
        Number(
            db.prepare("SELECT coalesce(max(sort_order), 0) + 1 AS n FROM books").get()
                ?.n
        );
    return insert(
        db,
        "INSERT INTO books (code, name, short_name, numbered, label_format, sort_order, active) VALUES (?, ?, ?, ?, ?, ?, ?)",
        code,
        name,
        shortName,
        numbered ? 1 : 0,
        fields.labelFormat ?? (numbered ? `${code}-{n}` : shortName),
        sortOrder,
        (fields.active ?? true) ? 1 : 0
    );
}

/** The fields of a hymn; `seedHymn` fills in the rest. */
export interface SeedHymnFields {
    title?: string;
    firstLine?: string | null;
    notes?: string | null;
    /** Its other titles, stored with their `normalizeTitle` form. */
    aliases?: string[];
}

/** Insert a hymn, titled "Hymn 1", "Hymn 2", … by default, with its aliases. */
export function seedHymn(db: DatabaseSync, fields: SeedHymnFields = {}): number {
    const id = insert(
        db,
        "INSERT INTO hymns (title, first_line, notes) VALUES (?, ?, ?)",
        fields.title ?? `Hymn ${nextOrdinal(db, "hymns")}`,
        fields.firstLine ?? null,
        fields.notes ?? null
    );
    for (const alias of fields.aliases ?? []) {
        insert(
            db,
            "INSERT INTO hymn_aliases (hymn_id, alias, normalized) VALUES (?, ?, ?)",
            id,
            alias,
            normalizeTitle(alias)
        );
    }
    return id;
}

/** The fields of a tune; `seedTune` fills in the rest. */
export interface SeedTuneFields {
    name?: string;
    meter?: string | null;
    notes?: string | null;
    /** Its other names, stored with their `normalizeTuneName` form. */
    aliases?: string[];
}

/** Insert a tune, named "TUNE 1", "TUNE 2", … by default, with its aliases. */
export function seedTune(db: DatabaseSync, fields: SeedTuneFields = {}): number {
    const id = insert(
        db,
        "INSERT INTO tunes (name, meter, notes) VALUES (?, ?, ?)",
        fields.name ?? `TUNE ${nextOrdinal(db, "tunes")}`,
        fields.meter ?? null,
        fields.notes ?? null
    );
    for (const alias of fields.aliases ?? []) {
        insert(
            db,
            "INSERT INTO tune_aliases (tune_id, alias, normalized) VALUES (?, ?, ?)",
            id,
            alias,
            normalizeTuneName(alias)
        );
    }
    return id;
}

/** The fields of a song; `seedSong` fills in the rest. */
export interface SeedSongFields {
    /** Its hymn; a new one (see `seedHymn`) when left out. */
    hymnId?: number;
    /** Its tune; none (unknown) when left out. */
    tuneId?: number | null;
    pcoSongId?: string | null;
    linkedAt?: string | null;
    linkedBy?: SongLinkSource | null;
    notes?: string | null;
}

/** Insert a song: by default a new hymn with no tune, and no Planning Center link. */
export function seedSong(db: DatabaseSync, fields: SeedSongFields = {}): number {
    return insert(
        db,
        "INSERT INTO songs (hymn_id, tune_id, pco_song_id, linked_at, linked_by, notes) VALUES (?, ?, ?, ?, ?, ?)",
        fields.hymnId ?? seedHymn(db),
        fields.tuneId ?? null,
        fields.pcoSongId ?? null,
        fields.linkedAt ?? null,
        fields.linkedBy ?? null,
        fields.notes ?? null
    );
}

/** The fields of an entry; `seedEntry` fills in the rest. */
export interface SeedEntryFields {
    bookId: number;
    songId: number;
    number?: number | null;
    position?: number | null;
    locationLabel?: string | null;
    variantNote?: string | null;
}

/**
 * Insert an entry of a song in a book. When none of `number`, `position` and
 * `locationLabel` is given, it goes at the end of the book: the next number
 * in a numbered book, the next position in an unnumbered one.
 */
export function seedEntry(db: DatabaseSync, fields: SeedEntryFields): number {
    let { number = null, position = null } = fields;
    const placed =
        fields.number !== undefined ||
        fields.position !== undefined ||
        fields.locationLabel !== undefined;
    if (!placed) {
        const book = db
            .prepare("SELECT numbered FROM books WHERE id = ?")
            .get(fields.bookId);
        const column = book?.numbered === 0 ? "position" : "number";
        const next = Number(
            db
                .prepare(
                    `SELECT coalesce(max(${column}), 0) + 1 AS n FROM entries WHERE book_id = ?`
                )
                .get(fields.bookId)?.n
        );
        if (column === "position") {
            position = next;
        } else {
            number = next;
        }
    }
    return insert(
        db,
        "INSERT INTO entries (book_id, song_id, number, position, location_label, variant_note) VALUES (?, ?, ?, ?, ?, ?)",
        fields.bookId,
        fields.songId,
        number,
        position,
        fields.locationLabel ?? null,
        fields.variantNote ?? null
    );
}

/**
 * The fields of an import run; `seedImportRun` fills in the rest. The kind and
 * status are plain text, so a test can store what a newer build might.
 */
export interface SeedImportRunFields {
    at?: string;
    kind?: string;
    bookId?: number | null;
    status?: string;
    sourceName?: string;
    /** Stored as JSON. */
    report?: unknown;
    /** Stored as JSON. */
    rows?: unknown;
}

/**
 * Insert an import run: by default a preview of the seed of an empty
 * hymns.json (its two books and nothing else), at 2026-10-04 12:00 UTC.
 */
export function seedImportRun(
    db: DatabaseSync,
    fields: SeedImportRunFields = {}
): number {
    const empty = planHymnsJsonImport([]);
    return insert(
        db,
        "INSERT INTO import_runs (at, kind, book_id, status, source_name, report, rows) VALUES (?, ?, ?, ?, ?, ?, ?)",
        fields.at ?? "2026-10-04T12:00:00.000Z",
        fields.kind ?? "hymns-json",
        fields.bookId ?? null,
        fields.status ?? "preview",
        fields.sourceName ?? "hymns.json",
        JSON.stringify(fields.report ?? empty.report),
        JSON.stringify(fields.rows ?? empty.rows)
    );
}
