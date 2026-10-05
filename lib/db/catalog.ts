import "server-only";
import type { DatabaseSync, SQLInputValue, SQLOutputValue } from "node:sqlite";
import { formatEntryLabel } from "@/lib/catalog/labels";
import { sortSongMarks } from "@/lib/catalog/marks";
import type {
    Book,
    BookDetail,
    BookEntry,
    BookSummary,
    CatalogCounts,
    CatalogMatch,
    CatalogSongDetail,
    CatalogSongSummary,
    Entry,
    LabelledEntry,
    SongLinkSource,
    SongMarkKind,
    TuneDetail,
    TuneSummary,
} from "@/lib/domain";
import { localYmd } from "@/lib/plansByDate";
import { SONG_MARKS_JSON, songMarksFromJson } from "./marks";

/**
 * Reads of the song catalog for its pages. Each function runs a handful of
 * queries, however many rows there are, and labels every entry here
 * (`formatEntryLabel`), so pages and client components never format one.
 */

type Row = Record<string, SQLOutputValue>;

function text(value: SQLOutputValue): string {
    return String(value);
}

function nullableText(value: SQLOutputValue): string | null {
    return value === null ? null : String(value);
}

function int(value: SQLOutputValue): number {
    return Number(value);
}

function nullableInt(value: SQLOutputValue): number | null {
    return value === null ? null : Number(value);
}

const SONG_LINK_SOURCES: readonly SongLinkSource[] = ["auto", "manual", "import"];

/** A link source this build knows, or null (none, or one a newer build wrote). */
function linkSource(value: SQLOutputValue): SongLinkSource | null {
    return SONG_LINK_SOURCES.find((source) => source === value) ?? null;
}

/** Group values by a key, keeping their order. */
function groupBy<T>(values: T[], key: (value: T) => number): Map<number, T[]> {
    const groups = new Map<number, T[]>();
    for (const value of values) {
        const group = groups.get(key(value));
        if (group) {
            group.push(value);
        } else {
            groups.set(key(value), [value]);
        }
    }
    return groups;
}

// ---------------------------------------------------------------------------
// Books and entries
// ---------------------------------------------------------------------------

const BOOK_COLUMNS =
    "b.id, b.code, b.name, b.short_name, b.numbered, b.label_format, b.sort_order, b.active";

/** Books in the order they are listed, and a song's entries are ordered by. */
const BOOK_ORDER = "b.sort_order, b.code, b.id";

/**
 * Entries of one book in browse order: those with neither a number nor a
 * position (at a location such as the front cover) first, then by number, or
 * by position in an unnumbered book.
 */
const PLACEMENT_ORDER =
    "(e.number IS NOT NULL OR e.position IS NOT NULL), e.number, e.position, e.location_label";

/** After `PLACEMENT_ORDER`: a song's plain entry before its variants. */
const VARIANT_ORDER = "e.variant_note IS NOT NULL, e.variant_note, e.id";

function toBook(row: Row): Book {
    return {
        id: int(row.id),
        code: text(row.code),
        name: text(row.name),
        shortName: text(row.short_name),
        numbered: row.numbered === 1,
        labelFormat: text(row.label_format),
        sortOrder: int(row.sort_order),
        active: row.active === 1,
    };
}

/** What `toLabelledEntry` reads from `entries e JOIN books b`: the entry, its book's code and label format. */
const ENTRY_COLUMNS =
    "e.id, e.book_id, e.song_id, e.number, e.position, e.location_label, e.variant_note, b.code AS book_code, b.numbered AS book_numbered, b.label_format AS book_label_format";

function toLabelledEntry(row: Row): LabelledEntry {
    const entry: Entry = {
        id: int(row.id),
        bookId: int(row.book_id),
        songId: int(row.song_id),
        number: nullableInt(row.number),
        position: nullableInt(row.position),
        locationLabel: nullableText(row.location_label),
        variantNote: nullableText(row.variant_note),
    };
    return {
        ...entry,
        bookCode: text(row.book_code),
        label: formatEntryLabel(
            {
                numbered: row.book_numbered === 1,
                labelFormat: text(row.book_label_format),
            },
            entry
        ),
    };
}

