import "server-only";
import type { DatabaseSync, SQLOutputValue } from "node:sqlite";
import type { MirroredPcoSong, PcoLibrarySong } from "@/lib/domain";
import { withTransaction } from "./transaction";

/**
 * The mirror of the Planning Center song library (`pco_songs`): the sync's
 * upsert of a complete listing, the marks Reconcile sets, and the reads.
 * Rows are never deleted, so a link never points at nothing: a song gone from
 * Planning Center is marked removed, and unmarked if it comes back. Links
 * themselves change only through lib/db/links.ts.
 */

type Row = Record<string, SQLOutputValue>;

/** The columns Planning Center's fields are stored in, in `libraryFields` order. */
const LIBRARY_COLUMNS = [
    "title",
    "author",
    "copyright",
    "ccli_number",
    "admin",
    "themes",
    "hidden",
    "last_scheduled_at",
    "created_at",
    "updated_at",
] as const;

/** What `toMirroredPcoSong` reads from `pco_songs p`. */
const COLUMNS = [
    "id",
    ...LIBRARY_COLUMNS,
    "synced_at",
    "removed_at",
    "ignored_at",
    "auto_link_blocked_at",
]
    .map((column) => `p.${column}`)
    .join(", ");

/** By title without regard to case, then id: the order every list of the mirror uses. */
const BY_TITLE = "p.title COLLATE NOCASE, p.id";

function nullableText(value: SQLOutputValue): string | null {
    return value === null ? null : String(value);
}

function toMirroredPcoSong(row: Row): MirroredPcoSong {
    return {
        id: String(row.id),
        title: String(row.title),
        author: nullableText(row.author),
        copyright: nullableText(row.copyright),
        ccliNumber: row.ccli_number === null ? null : Number(row.ccli_number),
        admin: nullableText(row.admin),
        themes: nullableText(row.themes),
        hidden: row.hidden === 1,
        lastScheduledAt: nullableText(row.last_scheduled_at),
        createdAt: nullableText(row.created_at),
        updatedAt: nullableText(row.updated_at),
        syncedAt: String(row.synced_at),
        removedAt: nullableText(row.removed_at),
        ignoredAt: nullableText(row.ignored_at),
        autoLinkBlockedAt: nullableText(row.auto_link_blocked_at),
    };
}

/** A song's Planning Center fields as stored, in `LIBRARY_COLUMNS` order. */
function libraryFields(song: PcoLibrarySong): (string | number | null)[] {
    return [
        song.title,
        song.author,
        song.copyright,
        song.ccliNumber,
        song.admin,
        song.themes,
        song.hidden ? 1 : 0,
        song.lastScheduledAt,
        song.createdAt,
        song.updatedAt,
    ];
}

/** What `upsertPcoSongs` did. */
export interface PcoSongUpsert {
    /** Songs the mirror did not have. */
    added: number;
    /** Songs it had whose Planning Center fields changed, or that came back after being removed. */
    updated: number;
}

/**
 * Store songs read from Planning Center, at `now`: add the ones the mirror
 * lacks, and give the others their current fields. Every song given gets
 * `synced_at = now` and loses any `removed_at`, since Planning Center has it.
 * Ignored and blocked marks stay. One transaction.
 */
export function upsertPcoSongs(
    db: DatabaseSync,
    songs: readonly PcoLibrarySong[],
    now: Date = new Date()
): PcoSongUpsert {
    return withTransaction(db, () => {
        const syncedAt = now.toISOString();
        const stored = db.prepare(
            `SELECT ${LIBRARY_COLUMNS.join(", ")}, removed_at FROM pco_songs WHERE id = ?`
        );
        const upsert = db.prepare(
            `INSERT INTO pco_songs (id, ${LIBRARY_COLUMNS.join(", ")}, synced_at)
             VALUES (?, ${LIBRARY_COLUMNS.map(() => "?").join(", ")}, ?)
             ON CONFLICT (id) DO UPDATE SET
                 ${LIBRARY_COLUMNS.map((column) => `${column} = excluded.${column}`).join(", ")},
                 synced_at = excluded.synced_at,
                 removed_at = NULL`
        );
        let added = 0;
        let updated = 0;
        for (const song of songs) {
            const fields = libraryFields(song);
            const before = stored.get(song.id);
            if (!before) {
                added += 1;
            } else if (
                before.removed_at !== null ||
                LIBRARY_COLUMNS.some((column, i) => before[column] !== fields[i])
            ) {
                updated += 1;
            }
            upsert.run(song.id, ...fields, syncedAt);
        }
        return { added, updated };
    });
}

