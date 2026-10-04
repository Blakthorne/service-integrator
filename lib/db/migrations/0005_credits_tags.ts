import type { Migration } from ".";

/**
 * The credits each mirrored Planning Center song's author reads as, and the
 * mirror of Planning Center's song tags.
 *
 * - `pco_song_credits`: what a song's `author` field says about who wrote
 *   its words and music (and arranged or translated it), as lib/credits.ts
 *   reads it: one row for each name of each role, in `position` order
 *   (0, 1, …), so `Words: Isaac Watts; Music: Lowell Mason` is two rows.
 *   The rows are derived from the mirror on every sync and every credit
 *   save, and never edited directly. `parse_status` is how the author read,
 *   the same on all of a song's rows: 'ok' (the labelled convention),
 *   'legacy' (no labels at all, read the way the copyright text always
 *   read it) or 'unparsed' (labels that do not parse). It is checked in
 *   TypeScript (`CREDIT_PARSE_STATUSES` in lib/db/credits.ts), like every
 *   enumeration. A song whose author names nobody (an empty author, or one
 *   that does not parse) has a single row with neither role nor name, which
 *   holds its parse status, so every song whose author has been read has at
 *   least one row.
 * - `pco_tag_groups`: Planning Center's tag groups for songs (`tags_for`
 *   'song'; arrangement groups are not mirrored), with `allow_multiple`
 *   (0 or 1): whether a song may have several of the group's tags.
 * - `pco_tags`: each group's tags. `pco_song_tags`: which mirrored songs
 *   have each tag. Deleting a group deletes its tags, and deleting a tag
 *   takes it off every song.
 *
 * Ids are Planning Center's: a CHECK holds a group's and a tag's to what
 * `parsePcoId` accepts, as for `pco_songs`, and foreign keys hold the rest
 * to rows that exist, so credits and song tags belong to mirrored songs.
 */
const migration: Migration = {
    id: "0005_credits_tags",
    sql: `
        CREATE TABLE pco_song_credits (
            pco_song_id TEXT NOT NULL REFERENCES pco_songs (id) ON DELETE CASCADE,
            role TEXT CHECK (role <> ''),
            name TEXT CHECK (name <> ''),
            position INTEGER NOT NULL CHECK (position >= 0),
            parse_status TEXT NOT NULL,
            PRIMARY KEY (pco_song_id, position),
            CHECK ((role IS NULL) = (name IS NULL))
        ) STRICT;

        CREATE TABLE pco_tag_groups (
            id TEXT PRIMARY KEY CHECK (
                length(id) BETWEEN 1 AND 20
                AND id GLOB '[1-9]*'
                AND id NOT GLOB '*[^0-9]*'
            ),
            name TEXT NOT NULL,
            tags_for TEXT NOT NULL,
            allow_multiple INTEGER NOT NULL CHECK (allow_multiple IN (0, 1))
        ) STRICT;

        CREATE TABLE pco_tags (
            id TEXT PRIMARY KEY CHECK (
                length(id) BETWEEN 1 AND 20
                AND id GLOB '[1-9]*'
                AND id NOT GLOB '*[^0-9]*'
            ),
            group_id TEXT NOT NULL REFERENCES pco_tag_groups (id) ON DELETE CASCADE,
            name TEXT NOT NULL
        ) STRICT;

        CREATE INDEX pco_tags_group_id ON pco_tags (group_id);

        CREATE TABLE pco_song_tags (
            pco_song_id TEXT NOT NULL REFERENCES pco_songs (id) ON DELETE CASCADE,
            tag_id TEXT NOT NULL REFERENCES pco_tags (id) ON DELETE CASCADE,
            PRIMARY KEY (pco_song_id, tag_id)
        ) STRICT;

        CREATE INDEX pco_song_tags_tag_id ON pco_song_tags (tag_id);
    `,
};

export default migration;
