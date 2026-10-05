import type { Migration } from ".";

/**
 * The song catalog: books, hymns, tunes, songs, the entries that place songs
 * in books, and the runs of the catalog imports.
 *
 * - `books`: a hymnal or other book. `code` ("R", "G", "CB") is unique without
 *   regard to case and is the book's URL segment, unencoded, so a CHECK holds
 *   it to what `parseBookCode` accepts: a letter, then up to 7 letters,
 *   digits, "_" or "-". `numbered` is 0 for a book ordered by position only,
 *   such as a chorus book. `label_format` is how an entry is labelled:
 *   `R-{n}`, or an unnumbered book's short name.
 * - `hymns` (the words) and `tunes` (the melodies). Titles and names are not
 *   unique: two texts can share a title. Their other spellings live in
 *   `hymn_aliases` and `tune_aliases`, whose `normalized` form is unique, and
 *   go when their hymn or tune does.
 * - `songs`: one hymn to one tune, the unit a Planning Center song links to.
 *   `tune_id` is null when the tune is unknown. A hymn has one song per tune,
 *   and at most one with no tune: SQLite treats NULLs as distinct, so the
 *   plain UNIQUE would allow two tune-less songs of one hymn, and the partial
 *   index `songs_hymn_without_tune` closes that gap. `linked_by` ('auto',
 *   'manual' or 'import') is checked in TypeScript, like every enumeration.
 * - `entries`: where a song appears in a book: a `number` (null or above 0),
 *   a `position` inside an unnumbered book, or a `location_label` such as
 *   "front cover"; a `variant_note` such as "Descant - last stanza only" is
 *   shown beside the label. A number appears once per book. A song appears
 *   once per book for each variant note, and once with none (the partial
 *   index `entries_book_song_without_variant`, for the same NULL reason).
 *   Entries do not cascade: a merge moves them explicitly.
 * - `import_runs`: a previewed import. `report` is what the review page shows;
 *   `rows` holds the planned rows, so applying writes exactly what was
 *   previewed. `kind` and `status` are checked in TypeScript.
 *
 * Timestamps are ISO 8601 UTC text, and JSON columns are checked with
 * `json_valid`.
 */
const migration: Migration = {
    id: "0002_catalog",
    sql: `
        CREATE TABLE books (
            id INTEGER PRIMARY KEY,
            code TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (
                length(code) BETWEEN 1 AND 8
                AND code GLOB '[A-Za-z]*'
                AND code NOT GLOB '*[^A-Za-z0-9_-]*'
            ),
            name TEXT NOT NULL,
            short_name TEXT NOT NULL,
            numbered INTEGER NOT NULL CHECK (numbered IN (0, 1)),
            label_format TEXT NOT NULL,
            sort_order INTEGER NOT NULL,
            active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
        ) STRICT;

        CREATE TABLE hymns (
            id INTEGER PRIMARY KEY,
            title TEXT NOT NULL,
            first_line TEXT,
            notes TEXT
        ) STRICT;

        CREATE TABLE hymn_aliases (
            id INTEGER PRIMARY KEY,
            hymn_id INTEGER NOT NULL REFERENCES hymns (id) ON DELETE CASCADE,
            alias TEXT NOT NULL,
            normalized TEXT NOT NULL UNIQUE
        ) STRICT;

        CREATE INDEX hymn_aliases_hymn_id ON hymn_aliases (hymn_id);

        CREATE TABLE tunes (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            meter TEXT,
            notes TEXT
        ) STRICT;

        CREATE TABLE tune_aliases (
            id INTEGER PRIMARY KEY,
            tune_id INTEGER NOT NULL REFERENCES tunes (id) ON DELETE CASCADE,
            alias TEXT NOT NULL,
            normalized TEXT NOT NULL UNIQUE
        ) STRICT;

        CREATE INDEX tune_aliases_tune_id ON tune_aliases (tune_id);

        CREATE TABLE songs (
            id INTEGER PRIMARY KEY,
            hymn_id INTEGER NOT NULL REFERENCES hymns (id),
            tune_id INTEGER REFERENCES tunes (id),
            pco_song_id TEXT UNIQUE,
            linked_at TEXT,
            linked_by TEXT,
            notes TEXT,
            UNIQUE (hymn_id, tune_id)
        ) STRICT;

        CREATE UNIQUE INDEX songs_hymn_without_tune ON songs (hymn_id)
            WHERE tune_id IS NULL;

        CREATE INDEX songs_tune_id ON songs (tune_id);

        CREATE TABLE entries (
            id INTEGER PRIMARY KEY,
            book_id INTEGER NOT NULL REFERENCES books (id),
            song_id INTEGER NOT NULL REFERENCES songs (id),
            number INTEGER CHECK (number IS NULL OR number > 0),
            position INTEGER,
            location_label TEXT,
            variant_note TEXT,
            UNIQUE (book_id, number),
            UNIQUE (book_id, song_id, variant_note)
        ) STRICT;

        CREATE UNIQUE INDEX entries_book_song_without_variant
            ON entries (book_id, song_id) WHERE variant_note IS NULL;

        CREATE INDEX entries_song_id ON entries (song_id);

        CREATE TABLE import_runs (
            id INTEGER PRIMARY KEY,
            at TEXT NOT NULL,
            kind TEXT NOT NULL,
            book_id INTEGER REFERENCES books (id) ON DELETE SET NULL,
            status TEXT NOT NULL,
            source_name TEXT NOT NULL,
            report TEXT NOT NULL CHECK (json_valid(report)),
            rows TEXT NOT NULL CHECK (json_valid(rows))
        ) STRICT;
    `,
};

export default migration;
