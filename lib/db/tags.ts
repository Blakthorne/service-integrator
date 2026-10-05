import "server-only";
import type { DatabaseSync, SQLOutputValue } from "node:sqlite";
import type { PcoTag, PcoTagGroup } from "@/lib/domain";
import { withTransaction } from "./transaction";

/**
 * The mirror of Planning Center's song tags: the tag groups whose tags are
 * for songs (`pco_tag_groups`, `tags_for` "song"), their tags (`pco_tags`)
 * and which mirrored songs have each tag (`pco_song_tags`). The tags job
 * (lib/queries/tags.ts) replaces the groups and tags from a complete listing
 * and every song's tags from Planning Center's list of each tag's songs; a
 * song's own tags are replaced when the app assigns them. Reads leave out
 * any group whose tags are not for songs.
 *
 * Each write of a song's tags records when it was made
 * (`pco_song_tags_written`), so that a sync never puts back, from a listing
 * it began reading earlier, the tags a save wrote while it read.
 *
 * A song the mirror does not have yet is never given a tag (the table's
 * foreign keys hold song tags to mirrored songs): it gets its tags from the
 * first tags sync after the song sync mirrors it.
 */

type Row = Record<string, SQLOutputValue>;

/** What every group and tag the reads give is for. */
const SONG_TAGS = "song";

/** Groups by name without regard to case, then id; the same for tags within a group. */
const GROUP_ORDER = "g.name COLLATE NOCASE, g.id";
const TAG_ORDER = "t.name COLLATE NOCASE, t.id";

/** What `replaceSongTagGroups` stored. */
export interface TagGroupsReplace {
    /** Song tag groups now mirrored. */
    groups: number;
    /** Their tags now mirrored. */
    tags: number;
}

/**
 * Replace the mirrored tag groups and tags with `groups`, a *complete*
 * listing of Planning Center's song tag groups with their tags, in one
 * transaction: each group and tag is added or given its current name (and a
 * group whether several of its tags may be chosen), a tag that moved to
 * another group follows it, and the groups and tags the listing no longer
 * has are deleted, which takes those tags off every song. A group whose
 * tags are not for songs is left out, as is a group or tag listed twice
 * (the first one counts). The songs that have each tag are kept until
 * `replaceTagSongs` replaces them. Throws, writing nothing, on an id that
 * is not a Planning Center id.
 */
export function replaceSongTagGroups(
    db: DatabaseSync,
    groups: readonly PcoTagGroup[]
): TagGroupsReplace {
    const groupIds = new Set<string>();
    const tagIds = new Set<string>();
    return withTransaction(db, () => {
        const upsertGroup = db.prepare(
            `INSERT INTO pco_tag_groups (id, name, tags_for, allow_multiple) VALUES (?, ?, ?, ?)
             ON CONFLICT (id) DO UPDATE SET
                 name = excluded.name,
                 tags_for = excluded.tags_for,
                 allow_multiple = excluded.allow_multiple`
        );
        const upsertTag = db.prepare(
            `INSERT INTO pco_tags (id, group_id, name) VALUES (?, ?, ?)
             ON CONFLICT (id) DO UPDATE SET group_id = excluded.group_id, name = excluded.name`
        );
        for (const group of groups) {
            if (group.tagsFor !== SONG_TAGS || groupIds.has(group.id)) {
                continue;
            }
            groupIds.add(group.id);
            upsertGroup.run(group.id, group.name, SONG_TAGS, group.allowMultiple ? 1 : 0);
            for (const tag of group.tags) {
                if (!tagIds.has(tag.id)) {
                    tagIds.add(tag.id);
                    upsertTag.run(tag.id, group.id, tag.name);
                }
            }
        }
        db.prepare("DELETE FROM pco_tags WHERE id NOT IN (SELECT value FROM json_each(?))").run(
            JSON.stringify([...tagIds])
        );
        db.prepare(
            "DELETE FROM pco_tag_groups WHERE id NOT IN (SELECT value FROM json_each(?))"
        ).run(JSON.stringify([...groupIds]));
        return { groups: groupIds.size, tags: tagIds.size };
    });
}

