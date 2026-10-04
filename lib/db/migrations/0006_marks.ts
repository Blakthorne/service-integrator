import type { Migration } from ".";

/**
 * The "to learn" shelf, and what editing the catalog's books needs.
 *
 * - `song_marks`: a mark a person has put on a catalog song, such as
 *   'to-learn' (a song to introduce), with an optional note and when it was
 *   made. A song has each mark once. `mark` is checked in TypeScript
 *   (`SONG_MARKS` in lib/db/marks.ts), like every enumeration, and readers
 *   skip a mark a newer build wrote. A blank note is stored as null, never
 *   as "". Marks go when their song does; a merge moves them first.
 * - `entries_book_position`: an unnumbered book holds each position once,
 *   so its order is never ambiguous. Moving an entry renumbers the book's
 *   positions, keeping them 1, 2, 3, … (lib/db/catalogEdit.ts).
 *
 * Timestamps are ISO 8601 UTC text, which sorts by time.
 */
const migration: Migration = {
    id: "0006_marks",
    sql: `
        CREATE TABLE song_marks (
            song_id INTEGER NOT NULL REFERENCES songs (id) ON DELETE CASCADE,
            mark TEXT NOT NULL,
            note TEXT CHECK (note <> ''),
            created_at TEXT NOT NULL,
            PRIMARY KEY (song_id, mark)
        ) STRICT;

        CREATE INDEX song_marks_mark ON song_marks (mark);

        CREATE UNIQUE INDEX entries_book_position ON entries (book_id, position)
            WHERE position IS NOT NULL;
    `,
};

export default migration;
