import type { SongMarkKind } from "@/lib/domain";

/**
 * The marks a person can put on a catalog song, such as "to-learn" for the
 * "to learn" shelf (songs to introduce), and their words. Pure and safe on
 * both sides: the database checks marks against `SONG_MARKS` (a CHECK would
 * need a migration for every new mark), the songs list filters by them and
 * the forms read them.
 */

/** Every mark this build knows, in the order a song's marks are listed. */
export const SONG_MARKS: readonly SongMarkKind[] = ["to-learn"];

/** Whether `value` is a mark this build knows. */
export function isSongMarkKind(value: unknown): value is SongMarkKind {
    return (SONG_MARKS as readonly unknown[]).includes(value);
}

/** What each mark is called, as a badge or a column says it. */
export const SONG_MARK_LABELS: Record<SongMarkKind, string> = { "to-learn": "To learn" };

/** Marks in the order of `SONG_MARKS`, each once, leaving out any this build does not know. */
export function sortSongMarks(marks: readonly unknown[]): SongMarkKind[] {
    return SONG_MARKS.filter((mark) => marks.includes(mark));
}