// ---------------------------------------------------------------------------
// Songs
// ---------------------------------------------------------------------------

/** Which songs `songSummaries` reads: a condition on `songs s` and its parameters. */
interface SongFilter {
    where: string;
    params: SQLInputValue[];
}

/** The marks of a JSON array of mark names, in the order of `SONG_MARKS`, without those this build does not know. */
function markKinds(json: SQLOutputValue): SongMarkKind[] {
    const parsed: unknown = typeof json === "string" ? JSON.parse(json) : [];
    return Array.isArray(parsed) ? sortSongMarks(parsed) : [];
}

/** Aliases grouped by the hymn or tune they belong to, from rows of `owner`, `alias`. */
function aliasesByOwner(rows: Row[]): Map<number, string[]> {
    const aliases = new Map<number, string[]>();
    for (const [owner, group] of groupBy(rows, (row) => int(row.owner))) {
        aliases.set(owner, group.map((row) => text(row.alias)));
    }
    return aliases;
}

/**
 * Songs as list rows, in `orderBy` order, each with its hymn's and tune's
 * aliases, its link, when its Planning Center song was last scheduled and
 * the date of the last past plan it was in (before `today`, the church's
 * date: the server's by default), its labelled entries in book order and
 * its marks. Four queries, whatever the number of songs: the songs (with
 * their links, last sung dates and marks), their entries, and the two kinds
 * of alias.
 */
function songSummaries(
    db: DatabaseSync,
    filter: SongFilter | null,
    orderBy: string,
    today: string = localYmd(new Date())
): CatalogSongSummary[] {
    const where = filter ? `WHERE ${filter.where}` : "";
    const params = filter?.params ?? [];
    /** Restrict `column` to the values it has in the filtered songs. */
    const among = (column: string, songColumn: string) =>
        filter ? `WHERE ${column} IN (SELECT s.${songColumn} FROM songs s ${where})` : "";

    const songs = db
        .prepare(
            `SELECT s.id, s.hymn_id, h.title, s.tune_id, t.name AS tune_name, s.pco_song_id,
                    s.linked_by, p.last_scheduled_at,
                    (SELECT max(o.plan_date) FROM plan_occurrences o
                     WHERE o.pco_song_id = s.pco_song_id AND o.plan_date < ?) AS last_sung_at,
                    (SELECT json_group_array(m.mark) FROM song_marks m WHERE m.song_id = s.id) AS marks
             FROM songs s
             JOIN hymns h ON h.id = s.hymn_id
             LEFT JOIN tunes t ON t.id = s.tune_id
             LEFT JOIN pco_songs p ON p.id = s.pco_song_id
             ${where}
             ORDER BY ${orderBy}`
        )
        .all(today, ...params);
    const entries = groupBy(
        db
            .prepare(
                `SELECT ${ENTRY_COLUMNS}
                 FROM entries e
                 JOIN books b ON b.id = e.book_id
                 ${among("e.song_id", "id")}
                 ORDER BY ${BOOK_ORDER}, ${PLACEMENT_ORDER}, ${VARIANT_ORDER}`
            )
            .all(...params)
            .map(toLabelledEntry),
        (entry) => entry.songId
    );
    const hymnAliases = aliasesByOwner(
        db
            .prepare(
                `SELECT hymn_id AS owner, alias FROM hymn_aliases
                 ${among("hymn_id", "hymn_id")}
                 ORDER BY alias, id`
            )
            .all(...params)
    );
    const tuneAliases = aliasesByOwner(
        db
            .prepare(
                `SELECT tune_id AS owner, alias FROM tune_aliases
                 ${among("tune_id", "tune_id")}
                 ORDER BY alias, id`
            )
            .all(...params)
    );

    return songs.map((row) => {
        const id = int(row.id);
        const hymnId = int(row.hymn_id);
        const tuneId = nullableInt(row.tune_id);
        return {
            id,
            hymnId,
            title: text(row.title),
            aliases: hymnAliases.get(hymnId) ?? [],
            tuneId,
            tuneName: nullableText(row.tune_name),
            tuneAliases: tuneId === null ? [] : (tuneAliases.get(tuneId) ?? []),
            pcoSongId: nullableText(row.pco_song_id),
            linkedBy: linkSource(row.linked_by),
            lastScheduledAt: nullableText(row.last_scheduled_at),
            lastSungAt: nullableText(row.last_sung_at),
            entries: entries.get(id) ?? [],
            marks: markKinds(row.marks),
        };
    });
}