/**
 * Mark removed, at `now`, every song not in `listedIds`, the ids of a
 * *complete* listing of the library that began at `listingStartedAt`:
 * Planning Center no longer has them. Only a song the mirror last read
 * before the listing began is marked. One read since then (a link made from
 * a page mirrors a song while a sync's listing is being read) may have been
 * created after the listing passed it, so its absence proves nothing. Only
 * call it with a whole listing, never with part of one. Songs already marked
 * keep their first `removed_at`. Returns how many it marked.
 */
export function markMissingPcoSongsRemoved(
    db: DatabaseSync,
    listedIds: readonly string[],
    listingStartedAt: Date,
    now: Date = new Date()
): number {
    const { changes } = db
        .prepare(
            `UPDATE pco_songs SET removed_at = ?
             WHERE removed_at IS NULL
               AND synced_at < ?
               AND id NOT IN (SELECT value FROM json_each(?))`
        )
        .run(now.toISOString(), listingStartedAt.toISOString(), JSON.stringify(listedIds));
    return Number(changes);
}

/**
 * Set a song aside as not hymnal material (Reconcile's Ignore), at `now`; a
 * song already ignored keeps its first time. False when the mirror has no
 * such song.
 */
export function markPcoSongIgnored(
    db: DatabaseSync,
    id: string,
    now: Date = new Date()
): boolean {
    const { changes } = db
        .prepare("UPDATE pco_songs SET ignored_at = coalesce(ignored_at, ?) WHERE id = ?")
        .run(now.toISOString(), id);
    return Number(changes) > 0;
}

/** Take a song off the ignored list (Unignore). False when the mirror has no such song. */
export function clearPcoSongIgnored(db: DatabaseSync, id: string): boolean {
    const { changes } = db
        .prepare("UPDATE pco_songs SET ignored_at = NULL WHERE id = ?")
        .run(id);
    return Number(changes) > 0;
}

/**
 * Stop syncs from auto-linking a song, at `now`, as undoing an auto-link
 * does; a song already blocked keeps its first time. A manual link still
 * works. False when the mirror has no such song.
 */
export function markPcoSongAutoLinkBlocked(
    db: DatabaseSync,
    id: string,
    now: Date = new Date()
): boolean {
    const { changes } = db
        .prepare(
            "UPDATE pco_songs SET auto_link_blocked_at = coalesce(auto_link_blocked_at, ?) WHERE id = ?"
        )
        .run(now.toISOString(), id);
    return Number(changes) > 0;
}

/** One song of the mirror, or null when it has no such song. */
export function findPcoSong(db: DatabaseSync, id: string): MirroredPcoSong | null {
    const row = db.prepare(`SELECT ${COLUMNS} FROM pco_songs p WHERE p.id = ?`).get(id);
    return row ? toMirroredPcoSong(row) : null;
}

/** The songs of the mirror with these ids, by id; ids it lacks are left out. One query. */
export function findPcoSongs(
    db: DatabaseSync,
    ids: readonly string[]
): Map<string, MirroredPcoSong> {
    const songs = new Map<string, MirroredPcoSong>();
    if (ids.length === 0) {
        return songs;
    }
    const rows = db
        .prepare(
            `SELECT ${COLUMNS} FROM pco_songs p WHERE p.id IN (SELECT value FROM json_each(?))`
        )
        .all(JSON.stringify(ids));
    for (const row of rows) {
        const song = toMirroredPcoSong(row);
        songs.set(song.id, song);
    }
    return songs;
}

/** Every song of the mirror, removed, ignored and linked ones included, by title. */
export function listPcoSongs(db: DatabaseSync): MirroredPcoSong[] {
    return db
        .prepare(`SELECT ${COLUMNS} FROM pco_songs p ORDER BY ${BY_TITLE}`)
        .all()
        .map(toMirroredPcoSong);
}

/**
 * The songs Reconcile asks about, by title: still in Planning Center, not
 * ignored, and linked to no catalog song.
 */
export function listUnlinkedPcoSongs(db: DatabaseSync): MirroredPcoSong[] {
    return db
        .prepare(
            `SELECT ${COLUMNS} FROM pco_songs p
             WHERE p.removed_at IS NULL
               AND p.ignored_at IS NULL
               AND NOT EXISTS (SELECT 1 FROM songs s WHERE s.pco_song_id = p.id)
             ORDER BY ${BY_TITLE}`
        )
        .all()
        .map(toMirroredPcoSong);
}

/** The songs set aside as not hymnal material that are still in Planning Center, by title. */
export function listIgnoredPcoSongs(db: DatabaseSync): MirroredPcoSong[] {
    return db
        .prepare(
            `SELECT ${COLUMNS} FROM pco_songs p
             WHERE p.ignored_at IS NOT NULL AND p.removed_at IS NULL
             ORDER BY ${BY_TITLE}`
        )
        .all()
        .map(toMirroredPcoSong);
}
