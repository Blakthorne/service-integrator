import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { normalizeTuneName } from "@/lib/catalog/normalize";
import type { MirroredPcoSong, SongLinkSource } from "@/lib/domain";
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

/** The fields of a song of the Planning Center mirror; `seedPcoSong` fills in the rest. */
export type SeedPcoSongFields = Partial<MirroredPcoSong>;

/** The first id `seedPcoSong` gives, plus the row's ordinal: 9000001, 9000002, … */
const SEED_PCO_SONG_ID_BASE = 9_000_000;

/**
 * Insert a song into the Planning Center mirror and return its id. By
 * default its id is the first free one of 9000001, 9000002, …, it is titled
 * "PCO Song 1", "PCO Song 2", … with no credits, never scheduled, not
 * hidden, synced at 2026-10-04 12:00 UTC, and neither removed, ignored nor
 * blocked from auto-linking.
 */
export function seedPcoSong(db: DatabaseSync, fields: SeedPcoSongFields = {}): string {
    const ordinal = nextOrdinal(db, "pco_songs");
    let id = fields.id;
    if (id === undefined) {
        const taken = db.prepare("SELECT 1 FROM pco_songs WHERE id = ?");
        let candidate = ordinal;
        while (taken.get(String(SEED_PCO_SONG_ID_BASE + candidate))) {
            candidate += 1;
        }
        id = String(SEED_PCO_SONG_ID_BASE + candidate);
    }
    db.prepare(
        `INSERT INTO pco_songs (id, title, author, copyright, ccli_number, admin, themes, hidden,
             last_scheduled_at, created_at, updated_at, synced_at, removed_at, ignored_at,
             auto_link_blocked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
        id,
        fields.title ?? `PCO Song ${ordinal}`,
        fields.author ?? null,
        fields.copyright ?? null,
        fields.ccliNumber ?? null,
        fields.admin ?? null,
        fields.themes ?? null,
        fields.hidden ? 1 : 0,
        fields.lastScheduledAt ?? null,
        fields.createdAt ?? null,
        fields.updatedAt ?? null,
        fields.syncedAt ?? "2026-10-04T12:00:00.000Z",
        fields.removedAt ?? null,
        fields.ignoredAt ?? null,
        fields.autoLinkBlockedAt ?? null
    );
    return id;
}

/**
 * The fields of a saved Schedule-tab choice; `seedScheduleSelection` fills in
 * the rest. The option is plain text, so a test can store what a newer build
 * might.
 */
export interface SeedScheduleSelectionFields {
    planId?: string;
    itemId?: string;
    option?: string;
    customText?: string | null;
    updatedAt?: string;
}

/**
 * Insert a saved Schedule-tab choice and return its key. By default it is
 * Numbers, with no custom text, for plan 81234567 (the plan `planResource`
 * builds) and the first free item id of 1, 2, …, saved at 2026-10-04 12:00
 * UTC.
 */
export function seedScheduleSelection(
    db: DatabaseSync,
    fields: SeedScheduleSelectionFields = {}
): { planId: string; itemId: string } {
    const planId = fields.planId ?? "81234567";
    let itemId = fields.itemId;
    if (itemId === undefined) {
        const taken = db.prepare(
            "SELECT 1 FROM schedule_selections WHERE plan_id = ? AND item_id = ?"
        );
        let ordinal = 1;
        while (taken.get(planId, String(ordinal))) {
            ordinal += 1;
        }
        itemId = String(ordinal);
    }
    db.prepare(
        "INSERT INTO schedule_selections (plan_id, item_id, option, custom_text, updated_at) VALUES (?, ?, ?, ?, ?)"
    ).run(
        planId,
        itemId,
        fields.option ?? "numbers",
        fields.customText ?? null,
        fields.updatedAt ?? "2026-10-04T12:00:00.000Z"
    );
    return { planId, itemId };
}

/**
 * The fields of a write to Planning Center; `seedWriteLog` fills in the rest.
 * The kind is plain text, so a test can store what a newer build might.
 */
export interface SeedWriteLogFields {
    at?: string;
    kind?: string;
    target?: string;
    ok?: boolean;
    /** Stored as JSON. */
    payload?: unknown;
    /** Stored as JSON. */
    result?: unknown;
}

/**
 * Insert a row of the write log and return its id. By default it is a
 * hymnal note written to item 1 of plan 81234567 at 2026-10-04 12:00 UTC,
 * with an empty payload and result.
 */
export function seedWriteLog(db: DatabaseSync, fields: SeedWriteLogFields = {}): number {
    return insert(
        db,
        "INSERT INTO write_log (at, kind, target, ok, payload, result) VALUES (?, ?, ?, ?, ?, ?)",
        fields.at ?? "2026-10-04T12:00:00.000Z",
        fields.kind ?? "item-note",
        fields.target ?? "plan 81234567 item 1",
        (fields.ok ?? true) ? 1 : 0,
        JSON.stringify(fields.payload ?? {}),
        JSON.stringify(fields.result ?? {})
    );
}

/**
 * Store a setting's value as JSON, as saving it does, at `updatedAt`
 * (2026-10-04 12:00 UTC by default). Any key and any JSON value, so a test
 * can store what a newer build might, or a value that no longer parses.
 */
export function seedSetting(
    db: DatabaseSync,
    key: string,
    value: unknown,
    updatedAt = "2026-10-04T12:00:00.000Z"
): void {
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)").run(
        key,
        JSON.stringify(value),
        updatedAt
    );
}

/**
 * Store mirrored song `pcoSongId`'s derived credits straight into
 * `pco_song_credits`, as a sync derives them: one row for each name of each
 * role, numbered from 0, all with `status` ("ok" by default; plain text, so
 * a test can store what a newer build might), or, with no credits, the one
 * row with neither role nor name that holds the status. The song must be in
 * the mirror (see `seedPcoSong`).
 */
export function seedPcoSongCredits(
    db: DatabaseSync,
    pcoSongId: string,
    credits: readonly { role: string; names: readonly string[] }[],
    status = "ok"
): void {
    const rows = credits.flatMap(({ role, names }) => names.map((name) => [role, name] as const));
    const insert = db.prepare(
        "INSERT INTO pco_song_credits (pco_song_id, role, name, position, parse_status) VALUES (?, ?, ?, ?, ?)"
    );
    if (rows.length === 0) {
        insert.run(pcoSongId, null, null, 0, status);
    }
    rows.forEach(([role, name], position) => {
        insert.run(pcoSongId, role, name, position, status);
    });
}

/**
 * A default id for a new row of `table`: the first of `base + n`,
 * `base + n + 1`, … that no row has, where n is one more than its rows.
 */
function firstFreeId(db: DatabaseSync, table: string, base: number): string {
    const taken = db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`);
    let ordinal = nextOrdinal(db, table);
    while (taken.get(String(base + ordinal))) {
        ordinal += 1;
    }
    return String(base + ordinal);
}

