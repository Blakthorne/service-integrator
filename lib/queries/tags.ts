import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { getDb, withTransaction } from "@/lib/db";
import {
    findSongTags,
    listSongTagGroups,
    listTagIdsBySong,
    replaceSongTagGroups,
    replaceTagSongs,
} from "@/lib/db/tags";
import type { PcoTag, PcoTagGroup } from "@/lib/domain";
import { fetchSongIdsWithTag, fetchSongTagGroups } from "@/lib/pco";

/**
 * Planning Center's song tags in the app: the tags job's sync of the mirror
 * (`syncTags`), and the mirror's reads for the pages that filter songs by
 * tag or show a song's tags. The reads are synchronous, like the database,
 * and throw when it cannot be read, as the catalog's do.
 */

/** What a sync of the song tags did, as its `sync_runs` row records it. */
export type TagsSyncCounts = {
    /** Song tag groups Planning Center has. */
    groups: number;
    /** Their tags. */
    tags: number;
    /** Song tags mirrored: each tag of each mirrored song that has it. */
    songTags: number;
    /** Song tags left out because the song mirror does not have the song yet. */
    skipped: number;
};

/**
 * Mirror Planning Center's song tags: the work of the `tags` job
 * (lib/jobs.ts), hourly and at boot, after the song sync.
 *
 * It first reads everything, paced: the song tag groups with their tags
 * (`fetchSongTagGroups`), then, for each of those tags and only those (an id
 * Planning Center does not know may list every song), the songs that have it
 * (`fetchSongIdsWithTag`), one tag at a time. Only then does it write, in
 * one transaction: the groups and tags replace the mirror's
 * (`replaceSongTagGroups`), and each tag's songs replace its song tags
 * (`replaceTagSongs`), leaving out the songs the song mirror does not have
 * yet; the next sync after the song sync mirrors them gives them their
 * tags. A failed read throws before anything is written.
 */
export async function syncTags(db: DatabaseSync): Promise<TagsSyncCounts> {
    const groups = await fetchSongTagGroups({ paced: true });
    const songsByTag = new Map<string, string[]>();
    for (const group of groups) {
        for (const tag of group.tags) {
            if (!songsByTag.has(tag.id)) {
                songsByTag.set(tag.id, await fetchSongIdsWithTag(tag.id, { paced: true }));
            }
        }
    }
    return withTransaction(db, () => {
        const stored = replaceSongTagGroups(db, groups);
        let songTags = 0;
        let skipped = 0;
        for (const [tagId, songIds] of songsByTag) {
            const replaced = replaceTagSongs(db, tagId, songIds);
            songTags += replaced.tagged;
            skipped += replaced.skipped;
        }
        return { groups: stored.groups, tags: stored.tags, songTags, skipped };
    });
}

/** "1 tag" or "5 tags". */
function counted(count: number, singular: string, plural: string): string {
    return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * A tags sync's counts in words, for its run's message: "Synced 5 tags in 1
 * group: 412 song tags", and how many were skipped when some were ("…, 3
 * skipped (songs not mirrored yet)").
 */
export function describeTagsSync({ groups, tags, songTags, skipped }: TagsSyncCounts): string {
    const synced = `Synced ${counted(tags, "tag", "tags")} in ${counted(groups, "group", "groups")}: ${counted(songTags, "song tag", "song tags")}`;
    return skipped > 0 ? `${synced}, ${skipped} skipped (songs not mirrored yet)` : synced;
}

/**
 * The song tag groups, by name, each with its tags by name: what a page
 * offers to filter or tag songs by. Two queries; throws when the database
 * cannot be read.
 */
export function getSongTagGroups(): PcoTagGroup[] {
    return listSongTagGroups(getDb());
}

/**
 * Each mirrored song's tag ids, by Planning Center song id (a song with no
 * tags has no entry): what the songs list filters by tag with, through each
 * row's `pcoSongId`. One query; throws when the database cannot be read.
 */
export function getTagIdsBySong(): Record<string, string[]> {
    return Object.fromEntries(listTagIdsBySong(getDb()));
}

/**
 * Mirrored song `pcoSongId`'s tags (an id its parser checked), by group
 * name, then by name; none when it has none or the mirror lacks it. One
 * query; throws when the database cannot be read.
 */
export function getPcoSongTags(pcoSongId: string): PcoTag[] {
    return findSongTags(getDb(), pcoSongId);
}
