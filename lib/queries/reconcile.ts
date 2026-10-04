import "server-only";
import { getDb, withTransaction } from "@/lib/db";
import { listCatalogSongs } from "@/lib/db/catalog";
import {
    findLinkedSong,
    linkRefusal,
    linkSong,
    listAutoLinks,
    unlinkSong,
    type LinkRefusal,
    type LinkResult,
    type UnlinkResult,
} from "@/lib/db/links";
import {
    clearPcoSongIgnored,
    findPcoSong,
    listIgnoredPcoSongs,
    listUnlinkedPcoSongs,
    markPcoSongIgnored,
    upsertPcoSongs,
} from "@/lib/db/pcoSongs";
import { latestSyncRun, type SyncRun } from "@/lib/db/syncRuns";
import type {
    AutoLinkedSong,
    CatalogSongOption,
    MirroredPcoSong,
    PcoLibrarySong,
    UnlinkedPcoSong,
} from "@/lib/domain";
import { pcoSongsJob, runJob, type RunJobResult } from "@/lib/jobs";
import { PcoError, getSong, parsePcoId } from "@/lib/pco";
import { TOP_SUGGESTIONS, buildCatalogIndex, suggestLinks } from "@/lib/reconcile";

export type {
    LinkRefusal,
    LinkRefusalReason,
    LinkResult,
    UnlinkResult,
} from "@/lib/db/links";
export type { RunJobResult } from "@/lib/jobs";

/**
 * Linking catalog songs to Planning Center songs from the app's pages: what
 * Reconcile shows, and the changes Reconcile, the plan pages and the new song
 * form make. Reads are synchronous, like the database. A change that is
 * refused (a song linked elsewhere, one that does not exist) comes back as a
 * value with a message fit to show, never a throw; anything unexpected, such
 * as a database that cannot be opened or Planning Center failing, throws.
 * Each function takes IDs its caller has already parsed (convention 19) and
 * checks them again.
 */

/** How long an auto-link stays on Reconcile's list of recent ones. */
export const RECENT_AUTO_LINK_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** What Reconcile shows. */
export interface ReconcileData {
    /**
     * The Planning Center songs with no catalog song, still in Planning
     * Center and not ignored, by title, each with its best few suggestions.
     */
    unlinked: UnlinkedPcoSong[];
    /**
     * The auto-links made in the last `RECENT_AUTO_LINK_DAYS` days that still
     * stand, newest first, for review and Undo.
     */
    recentAutoLinks: AutoLinkedSong[];
    /** The songs set aside as not hymnal material that are still in Planning Center, by title. */
    ignored: MirroredPcoSong[];
    /** How many catalog songs have no Planning Center song (the songs list's `?linked=no`). */
    catalogSongsNotInPco: number;
    /** The latest run of the song sync, finished or not, or null before the first. */
    lastSync: SyncRun | null;
    /** Every catalog song, lean, for a picker: by title, then tune name (an unknown tune last). */
    catalogSongs: CatalogSongOption[];
}

/** Everything Reconcile shows, at `now`. A fixed number of queries. */
export function getReconcileData(now: Date = new Date()): ReconcileData {
    const db = getDb();
    const songs = listCatalogSongs(db);
    const index = buildCatalogIndex(songs);
    const since = new Date(now.getTime() - RECENT_AUTO_LINK_DAYS * DAY_MS);
    return {
        unlinked: listUnlinkedPcoSongs(db).map((pcoSong) => ({
            pcoSong,
            suggestions: suggestLinks(pcoSong, index).slice(0, TOP_SUGGESTIONS),
        })),
        recentAutoLinks: listAutoLinks(db, since).map(
            ({ songId, title, tuneName, pcoSongId, pcoTitle, linkedAt }) => ({
                songId,
                title,
                tuneName,
                entries: index.songs.get(songId)?.entries ?? [],
                pcoSongId,
                pcoTitle,
                linkedAt,
            })
        ),
        ignored: listIgnoredPcoSongs(db),
        catalogSongsNotInPco: songs.filter(({ pcoSongId }) => pcoSongId === null).length,
        lastSync: latestSyncRun(db, "pco-songs"),
        catalogSongs: songs.map((song) => ({
            songId: song.id,
            title: song.title,
            tuneName: song.tuneName,
            labels: song.entries.map(({ label }) => label),
            pcoSongId: song.pcoSongId,
        })),
    };
}