/** The fields of a song tag group of the mirror; `seedPcoTagGroup` fills in the rest. */
export interface SeedPcoTagGroupFields {
    id?: string;
    name?: string;
    /** Plain text, so a test can store an arrangement group. */
    tagsFor?: string;
    allowMultiple?: boolean;
}

/**
 * Insert a tag group into the mirror and return its id. By default its id is
 * the first free one of 8000001, 8000002, …, it is named "Tag Group 1",
 * "Tag Group 2", …, its tags are for songs, and a song may have several of
 * them.
 */
export function seedPcoTagGroup(db: DatabaseSync, fields: SeedPcoTagGroupFields = {}): string {
    const id = fields.id ?? firstFreeId(db, "pco_tag_groups", 8_000_000);
    db.prepare(
        "INSERT INTO pco_tag_groups (id, name, tags_for, allow_multiple) VALUES (?, ?, ?, ?)"
    ).run(
        id,
        fields.name ?? `Tag Group ${nextOrdinal(db, "pco_tag_groups")}`,
        fields.tagsFor ?? "song",
        (fields.allowMultiple ?? true) ? 1 : 0
    );
    return id;
}

/** The fields of a tag of the mirror; `seedPcoTag` fills in the rest. */
export interface SeedPcoTagFields {
    id?: string;
    /** Its group; a new one (see `seedPcoTagGroup`) when left out. */
    groupId?: string;
    name?: string;
}

/**
 * Insert a tag into the mirror and return its id. By default its id is the
 * first free one of 8100001, 8100002, …, it is named "Tag 1", "Tag 2", …,
 * and it is in a new tag group.
 */
export function seedPcoTag(db: DatabaseSync, fields: SeedPcoTagFields = {}): string {
    const groupId = fields.groupId ?? seedPcoTagGroup(db);
    const id = fields.id ?? firstFreeId(db, "pco_tags", 8_100_000);
    db.prepare("INSERT INTO pco_tags (id, group_id, name) VALUES (?, ?, ?)").run(
        id,
        groupId,
        fields.name ?? `Tag ${nextOrdinal(db, "pco_tags")}`
    );
    return id;
}

/** Give mirrored song `pcoSongId` the mirrored tag `tagId`. */
export function seedPcoSongTag(db: DatabaseSync, pcoSongId: string, tagId: string): void {
    db.prepare("INSERT INTO pco_song_tags (pco_song_id, tag_id) VALUES (?, ?)").run(
        pcoSongId,
        tagId
    );
}