/** Songs by their hymn's title, then tune name (an unknown tune last). */
const BY_TITLE =
    "h.title COLLATE NOCASE, h.id, t.name IS NULL, t.name COLLATE NOCASE, t.id, s.id";

/** Songs by tune name (an unknown tune last), then their hymn's title. */
const BY_TUNE =
    "t.name IS NULL, t.name COLLATE NOCASE, t.id, h.title COLLATE NOCASE, h.id, s.id";

/**
 * Every song as a row of the songs list, by title, then tune name. A row's
 * `lastSungAt` is the last past plan before `today` (`YYYY-MM-DD`: the
 * server's date by default).
 */
export function listCatalogSongs(
    db: DatabaseSync,
    today: string = localYmd(new Date())
): CatalogSongSummary[] {
    return songSummaries(db, null, BY_TITLE, today);
}

/** A song's label, "Amazing Grace (NEW BRITAIN)", or the title alone when the tune is unknown. */
export function songLabelOf(title: string, tuneName: string | null): string {
    return tuneName === null ? title : `${title} (${tuneName})`;
}

/**
 * One song with its hymn, tune, aliases, entries, marks, the hymn's other
 * songs (by tune name, an unknown tune last) and the tune's other hymns (by
 * title), or null when there is no such song. Five queries.
 */
export function findCatalogSong(
    db: DatabaseSync,
    songId: number
): CatalogSongDetail | null {
    const row = db
        .prepare(
            `SELECT s.id, s.hymn_id, s.tune_id, s.pco_song_id, s.linked_at, s.linked_by, s.notes,
                    h.title, h.first_line, h.notes AS hymn_notes,
                    t.name AS tune_name, t.meter, t.notes AS tune_notes,
                    ${SONG_MARKS_JSON} AS marks
             FROM songs s
             JOIN hymns h ON h.id = s.hymn_id
             LEFT JOIN tunes t ON t.id = s.tune_id
             WHERE s.id = ?`
        )
        .get(songId);
    if (!row) {
        return null;
    }
    const hymnId = int(row.hymn_id);
    const tuneId = nullableInt(row.tune_id);

    // The song itself and every song that shares its hymn or its tune (an
    // unknown tune shares nothing: "tune_id = NULL" is never true), by tune
    // name, then title. The hymn's songs therefore come by tune name, and
    // the tune's songs, which share a name, by title.
    const family = songSummaries(
        db,
        { where: "s.hymn_id = ? OR s.tune_id = ?", params: [hymnId, tuneId] },
        BY_TUNE
    );
    const self = family.find(({ id }) => id === songId);
    const others = family.filter(({ id }) => id !== songId);
    const otherTunes = others.filter((song) => song.hymnId === hymnId);
    const otherHymns = others.filter((song) => song.hymnId !== hymnId);

    return {
        id: songId,
        hymnId,
        tuneId,
        pcoSongId: nullableText(row.pco_song_id),
        linkedAt: nullableText(row.linked_at),
        linkedBy: linkSource(row.linked_by),
        notes: nullableText(row.notes),
        hymn: {
            id: hymnId,
            title: text(row.title),
            firstLine: nullableText(row.first_line),
            notes: nullableText(row.hymn_notes),
            aliases: self?.aliases ?? [],
        },
        tune:
            tuneId === null
                ? null
                : {
                      id: tuneId,
                      name: text(row.tune_name),
                      meter: nullableText(row.meter),
                      notes: nullableText(row.tune_notes),
                      aliases: self?.tuneAliases ?? [],
                  },
        entries: self?.entries ?? [],
        otherTunes,
        otherHymns,
        marks: songMarksFromJson(row.marks),
    };
}