const NO_SUCH_PCO_SONG = "There is no such Planning Center song.";

/**
 * Make sure the mirror has Planning Center song `pcoSongId`: when it lacks
 * the song, read it from Planning Center (one request, unpaced: someone is
 * waiting) and store it, so that a link made before the first sync still
 * points at a mirrored song. True when the mirror has the song now; false
 * when the id is not a Planning Center id or Planning Center has no such
 * song. Any other failure throws.
 */
export async function mirrorPcoSong(
    pcoSongId: string,
    now: Date = new Date()
): Promise<boolean> {
    if (parsePcoId(pcoSongId) === null) {
        return false;
    }
    if (findPcoSong(getDb(), pcoSongId)) {
        return true;
    }
    let song: PcoLibrarySong;
    try {
        song = await getSong(pcoSongId);
    } catch (error) {
        if (error instanceof PcoError && error.status === 404) {
            return false;
        }
        throw error;
    }
    upsertPcoSongs(getDb(), [song], now);
    return true;
}

/**
 * Link catalog song `songId` to Planning Center song `pcoSongId` by hand
 * (`linked_by = 'manual'`), mirroring the Planning Center song first when
 * the mirror lacks it (see `mirrorPcoSong`). Refused, as `linkSong` refuses,
 * when either song does not exist or is already linked to another.
 */
export async function linkCatalogSong(
    songId: number,
    pcoSongId: string
): Promise<LinkResult> {
    if (!(await mirrorPcoSong(pcoSongId))) {
        return linkRefusal("pco-song-not-found", NO_SUCH_PCO_SONG);
    }
    return linkSong(getDb(), songId, pcoSongId, "manual");
}

/**
 * Undo an auto-link that Reconcile showed: unlink catalog song `songId` from
 * Planning Center song `pcoSongId`, and stop syncs from making that
 * Planning Center song's auto-link again (a manual link still can). Refused
 * when the catalog song is no longer linked to that song.
 */
export function undoAutoLink(songId: number, pcoSongId: string): UnlinkResult {
    return unlinkSong(getDb(), songId, { pcoSongId, blockAutoLink: true });
}

/** What ignoring or unignoring a Planning Center song did. */
export type IgnoreResult = { ok: true } | LinkRefusal;

/**
 * Set Planning Center song `pcoSongId` aside as not hymnal material
 * (Reconcile's Ignore): it leaves Reconcile's list, and plan pages suggest
 * nothing for it. Refused when the mirror lacks it, or it is linked to a
 * catalog song.
 */
export function ignorePcoSong(pcoSongId: string, now: Date = new Date()): IgnoreResult {
    const db = getDb();
    return withTransaction(db, (): IgnoreResult => {
        const song = findPcoSong(db, pcoSongId);
        if (!song) {
            return linkRefusal("pco-song-not-found", NO_SUCH_PCO_SONG);
        }
        const linked = findLinkedSong(db, pcoSongId);
        if (linked) {
            return linkRefusal(
                "pco-song-linked",
                `The Planning Center song "${song.title}" is linked to "${linked.label}", so it cannot be ignored. Undo that link first.`
            );
        }
        markPcoSongIgnored(db, pcoSongId, now);
        return { ok: true };
    });
}

/** Put an ignored Planning Center song back on Reconcile's list (Unignore). Refused when the mirror lacks it. */
export function unignorePcoSong(pcoSongId: string): IgnoreResult {
    return clearPcoSongIgnored(getDb(), pcoSongId)
        ? { ok: true }
        : linkRefusal("pco-song-not-found", NO_SUCH_PCO_SONG);
}

/**
 * "Sync now": run the song sync through `runJob`, so that a run already in
 * progress (the hourly one) is joined rather than doubled, and give that
 * run as recorded, with `ok` false and the reason when the sync failed; or
 * `run: null` and why, when no run could be recorded at all (the database
 * could not be opened or written). Never an older run, and never throws.
 */
export function syncPcoSongsNow(): Promise<RunJobResult> {
    return runJob(pcoSongsJob);
}
