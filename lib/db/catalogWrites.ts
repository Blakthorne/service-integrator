import "server-only";
import type { DatabaseSync, SQLOutputValue } from "node:sqlite";
import { formatEntryLabel } from "@/lib/catalog/labels";
import { normalizeTuneName } from "@/lib/catalog/normalize";
import type {
    EntryChoice,
    HymnChoice,
    NewSongInput,
    NewSongPart,
    TuneChoice,
} from "@/lib/catalog/validation";
import { normalizeTitle } from "@/lib/normalizeTitle";
import { songLabelOf } from "./catalog";
import { findLinkedSong, linkSong, type LinkRefusalReason } from "./links";
import { withTransaction } from "./transaction";

/**
 * Writes to the song catalog from its forms: for now, a new song with its
 * hymn, tune, first entry and Planning Center link, all in one transaction.
 * Like a link, a write that the catalog's rules refuse (a title already
 * taken, a song or number that exists) comes back as a value with a message
 * fit to show, never a throw, and changes nothing.
 */

/** A new song, as the new-song form describes it, and the Planning Center song to link it to. */
export interface NewCatalogSong extends NewSongInput {
    /** Link the new song to this Planning Center song (by hand); null for none. */
    pcoSongId: string | null;
}

/** Why a new song was refused. */
export type CreateSongProblemReason =
    /** The hymn chosen from the catalog is not in it (any more). */
    | "hymn-not-found"
    /** A new hymn's title is already a hymn's title, or another title of one. */
    | "hymn-title-taken"
    /** The tune chosen from the catalog is not in it. */
    | "tune-not-found"
    /** A new tune's name is already a tune's name, or another name of one. */
    | "tune-name-taken"
    /** The hymn already has a song to that tune (or one with no tune). */
    | "song-exists"
    /** The entry's book is not in the catalog. */
    | "book-not-found"
    /** The entry does not suit its book: a number or location in a book without numbers, or the reverse. */
    | "entry-not-placed"
    /** Another song has the entry's number in that book. */
    | "number-taken"
    /** Linking the new song to the Planning Center song was refused (see `linkSong`). */
    | LinkRefusalReason;

/** A catalog row a problem is about, for a link to it. */
export type ExistingRow =
    | { kind: "song"; songId: number; label: string }
    | { kind: "tune"; tuneId: number; label: string };

/** One reason a new song was refused, with a message fit to show. */
export interface CreateSongProblem {
    reason: CreateSongProblemReason;
    /** The part of the form it is about; null for the link to Planning Center. */
    part: NewSongPart | null;
    message: string;
    /** What already exists, such as the song that has the number; null when nothing does. */
    existing: ExistingRow | null;
}

/** What `createCatalogSong` did: the new song's id, or every problem it found. */
export type CreateSongResult =
    | { ok: true; songId: number }
    | { ok: false; problems: CreateSongProblem[] };

function nullableText(value: SQLOutputValue): string | null {
    return value === null ? null : String(value);
}

function problem(
    reason: CreateSongProblemReason,
    part: NewSongPart | null,
    message: string,
    existing: ExistingRow | null = null
): CreateSongProblem {
    return { reason, part, message, existing };
}

/** Thrown inside the transaction to roll back what it wrote, and caught outside it. */
class Refused extends Error {
    constructor(readonly problem: CreateSongProblem) {
        super(problem.message);
        this.name = "Refused";
    }
}

/** A song of hymn `hymnId`, the first by tune name (an unknown tune last), as a row to link to, or null. */
function firstSongOfHymn(db: DatabaseSync, hymnId: number): ExistingRow | null {
    const row = db
        .prepare(
            `SELECT s.id, h.title, t.name AS tune_name
             FROM songs s
             JOIN hymns h ON h.id = s.hymn_id
             LEFT JOIN tunes t ON t.id = s.tune_id
             WHERE s.hymn_id = ?
             ORDER BY t.name IS NULL, t.name COLLATE NOCASE, s.id
             LIMIT 1`
        )
        .get(hymnId);
    return row
        ? {
              kind: "song",
              songId: Number(row.id),
              label: songLabelOf(String(row.title), nullableText(row.tune_name)),
          }
        : null;
}

/** The hymn whose title, or one of whose other titles, is `title` (by `normalizeTitle`), or null. */
function hymnTitled(
    db: DatabaseSync,
    title: string
): { hymnId: number; title: string; alias: string | null } | null {
    const key = normalizeTitle(title);
    for (const row of db.prepare("SELECT id, title FROM hymns ORDER BY id").all()) {
        if (normalizeTitle(String(row.title)) === key) {
            return { hymnId: Number(row.id), title: String(row.title), alias: null };
        }
    }
    const alias = db
        .prepare(
            `SELECT a.hymn_id, a.alias, h.title
             FROM hymn_aliases a JOIN hymns h ON h.id = a.hymn_id
             WHERE a.normalized = ?`
        )
        .get(key);
    return alias
        ? { hymnId: Number(alias.hymn_id), title: String(alias.title), alias: String(alias.alias) }
        : null;
}

