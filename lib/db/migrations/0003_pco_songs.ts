import type { Migration } from ".";

/**
 * The mirror of the Planning Center song library, refreshed by the
 * `pco-songs` sync (lib/queries/sync.ts) and by a link made from a page.
 *
 * - `id` is the Planning Center song's id. It goes into request paths and
 *   links, so a CHECK holds it to what `parsePcoId` accepts: a positive
 *   decimal integer of at most 20 digits, with no leading zero.
 * - `title` to `updated_at` are Planning Center's values. `last_scheduled_at`
 *   is org-local time labelled `Z`, and counts upcoming plans too;
 *   `created_at` and `updated_at` are Planning Center's own. `hidden` is 0
 *   or 1.
 * - `synced_at`: when a sync, or a link made from a page, last read it.
 * - `removed_at`: when a complete listing no longer had it (it was deleted
 *   in Planning Center); cleared if it comes back. Rows are never deleted, so
 *   a link never points at nothing.
 * - `ignored_at`: Reconcile's Ignore, for a song that is not hymnal material.
 * - `auto_link_blocked_at`: set when an auto-link of the song is undone, so
 *   that the next sync does not make it again; a manual link still can.
 *
 * `songs.pco_song_id` has no foreign key to `id`, because SQLite cannot add
 * one without rebuilding `songs`: the link functions in lib/db/links.ts keep
 * the two consistent.
 */
const migration: Migration = {
    id: "0003_pco_songs",
    sql: `
        CREATE TABLE pco_songs (
            id TEXT PRIMARY KEY CHECK (
                length(id) BETWEEN 1 AND 20
                AND id GLOB '[1-9]*'
                AND id NOT GLOB '*[^0-9]*'
            ),
            title TEXT NOT NULL,
            author TEXT,
            copyright TEXT,
            ccli_number INTEGER,
            admin TEXT,
            themes TEXT,
            hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
            last_scheduled_at TEXT,
            created_at TEXT,
            updated_at TEXT,
            synced_at TEXT NOT NULL,
            removed_at TEXT,
            ignored_at TEXT,
            auto_link_blocked_at TEXT
        ) STRICT;
    `,
};

export default migration;
