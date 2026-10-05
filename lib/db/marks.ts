import "server-only";
import type { DatabaseSync, SQLOutputValue } from "node:sqlite";
import { isSongMarkKind, SONG_MARKS } from "@/lib/catalog/marks";
import type { SongMark, SongMarkKind } from "@/lib/domain";
import { withTransaction } from "./transaction";

/**
 * The marks a person puts on catalog songs (`song_marks`), such as
 * "to-learn" for the "to learn" shelf. A song has each mark once, with an
 * optional note. The marks are checked here, against `SONG_MARKS`, rather
 * than by a CHECK, so a new mark needs no migration; readers skip a mark a
 * newer build wrote. A refusal is a value with a message fit to show.
 */

/** What marking or unmarking did: `changed` is false when the song was already as asked. */
export type MarkResult =
    | { ok: true; changed: boolean }
    | { ok: false; reason: "song-not-found"; message: string };

const SONG_NOT_FOUND: MarkResult = {
    ok: false,
    reason: "song-not-found",
    message: "There is no such catalog song.",
};

function songExists(db: DatabaseSync, songId: number): boolean {
    return db.prepare("SELECT 1 FROM songs WHERE id = ?").get(songId) !== undefined;
}

/** A blank note is no note. */
function noteOrNull(note: string | null): string | null {
    return note === null || note.trim() === "" ? null : note;
}

/**
 * Put `mark` on catalog song `songId` with `note` (null or blank for none),
 * at `now`. A song already marked keeps when it was marked and takes the
 * new note (`changed` is false when the note was already that). Refused when
 * there is no such song. Throws for a mark this build does not know: the
 * caller parses marks first.
 */
export function markSong(
    db: DatabaseSync,
    songId: number,
    mark: SongMarkKind,
    note: string | null,
    now: Date = new Date()
): MarkResult {
    if (!isSongMarkKind(mark)) {
        throw new Error(`Unknown song mark: ${String(mark)}`);
    }
    const stored = noteOrNull(note);
    return withTransaction(db, (): MarkResult => {
        if (!songExists(db, songId)) {
            return SONG_NOT_FOUND;
        }
        const existing = db
            .prepare("SELECT note FROM song_marks WHERE song_id = ? AND mark = ?")
            .get(songId, mark);
        if (existing && existing.note === stored) {
            return { ok: true, changed: false };
        }
        db.prepare(
            `INSERT INTO song_marks (song_id, mark, note, created_at) VALUES (?, ?, ?, ?)
             ON CONFLICT (song_id, mark) DO UPDATE SET note = excluded.note`
        ).run(songId, mark, stored, now.toISOString());
        return { ok: true, changed: true };
    });
}

/**
 * Take `mark` off catalog song `songId` (`changed` is false when it did not
 * have it). Refused when there is no such song.
 */
export function unmarkSong(db: DatabaseSync, songId: number, mark: SongMarkKind): MarkResult {
    return withTransaction(db, (): MarkResult => {
        if (!songExists(db, songId)) {
            return SONG_NOT_FOUND;
        }
        const { changes } = db
            .prepare("DELETE FROM song_marks WHERE song_id = ? AND mark = ?")
            .run(songId, mark);
        return { ok: true, changed: Number(changes) > 0 };
    });
}

/** Marks in the order of `SONG_MARKS`. */
function bySongMarkOrder(a: SongMark, b: SongMark): number {
    return SONG_MARKS.indexOf(a.mark) - SONG_MARKS.indexOf(b.mark);
}

/** A mark read as `{ mark, note, createdAt }`, or null when it is one this build does not know. */
function toSongMark(row: Record<string, unknown>): SongMark | null {
    if (!isSongMarkKind(row.mark)) {
        return null;
    }
    return {
        mark: row.mark,
        note: typeof row.note === "string" ? row.note : null,
        createdAt: String(row.createdAt),
    };
}

/**
 * The marks of a JSON array of `{ mark, note, createdAt }` objects, as a
 * query builds them with `json_group_array` (see `SONG_MARKS_JSON`), in the
 * order of `SONG_MARKS`, without those this build does not know.
 */
export function songMarksFromJson(json: SQLOutputValue): SongMark[] {
    const parsed: unknown = typeof json === "string" ? JSON.parse(json) : [];
    if (!Array.isArray(parsed)) {
        return [];
    }
    return parsed
        .flatMap((row) =>
            typeof row === "object" && row !== null ? (toSongMark(row) ?? []) : []
        )
        .sort(bySongMarkOrder);
}

/**
 * A column of the marks of song `s`, as JSON for `songMarksFromJson`: a
 * correlated subquery, so a read gets a song's marks without a query of its
 * own.
 */
export const SONG_MARKS_JSON = `(SELECT json_group_array(json_object('mark', m.mark, 'note', m.note, 'createdAt', m.created_at))
     FROM song_marks m WHERE m.song_id = s.id)`;

/** Catalog song `songId`'s marks, in the order of `SONG_MARKS`; empty for a song without any, or no such song. */
export function findSongMarks(db: DatabaseSync, songId: number): SongMark[] {
    return db
        .prepare(
            "SELECT mark, note, created_at AS createdAt FROM song_marks WHERE song_id = ? ORDER BY mark"
        )
        .all(songId)
        .flatMap((row) => toSongMark(row) ?? [])
        .sort(bySongMarkOrder);
}

/** The ids of the catalog songs that have `mark`, in id order. */
export function listMarkedSongIds(db: DatabaseSync, mark: SongMarkKind): number[] {
    return db
        .prepare("SELECT song_id FROM song_marks WHERE mark = ? ORDER BY song_id")
        .all(mark)
        .map((row) => Number(row.song_id));
}