/** A song's page title, "Amazing Grace (NEW BRITAIN)", or null when there is no such song. */
export function findCatalogSongLabel(
    db: DatabaseSync,
    songId: number
): string | null {
    const row = db
        .prepare(
            `SELECT h.title, t.name AS tune_name
             FROM songs s
             JOIN hymns h ON h.id = s.hymn_id
             LEFT JOIN tunes t ON t.id = s.tune_id
             WHERE s.id = ?`
        )
        .get(songId);
    return row ? songLabelOf(text(row.title), nullableText(row.tune_name)) : null;
}

/**
 * The catalog songs linked to these Planning Center songs, by Planning
 * Center song id, each with its hymn's title, its tune's name and its
 * labelled entries in book order: what a plan page shows beside its items,
 * and what the schedule text, the hymnal notes and the dashboard print.
 * So the entries are those of the books in use only: a book that is not
 * active stays browsable, but its numbers are printed nowhere. Ids no song
 * is linked to are left out. Two queries, however many ids, and none for no
 * ids.
 */
export function findCatalogMatches(
    db: DatabaseSync,
    pcoSongIds: readonly string[]
): Map<string, CatalogMatch> {
    const matches = new Map<string, CatalogMatch>();
    if (pcoSongIds.length === 0) {
        return matches;
    }
    const ids = JSON.stringify([...new Set(pcoSongIds)]);
    const linked = "s.pco_song_id IN (SELECT value FROM json_each(?))";
    const entries = groupBy(
        db
            .prepare(
                `SELECT ${ENTRY_COLUMNS}
                 FROM entries e
                 JOIN books b ON b.id = e.book_id
                 JOIN songs s ON s.id = e.song_id
                 WHERE ${linked} AND b.active = 1
                 ORDER BY ${BOOK_ORDER}, ${PLACEMENT_ORDER}, ${VARIANT_ORDER}`
            )
            .all(ids)
            .map(toLabelledEntry),
        (entry) => entry.songId
    );
    const songs = db
        .prepare(
            `SELECT s.id, s.pco_song_id, h.title, t.name AS tune_name
             FROM songs s
             JOIN hymns h ON h.id = s.hymn_id
             LEFT JOIN tunes t ON t.id = s.tune_id
             WHERE ${linked}`
        )
        .all(ids);
    for (const row of songs) {
        const songId = int(row.id);
        matches.set(text(row.pco_song_id), {
            songId,
            title: text(row.title),
            tuneName: nullableText(row.tune_name),
            entries: entries.get(songId) ?? [],
        });
    }
    return matches;
}

// ---------------------------------------------------------------------------
// Tunes
// ---------------------------------------------------------------------------

/** Every tune's aliases, or one tune's. */
function tuneAliasesOf(db: DatabaseSync, tuneId?: number): Map<number, string[]> {
    const where = tuneId === undefined ? "" : "WHERE tune_id = ?";
    return aliasesByOwner(
        db
            .prepare(
                `SELECT tune_id AS owner, alias FROM tune_aliases ${where} ORDER BY alias, id`
            )
            .all(...(tuneId === undefined ? [] : [tuneId]))
    );
}

/** Every tune with its aliases and how many songs use it, by name. Two queries. */
export function listTunes(db: DatabaseSync): TuneSummary[] {
    const aliases = tuneAliasesOf(db);
    return db
        .prepare(
            `SELECT t.id, t.name, t.meter, t.notes, count(s.id) AS song_count
             FROM tunes t
             LEFT JOIN songs s ON s.tune_id = t.id
             GROUP BY t.id
             ORDER BY t.name COLLATE NOCASE, t.id`
        )
        .all()
        .map((row) => ({
            id: int(row.id),
            name: text(row.name),
            meter: nullableText(row.meter),
            notes: nullableText(row.notes),
            aliases: aliases.get(int(row.id)) ?? [],
            songCount: int(row.song_count),
        }));
}

