import type { Migration } from ".";

/**
 * When each mirrored song's tags were last written into the tag mirror
 * (`pco_song_tags_written`): one row per song, none for a song whose tags
 * have never been written. The tags sync writes every song's tags from its
 * listing, and a save of one song's tags (the song page's Tags card) writes
 * that song's.
 *
 * The sync reads Planning Center for a while before it writes, so a save
 * can land in between. The sync then leaves as it was every song whose tags
 * were written after its listing began, since what its listing says of them
 * may be older than what was saved (`replaceListedSongTags` in
 * lib/db/tags.ts), as the song sync does with `pco_songs.synced_at`.
 *
 * `written_at` is ISO 8601 UTC. A foreign key holds each row to a mirrored
 * song, and deleting the song deletes its row.
 */
const migration: Migration = {
    id: "0006_song_tags_written",
    sql: `
        CREATE TABLE pco_song_tags_written (
            pco_song_id TEXT PRIMARY KEY REFERENCES pco_songs (id) ON DELETE CASCADE,
            written_at TEXT NOT NULL
        ) STRICT;
    `,
};

export default migration;