/** The end of an INSERT into `pco_song_tags_written`: a song's later write replaces its earlier one. */
const RECORD_WRITTEN = `ON CONFLICT (pco_song_id) DO UPDATE SET written_at = excluded.written_at`;

/** What `replaceListedSongTags` stored. */
export interface ListedSongTagsReplace {
    /** Song tags stored. */
    tagged: number;
    /** Song tags the listing gives songs the song mirror does not have yet, left out. */
    skipped: number;
    /** Songs whose tags were written after the listing began, left as they were. */
    kept: number;
}

/**
 * Replace every mirrored song's tags with what a complete listing gives
 * them, and record that they were written at `now`, in one transaction.
 * `songsByTag` is the songs Planning Center listed with each mirrored tag;
 * a tag it leaves out has none.
 *
 * The listing began at `listingStartedAt`, and Planning Center was read for
 * a while after that. A song whose tags were written after then (a save of
 * its tags, `replaceSongTags`) is left as it was, and counted as kept: what
 * the listing says of it may be older than what was saved, and the next
 * sync brings it up to date. One written at that moment or before is not:
 * the listing was read after the write, so it is the newer. A song the song mirror does not have
 * yet is left out and counted as skipped. Throws, writing nothing, when the
 * mirror does not have one of the tags.
 */
export function replaceListedSongTags(
    db: DatabaseSync,
    songsByTag: ReadonlyMap<string, readonly string[]>,
    listingStartedAt: Date,
    now: Date = new Date()
): ListedSongTagsReplace {
    return withTransaction(db, () => {
        const knownTag = db.prepare("SELECT 1 FROM pco_tags WHERE id = ?");
        for (const tagId of songsByTag.keys()) {
            if (!knownTag.get(tagId)) {
                throw new Error(`The tag mirror has no tag ${JSON.stringify(tagId)}`);
            }
        }
        const kept = JSON.stringify(
            db
                .prepare("SELECT pco_song_id FROM pco_song_tags_written WHERE written_at > ?")
                .all(listingStartedAt.toISOString())
                .map((row) => String(row.pco_song_id))
        );
        db.prepare(
            "DELETE FROM pco_song_tags WHERE pco_song_id NOT IN (SELECT value FROM json_each(?))"
        ).run(kept);
        const insert = db.prepare(
            `INSERT INTO pco_song_tags (pco_song_id, tag_id)
             SELECT p.id, ? FROM pco_songs p
             WHERE p.id IN (SELECT value FROM json_each(?))
               AND p.id NOT IN (SELECT value FROM json_each(?))`
        );
        const unmirrored = db.prepare(
            "SELECT count(*) AS n FROM json_each(?) WHERE value NOT IN (SELECT id FROM pco_songs)"
        );
        let tagged = 0;
        let skipped = 0;
        for (const [tagId, songIds] of songsByTag) {
            const ids = JSON.stringify([...new Set(songIds)]);
            tagged += Number(insert.run(tagId, ids, kept).changes);
            skipped += Number(unmirrored.get(ids)?.n);
        }
        db.prepare(
            `INSERT INTO pco_song_tags_written (pco_song_id, written_at)
             SELECT p.id, ? FROM pco_songs p WHERE p.id NOT IN (SELECT value FROM json_each(?))
             ${RECORD_WRITTEN}`
        ).run(now.toISOString(), kept);
        return { tagged, skipped, kept: (JSON.parse(kept) as string[]).length };
    });
}

/** What `replaceSongTags` stored. */
export interface SongTagsReplace {
    /** Song tags stored. */
    tagged: number;
    /** Ids given that the mirror does not have, so left out. */
    skipped: number;
}

/**
 * Replace mirrored song `pcoSongId`'s tags with `tagIds`, the whole set it
 * has now (as after assigning its tags in Planning Center), and record that
 * they were written at `now`, so that a tags sync whose listing began
 * earlier leaves them as they are (see `replaceListedSongTags`); in one
 * transaction. A tag the mirror does not have yet is left out and counted
 * as skipped: the next tags sync brings it. Throws, writing nothing, when
 * the mirror does not have the song.
 */