/** One tune with its aliases and its songs (by title), or null when there is no such tune. */
export function findTune(db: DatabaseSync, tuneId: number): TuneDetail | null {
    const row = db
        .prepare("SELECT id, name, meter, notes FROM tunes WHERE id = ?")
        .get(tuneId);
    if (!row) {
        return null;
    }
    return {
        id: tuneId,
        name: text(row.name),
        meter: nullableText(row.meter),
        notes: nullableText(row.notes),
        aliases: tuneAliasesOf(db, tuneId).get(tuneId) ?? [],
        songs: songSummaries(
            db,
            { where: "s.tune_id = ?", params: [tuneId] },
            BY_TITLE
        ),
    };
}

/** A tune's name, for its page title, or null when there is no such tune. */
export function findTuneLabel(db: DatabaseSync, tuneId: number): string | null {
    const row = db.prepare("SELECT name FROM tunes WHERE id = ?").get(tuneId);
    return row ? text(row.name) : null;
}

// ---------------------------------------------------------------------------
// Books
// ---------------------------------------------------------------------------

/**
 * Every book with its number of entries, in book order, or with
 * `activeOnly` the books in use only: those the songs list's book filter
 * offers. One query.
 */
export function listBooks(
    db: DatabaseSync,
    { activeOnly = false }: { activeOnly?: boolean } = {}
): BookSummary[] {
    return db
        .prepare(
            `SELECT ${BOOK_COLUMNS}, count(e.id) AS entry_count
             FROM books b
             LEFT JOIN entries e ON e.book_id = b.id
             ${activeOnly ? "WHERE b.active = 1" : ""}
             GROUP BY b.id
             ORDER BY ${BOOK_ORDER}`
        )
        .all()
        .map((row) => ({ ...toBook(row), entryCount: int(row.entry_count) }));
}

/** The book with this code, in any case ("g" finds G), or null. */
function bookByCode(db: DatabaseSync, code: string): Book | null {
    const row = db
        .prepare(`SELECT ${BOOK_COLUMNS} FROM books b WHERE b.code = ?`)
        .get(code);
    return row ? toBook(row) : null;
}

/**
 * The book with this code (in any case) and its entries in browse order: at
 * a location (the front cover) first, then by number, or by position in an
 * unnumbered book. Null when there is no such book. Two queries.
 */
export function findBook(db: DatabaseSync, code: string): BookDetail | null {
    const book = bookByCode(db, code);
    if (!book) {
        return null;
    }
    const entries: BookEntry[] = db
        .prepare(
            `SELECT ${ENTRY_COLUMNS},
                    s.hymn_id, h.title, s.tune_id, t.name AS tune_name, s.pco_song_id
             FROM entries e
             JOIN books b ON b.id = e.book_id
             JOIN songs s ON s.id = e.song_id
             JOIN hymns h ON h.id = s.hymn_id
             LEFT JOIN tunes t ON t.id = s.tune_id
             WHERE e.book_id = ?
             ORDER BY ${PLACEMENT_ORDER}, h.title COLLATE NOCASE, ${VARIANT_ORDER}`
        )
        .all(book.id)
        .map((row) => ({
            ...toLabelledEntry(row),
            hymnId: int(row.hymn_id),
            title: text(row.title),
            tuneId: nullableInt(row.tune_id),
            tuneName: nullableText(row.tune_name),
            pcoSongId: nullableText(row.pco_song_id),
        }));
    return { ...book, entries };
}

/** A book's name, for its page title, or null when there is no such book. */
export function findBookLabel(db: DatabaseSync, code: string): string | null {
    return bookByCode(db, code)?.name ?? null;
}

// ---------------------------------------------------------------------------
// The whole catalog
// ---------------------------------------------------------------------------

/** How many books, hymns, tunes, songs and entries there are. One query. */
export function countCatalog(db: DatabaseSync): CatalogCounts {
    const row = db
        .prepare(
            `SELECT (SELECT count(*) FROM books) AS books,
                    (SELECT count(*) FROM hymns) AS hymns,
                    (SELECT count(*) FROM tunes) AS tunes,
                    (SELECT count(*) FROM songs) AS songs,
                    (SELECT count(*) FROM entries) AS entries`
        )
        .get() as Row;
    return {
        books: int(row.books),
        hymns: int(row.hymns),
        tunes: int(row.tunes),
        songs: int(row.songs),
        entries: int(row.entries),
    };
}
