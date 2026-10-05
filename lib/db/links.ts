import "server-only";
import type { DatabaseSync, SQLOutputValue } from "node:sqlite";
import type { SongLinkSource } from "@/lib/domain";
import type { AutoLinkChoice } from "@/lib/reconcile";
import { songLabelOf } from "./catalog";
import { markPcoSongAutoLinkBlocked } from "./pcoSongs";
import { withTransaction } from "./transaction";

/**
 * The one place links between catalog songs and Planning Center songs change
 * (`songs.pco_song_id`, `linked_at`, `linked_by`): by hand from a page, and
 * by a sync's auto-links. A Planning Center song links to at most one catalog
 * song and a catalog song to at most one Planning Center song, so a link that
 * would take a song already linked elsewhere is refused, never moved. A
 * refusal is a value with a message fit to show, not a throw. A link always
 * points at a song of the mirror (`pco_songs`): there is no foreign key to
 * say so, so `linkSong` checks.
 */

/** Why a link or an unlink was refused. */
export type LinkRefusalReason =
    /** There is no such catalog song. */
    | "song-not-found"
    /** There is no such Planning Center song (the mirror lacks it). */
    | "pco-song-not-found"
    /** The Planning Center song has been deleted from Planning Center. */
    | "pco-song-removed"
    /** The catalog song is linked to another Planning Center song. */
    | "song-linked"
    /** The Planning Center song is linked to another catalog song. */
    | "pco-song-linked"
    /** Unlink: the catalog song is not linked, or not to the Planning Center song given. */
    | "not-linked";

/** A link or unlink that was refused, with a message fit to show. */
export interface LinkRefusal {
    ok: false;
    reason: LinkRefusalReason;
    message: string;
}

/** What `linkSong` did: `changed` is false when the two were already linked. */
export type LinkResult = { ok: true; changed: boolean } | LinkRefusal;

/** What `unlinkSong` did: the Planning Center song the catalog song was linked to. */
export type UnlinkResult = { ok: true; pcoSongId: string } | LinkRefusal;

/** A refusal. */
export function linkRefusal(reason: LinkRefusalReason, message: string): LinkRefusal {
    return { ok: false, reason, message };
}

function nullableText(value: SQLOutputValue): string | null {
    return value === null ? null : String(value);
}

/** The FROM clause that gives a song (`s`) its hymn's title (`h`) and tune's name (`t`). */
const SONG_WITH_NAMES = `songs s
     JOIN hymns h ON h.id = s.hymn_id
     LEFT JOIN tunes t ON t.id = s.tune_id`;

/** A catalog song's label and link, or null when there is no such song. */
function findSongLink(
    db: DatabaseSync,
    songId: number
): { label: string; pcoSongId: string | null } | null {
    const row = db
        .prepare(
            `SELECT s.pco_song_id, h.title, t.name AS tune_name FROM ${SONG_WITH_NAMES} WHERE s.id = ?`
        )
        .get(songId);
    return row
        ? {
              label: songLabelOf(String(row.title), nullableText(row.tune_name)),
              pcoSongId: nullableText(row.pco_song_id),
          }
        : null;
}

/** "the Planning Center song "Amazing Grace"", or its id when the mirror lacks it. */
function describePcoSong(db: DatabaseSync, pcoSongId: string): string {
    const row = db.prepare("SELECT title FROM pco_songs WHERE id = ?").get(pcoSongId);
    return row
        ? `the Planning Center song "${String(row.title)}"`
        : `Planning Center song ${pcoSongId}`;
}

/** The catalog song linked to a Planning Center song, as its id and label, or null. */
export function findLinkedSong(
    db: DatabaseSync,
    pcoSongId: string
): { songId: number; label: string } | null {
    const row = db
        .prepare(
            `SELECT s.id, h.title, t.name AS tune_name FROM ${SONG_WITH_NAMES} WHERE s.pco_song_id = ?`
        )
        .get(pcoSongId);
    return row
        ? {
              songId: Number(row.id),
              label: songLabelOf(String(row.title), nullableText(row.tune_name)),
          }
        : null;
}

/**
 * Link catalog song `songId` to Planning Center song `pcoSongId`, made `by`
 * a person ("manual") or a sync ("auto"), at `now`, in one transaction. The
 * Planning Center song comes off the ignored list: linking it says it is
 * hymnal material. A link that is already there is left as it was
 * (`changed: false`).
 *
 * Refused when the catalog song does not exist, the mirror lacks the
 * Planning Center song or marks it removed, or either song is already linked
 * to another: a link is never moved.
 */
