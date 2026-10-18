import type { Migration } from ".";

/**
 * The requests to label songs' authors in Planning Center
 * (`credit_label_requests`; see lib/creditLabels.ts).
 *
 * A row is one request to write `author`, a label in the credits
 * convention, over a song whose author was `shown_author` ("" for none)
 * when the request was made: by a person on the Credits page (`source`
 * 'review') or by the app for a new song ('auto'). The credit labels job
 * writes the waiting ones in order, and a request then ends: `finished_at`
 * and `outcome` are set together, and both are null while it waits. A song
 * has at most one request waiting (`credit_label_requests_waiting`), and
 * the ended ones stay, as the record of what was asked and how it went: the
 * app labels a new song by itself at most once, which it knows from them.
 *
 * `source` and `outcome` are checked in TypeScript (lib/db/creditLabels.ts),
 * like every enumeration, and readers skip values a newer build wrote.
 * `attempts` counts the writes that failed and were put off to try again.
 * A request belongs to a mirrored song, whose rows are never deleted.
 *
 * Timestamps are ISO 8601 UTC text, which sorts by time.
 */
const migration: Migration = {
    id: "0008_credit_labels",
    sql: `
        CREATE TABLE credit_label_requests (
            id INTEGER PRIMARY KEY,
            pco_song_id TEXT NOT NULL REFERENCES pco_songs (id),
            source TEXT NOT NULL,
            shown_author TEXT NOT NULL,
            author TEXT NOT NULL CHECK (author <> ''),
            requested_at TEXT NOT NULL,
            attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
            finished_at TEXT,
            outcome TEXT,
            message TEXT,
            CHECK ((finished_at IS NULL) = (outcome IS NULL))
        ) STRICT;

        CREATE UNIQUE INDEX credit_label_requests_waiting ON credit_label_requests (pco_song_id)
            WHERE finished_at IS NULL;

        CREATE INDEX credit_label_requests_song ON credit_label_requests (pco_song_id, source);
    `,
};

export default migration;
