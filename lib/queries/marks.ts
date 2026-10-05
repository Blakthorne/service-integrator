import "server-only";
import { getDb } from "@/lib/db";
import {
    findSongMarks,
    listMarkedSongIds,
    markSong,
    unmarkSong,
    type MarkResult,
} from "@/lib/db/marks";
import type { SongMark, SongMarkKind } from "@/lib/domain";

export type { MarkResult } from "@/lib/db/marks";

/**
 * The marks a person puts on catalog songs, such as "to-learn" for the "to
 * learn" shelf: the song page's Mark and Unmark, and the reads behind them.
 * Synchronous, like the database. A refusal (no such song) comes back as a
 * value with a message fit to show; a database that cannot be opened
 * throws. Each function takes a song id `parseCatalogId` already checked and
 * a mark `isSongMarkKind` did (convention 19).
 */

/**
 * Put `mark` on catalog song `songId`, with `note` (null or blank for
 * none). A song already marked keeps when it was marked and takes the new
 * note.
 */
export function markCatalogSong(
    songId: number,
    mark: SongMarkKind,
    note: string | null,
    now: Date = new Date()
): MarkResult {
    return markSong(getDb(), songId, mark, note, now);
}

/** Take `mark` off catalog song `songId`; `changed` is false when it did not have it. */
export function unmarkCatalogSong(songId: number, mark: SongMarkKind): MarkResult {
    return unmarkSong(getDb(), songId, mark);
}

/** Catalog song `songId`'s marks, with their notes. */
export function getSongMarks(songId: number): SongMark[] {
    return findSongMarks(getDb(), songId);
}

/** The ids of the catalog songs that have `mark`, in id order. */
export function getMarkedSongIds(mark: SongMarkKind): number[] {
    return listMarkedSongIds(getDb(), mark);
}