/** The tune whose name, or one of whose other names, is `name` (by `normalizeTuneName`), or null. */
function tuneNamed(
    db: DatabaseSync,
    name: string
): { tuneId: number; name: string; alias: string | null } | null {
    const key = normalizeTuneName(name);
    for (const row of db.prepare("SELECT id, name FROM tunes ORDER BY id").all()) {
        if (normalizeTuneName(String(row.name)) === key) {
            return { tuneId: Number(row.id), name: String(row.name), alias: null };
        }
    }
    const alias = db
        .prepare(
            `SELECT a.tune_id, a.alias, t.name
             FROM tune_aliases a JOIN tunes t ON t.id = a.tune_id
             WHERE a.normalized = ?`
        )
        .get(key);
    return alias
        ? { tuneId: Number(alias.tune_id), name: String(alias.name), alias: String(alias.alias) }
        : null;
}

/** What is wrong with the hymn: one chosen that does not exist, or a new title already taken. */
function hymnProblems(db: DatabaseSync, hymn: HymnChoice): CreateSongProblem[] {
    if (hymn.kind === "existing") {
        return db.prepare("SELECT 1 FROM hymns WHERE id = ?").get(hymn.hymnId)
            ? []
            : [problem("hymn-not-found", "hymn", "That hymn is not in the catalog. Choose one from the list.")];
    }
    const taken = hymnTitled(db, hymn.title);
    if (!taken) {
        return [];
    }
    const message =
        taken.alias === null
            ? `The catalog already has a hymn titled "${taken.title}". Choose it from the list, or give this one a title that tells them apart.`
            : `"${taken.alias}" is another title of "${taken.title}", which the catalog has. Choose that hymn from the list instead.`;
    return [problem("hymn-title-taken", "hymn", message, firstSongOfHymn(db, taken.hymnId))];
}

/** What is wrong with the tune: one chosen that does not exist, or a new name already taken. */
function tuneProblems(db: DatabaseSync, tune: TuneChoice): CreateSongProblem[] {
    if (tune.kind === "none") {
        return [];
    }
    if (tune.kind === "existing") {
        return db.prepare("SELECT 1 FROM tunes WHERE id = ?").get(tune.tuneId)
            ? []
            : [problem("tune-not-found", "tune", "That tune is not in the catalog. Choose one from the list.")];
    }
    const taken = tuneNamed(db, tune.name);
    if (!taken) {
        return [];
    }
    const message =
        taken.alias === null
            ? `The catalog already has the tune ${taken.name}. Choose it from the list instead.`
            : `${taken.alias} is another name of the tune ${taken.name}. Choose that tune from the list instead.`;
    return [
        problem("tune-name-taken", "tune", message, {
            kind: "tune",
            tuneId: taken.tuneId,
            label: taken.name,
        }),
    ];
}

/**
 * The song a hymn of the catalog already has to a tune of the catalog (or
 * with no tune), as a problem, or none. A new hymn or tune cannot have one.
 */
function songProblems(db: DatabaseSync, hymn: HymnChoice, tune: TuneChoice): CreateSongProblem[] {
    if (hymn.kind !== "existing" || tune.kind === "new") {
        return [];
    }
    const tuneId = tune.kind === "existing" ? tune.tuneId : null;
    const row = db
        .prepare(
            `SELECT s.id, h.title, t.name AS tune_name
             FROM songs s
             JOIN hymns h ON h.id = s.hymn_id
             LEFT JOIN tunes t ON t.id = s.tune_id
             WHERE s.hymn_id = ? AND s.tune_id IS ?`
        )
        .get(hymn.hymnId, tuneId);
    if (!row) {
        return [];
    }
    const title = String(row.title);
    const label = songLabelOf(title, nullableText(row.tune_name));
    const message =
        tuneId === null
            ? `The catalog already has "${title}" with no tune.`
            : `The catalog already has "${label}".`;
    return [problem("song-exists", "tune", message, { kind: "song", songId: Number(row.id), label })];
}

/** A book as the entry checks need it. */
interface EntryBook {
    name: string;
    numbered: boolean;
    labelFormat: string;
}