export function linkSong(
    db: DatabaseSync,
    songId: number,
    pcoSongId: string,
    by: SongLinkSource,
    now: Date = new Date()
): LinkResult {
    return withTransaction(db, (): LinkResult => {
        const song = findSongLink(db, songId);
        if (!song) {
            return linkRefusal("song-not-found", "There is no such catalog song.");
        }
        if (song.pcoSongId === pcoSongId) {
            return { ok: true, changed: false };
        }
        const pcoSong = db
            .prepare("SELECT title, removed_at FROM pco_songs WHERE id = ?")
            .get(pcoSongId);
        if (!pcoSong) {
            return linkRefusal("pco-song-not-found", "There is no such Planning Center song.");
        }
        const pcoTitle = String(pcoSong.title);
        if (pcoSong.removed_at !== null) {
            return linkRefusal(
                "pco-song-removed",
                `The Planning Center song "${pcoTitle}" has been deleted from Planning Center.`
            );
        }
        if (song.pcoSongId !== null) {
            return linkRefusal(
                "song-linked",
                `"${song.label}" is already linked to ${describePcoSong(db, song.pcoSongId)}. Undo that link first.`
            );
        }
        const holder = findLinkedSong(db, pcoSongId);
        if (holder) {
            return linkRefusal(
                "pco-song-linked",
                `The Planning Center song "${pcoTitle}" is already linked to "${holder.label}". Undo that link first.`
            );
        }
        db.prepare(
            "UPDATE songs SET pco_song_id = ?, linked_at = ?, linked_by = ? WHERE id = ?"
        ).run(pcoSongId, now.toISOString(), by, songId);
        db.prepare("UPDATE pco_songs SET ignored_at = NULL WHERE id = ?").run(pcoSongId);
        return { ok: true, changed: true };
    });
}

/** Options for `unlinkSong`. */
export interface UnlinkOptions {
    /**
     * Refuse unless the catalog song is linked to this Planning Center song:
     * the page that asked may show a link that has changed since.
     */
    pcoSongId?: string;
    /**
     * Also stop syncs from auto-linking the Planning Center song again, as
     * undoing an auto-link does. Without it, the next sync may link the two
     * again.
     */
    blockAutoLink?: boolean;
}

/**
 * Remove catalog song `songId`'s link, at `now`, in one transaction, and
 * return the Planning Center song it was linked to. Refused when there is no
 * such song, or it is not linked (to `pcoSongId`, when given).
 */
export function unlinkSong(
    db: DatabaseSync,
    songId: number,
    { pcoSongId, blockAutoLink = false }: UnlinkOptions = {},
    now: Date = new Date()
): UnlinkResult {
    return withTransaction(db, (): UnlinkResult => {
        const song = findSongLink(db, songId);
        if (!song) {
            return linkRefusal("song-not-found", "There is no such catalog song.");
        }
        if (song.pcoSongId === null) {
            return linkRefusal(
                "not-linked",
                `"${song.label}" is not linked to a Planning Center song.`
            );
        }
        if (pcoSongId !== undefined && song.pcoSongId !== pcoSongId) {
            return linkRefusal(
                "not-linked",
                `"${song.label}" is not linked to ${describePcoSong(db, pcoSongId)}.`
            );
        }
        db.prepare(
            "UPDATE songs SET pco_song_id = NULL, linked_at = NULL, linked_by = NULL WHERE id = ?"
        ).run(songId);
        if (blockAutoLink) {
            markPcoSongAutoLinkBlocked(db, song.pcoSongId, now);
        }
        return { ok: true, pcoSongId: song.pcoSongId };
    });
}

/**
 * Make a sync's auto-links (see `chooseAutoLinks`) at `now`, as
 * `linked_by = 'auto'`, all in one transaction. A choice that `linkSong`
 * refuses, because a song changed since it was chosen, is skipped. Returns
 * how many links it made.
 */
export function applyAutoLinks(
    db: DatabaseSync,
    choices: readonly AutoLinkChoice[],
    now: Date = new Date()
): number {
    return withTransaction(db, () => {
        let made = 0;
        for (const { songId, pcoSongId } of choices) {
            const result = linkSong(db, songId, pcoSongId, "auto", now);
            if (result.ok && result.changed) {
                made += 1;
            }
        }
        return made;
    });
}

/** An auto-link that still stands, as Reconcile lists it for review. */
export interface AutoLinkRow {
    /** The catalog song's id. */
    songId: number;
    /** Its hymn's title. */
    title: string;
    /** Its tune's name; null when the tune is unknown. */
    tuneName: string | null;
    pcoSongId: string;
    /** The Planning Center song's title; null when the mirror lacks it. */
    pcoTitle: string | null;
    linkedAt: string;
}

/**
 * The auto-links made at or after `since` that still stand, newest first
 * (the links of one sync by title). One query.
 */
export function listAutoLinks(db: DatabaseSync, since: Date): AutoLinkRow[] {
    return db
        .prepare(
            `SELECT s.id, s.pco_song_id, s.linked_at, h.title, t.name AS tune_name,
                    p.title AS pco_title
             FROM ${SONG_WITH_NAMES}
             LEFT JOIN pco_songs p ON p.id = s.pco_song_id
             WHERE s.linked_by = 'auto' AND s.pco_song_id IS NOT NULL AND s.linked_at >= ?
             ORDER BY s.linked_at DESC, h.title COLLATE NOCASE, s.id`
        )
        .all(since.toISOString())
        .map((row) => ({
            songId: Number(row.id),
            title: String(row.title),
            tuneName: nullableText(row.tune_name),
            pcoSongId: String(row.pco_song_id),
            pcoTitle: nullableText(row.pco_title),
            linkedAt: String(row.linked_at),
        }));
}