export function replaceSongTags(
    db: DatabaseSync,
    pcoSongId: string,
    tagIds: readonly string[],
    now: Date = new Date()
): SongTagsReplace {
    const ids = [...new Set(tagIds)];
    return withTransaction(db, () => {
        if (!db.prepare("SELECT 1 FROM pco_songs WHERE id = ?").get(pcoSongId)) {
            throw new Error(`The song mirror has no song ${JSON.stringify(pcoSongId)}`);
        }
        db.prepare("DELETE FROM pco_song_tags WHERE pco_song_id = ?").run(pcoSongId);
        const { changes } = db
            .prepare(
                `INSERT INTO pco_song_tags (pco_song_id, tag_id)
                 SELECT ?, t.id FROM pco_tags t WHERE t.id IN (SELECT value FROM json_each(?))`
            )
            .run(pcoSongId, JSON.stringify(ids));
        db.prepare(
            `INSERT INTO pco_song_tags_written (pco_song_id, written_at) VALUES (?, ?) ${RECORD_WRITTEN}`
        ).run(pcoSongId, now.toISOString());
        return { tagged: Number(changes), skipped: ids.length - Number(changes) };
    });
}

function toPcoTag(row: Row): PcoTag {
    return { id: String(row.id), groupId: String(row.group_id), name: String(row.name) };
}

/**
 * The song tag groups, by name, each with its tags by name: what a page
 * offers to filter or tag songs by. Two queries.
 */
export function listSongTagGroups(db: DatabaseSync): PcoTagGroup[] {
    const groups = db
        .prepare(
            `SELECT g.id, g.name, g.tags_for, g.allow_multiple FROM pco_tag_groups g
             WHERE g.tags_for = ? ORDER BY ${GROUP_ORDER}`
        )
        .all(SONG_TAGS)
        .map(
            (row): PcoTagGroup => ({
                id: String(row.id),
                name: String(row.name),
                tagsFor: String(row.tags_for),
                allowMultiple: row.allow_multiple === 1,
                tags: [],
            })
        );
    const byId = new Map(groups.map((group) => [group.id, group]));
    const tags = db
        .prepare(
            `SELECT t.id, t.group_id, t.name FROM pco_tags t
             JOIN pco_tag_groups g ON g.id = t.group_id
             WHERE g.tags_for = ? ORDER BY ${TAG_ORDER}`
        )
        .all(SONG_TAGS);
    for (const row of tags) {
        byId.get(String(row.group_id))?.tags.push(toPcoTag(row));
    }
    return groups;
}

/** Mirrored song `pcoSongId`'s tags, by group name, then by name; none for a song it lacks. One query. */
export function findSongTags(db: DatabaseSync, pcoSongId: string): PcoTag[] {
    return db
        .prepare(
            `SELECT t.id, t.group_id, t.name FROM pco_song_tags st
             JOIN pco_tags t ON t.id = st.tag_id
             JOIN pco_tag_groups g ON g.id = t.group_id
             WHERE st.pco_song_id = ? AND g.tags_for = ?
             ORDER BY ${GROUP_ORDER}, ${TAG_ORDER}`
        )
        .all(pcoSongId, SONG_TAGS)
        .map(toPcoTag);
}

/**
 * Every mirrored song's tag ids, by Planning Center song id, each song's in
 * the order `findSongTags` gives them; a song with no tags has no entry.
 * What a list filters its songs by tag with. One query.
 */
export function listTagIdsBySong(db: DatabaseSync): Map<string, string[]> {
    const rows = db
        .prepare(
            `SELECT st.pco_song_id, st.tag_id FROM pco_song_tags st
             JOIN pco_tags t ON t.id = st.tag_id
             JOIN pco_tag_groups g ON g.id = t.group_id
             WHERE g.tags_for = ?
             ORDER BY st.pco_song_id, ${GROUP_ORDER}, ${TAG_ORDER}`
        )
        .all(SONG_TAGS);
    const bySong = new Map<string, string[]>();
    for (const row of rows) {
        const songId = String(row.pco_song_id);
        const tagIds = bySong.get(songId);
        if (tagIds) {
            tagIds.push(String(row.tag_id));
        } else {
            bySong.set(songId, [String(row.tag_id)]);
        }
    }
    return bySong;
}