/** What is wrong with the entry: no such book, a placement the book does not take, or a number taken. */
function entryProblems(db: DatabaseSync, entry: EntryChoice | null): CreateSongProblem[] {
    if (entry === null) {
        return [];
    }
    const row = db
        .prepare("SELECT name, numbered, label_format FROM books WHERE id = ?")
        .get(entry.bookId);
    if (!row) {
        return [problem("book-not-found", "entry", "That book is not in the catalog. Choose one from the list.")];
    }
    const book: EntryBook = {
        name: String(row.name),
        numbered: row.numbered === 1,
        labelFormat: String(row.label_format),
    };
    if (book.numbered === (entry.kind === "end")) {
        return [
            problem(
                "entry-not-placed",
                "entry",
                book.numbered
                    ? `${book.name} numbers its songs: give the song's number, or where the book has it.`
                    : `${book.name} has no numbers: a new song goes at its end.`
            ),
        ];
    }
    if (entry.kind !== "number") {
        return [];
    }
    const holder = db
        .prepare(
            `SELECT s.id, h.title, t.name AS tune_name
             FROM entries e
             JOIN songs s ON s.id = e.song_id
             JOIN hymns h ON h.id = s.hymn_id
             LEFT JOIN tunes t ON t.id = s.tune_id
             WHERE e.book_id = ? AND e.number = ?`
        )
        .get(entry.bookId, entry.number);
    if (!holder) {
        return [];
    }
    const label = formatEntryLabel(book, { number: entry.number, locationLabel: null });
    const songLabel = songLabelOf(String(holder.title), nullableText(holder.tune_name));
    return [
        problem("number-taken", "entry", `${label} is taken by "${songLabel}".`, {
            kind: "song",
            songId: Number(holder.id),
            label: songLabel,
        }),
    ];
}

/** Insert a row and return its id. */
function insert(db: DatabaseSync, sql: string, ...params: (string | number | null)[]): number {
    return Number(db.prepare(sql).run(...params).lastInsertRowid);
}

/** Insert the entry: at its number or location, or after the last position of a book without numbers. */
function insertEntry(db: DatabaseSync, songId: number, entry: EntryChoice): void {
    const position =
        entry.kind === "end"
            ? Number(
                  db
                      .prepare(
                          "SELECT coalesce(max(position), 0) + 1 AS next FROM entries WHERE book_id = ?"
                      )
                      .get(entry.bookId)?.next
              )
            : null;
    insert(
        db,
        "INSERT INTO entries (book_id, song_id, number, position, location_label) VALUES (?, ?, ?, ?, ?)",
        entry.bookId,
        songId,
        entry.kind === "number" ? entry.number : null,
        position,
        entry.kind === "location" ? entry.locationLabel : null
    );
}

/**
 * Add a song to the catalog, at `now`: its hymn (a new one when the title is
 * new), its tune (a new one when the name is new, or none), its first entry
 * if it has one, and its link to a Planning Center song if one is given
 * (`linkSong`, by hand, which also takes that song off the ignored list).
 * All of it is one transaction, so a refusal at any step leaves the catalog
 * as it was. Returns the new song's id.
 *
 * Refused, with every problem it finds before writing: a hymn, tune or book
 * chosen that the catalog does not have; a new hymn titled as a hymn is
 * already titled, or by another title of one (`normalizeTitle`); a new tune
 * named as a tune already is, or by another name of one
 * (`normalizeTuneName`); a hymn that already has a song to that tune, or
 * one with no tune; an entry its book does not take, or a number another
 * song has. Then refused, alone, when the link is (the Planning Center song
 * is not in the mirror, has been deleted, or is linked to another song,
 * which the problem names).
 */
export function createCatalogSong(
    db: DatabaseSync,
    song: NewCatalogSong,
    now: Date = new Date()
): CreateSongResult {
    try {
        return withTransaction(db, (): CreateSongResult => {
            const found = [
                ...hymnProblems(db, song.hymn),
                ...tuneProblems(db, song.tune),
                ...entryProblems(db, song.entry),
            ];
            const problems = found.some(({ part }) => part === "hymn" || part === "tune")
                ? found
                : [...found, ...songProblems(db, song.hymn, song.tune)];
            if (problems.length > 0) {
                return { ok: false, problems };
            }

            const hymnId =
                song.hymn.kind === "existing"
                    ? song.hymn.hymnId
                    : insert(db, "INSERT INTO hymns (title) VALUES (?)", song.hymn.title);
            const tuneId =
                song.tune.kind === "existing"
                    ? song.tune.tuneId
                    : song.tune.kind === "new"
                      ? insert(db, "INSERT INTO tunes (name) VALUES (?)", song.tune.name)
                      : null;
            const songId = insert(
                db,
                "INSERT INTO songs (hymn_id, tune_id) VALUES (?, ?)",
                hymnId,
                tuneId
            );
            if (song.entry !== null) {
                insertEntry(db, songId, song.entry);
            }
            if (song.pcoSongId !== null) {
                const linked = linkSong(db, songId, song.pcoSongId, "manual", now);
                if (!linked.ok) {
                    const holder =
                        linked.reason === "pco-song-linked"
                            ? findLinkedSong(db, song.pcoSongId)
                            : null;
                    throw new Refused(
                        problem(
                            linked.reason,
                            null,
                            linked.message,
                            holder && { kind: "song", ...holder }
                        )
                    );
                }
            }
            return { ok: true, songId };
        });
    } catch (error) {
        if (error instanceof Refused) {
            return { ok: false, problems: [error.problem] };
        }
        throw error;
    }
}
