import "server-only";
import type { PcoTag, PcoTagGroup } from "../domain";
import { pcoFetchAll, type PcoRequestOptions } from "./client";
import { assertPcoId } from "./ids";
import { toPcoTagGroups } from "./mappers";
import type { PcoSongResource, PcoTagGroupResource, PcoTagResource } from "./resources";

/**
 * The song tag reads: Planning Center's tag groups for songs with their
 * tags, which songs have a tag, and one song's tags. None is wrapped in
 * `cache()`: the tags job runs outside any request, and a write must start
 * from what Planning Center has now. The job passes `paced: true`; a page
 * or an action someone is waiting on leaves it off.
 */

/** 1,000 tag groups at per_page=100; the organization had 3 on 2026-10-03. */
const MAX_TAG_GROUP_PAGES = 10;

/** 10,000 songs at per_page=100, as for the whole library. */
const MAX_SONG_PAGES = 100;

/**
 * Planning Center's tag groups for songs (`tags_for` "song"), in its order,
 * each with its tags by name (`tag_groups?include=tags`, every page).
 * Arrangement groups and any others are left out. This is the only place a
 * tag id to ask `fetchSongIdsWithTag` about may come from. Throws PcoError.
 */
export async function fetchSongTagGroups({
    paced = false,
}: PcoRequestOptions = {}): Promise<PcoTagGroup[]> {
    const { data, included } = await pcoFetchAll<PcoTagGroupResource>(
        "/tag_groups?include=tags&per_page=100",
        "tags",
        { maxPages: MAX_TAG_GROUP_PAGES, paced }
    );
    return toPcoTagGroups(
        data.filter((group) => group.attributes.tags_for === "song"),
        included
    );
}

/**
 * The ids of the songs that have tag `tagId`
 * (`songs?where[song_tag_ids]=<id>`), every page, each once, in Planning
 * Center's order.
 *
 * Ask only about an id from a fresh `fetchSongTagGroups` read: the spike
 * found that Planning Center may ignore an id it does not know and list
 * every song. Throws InvalidPcoIdError before fetching, PcoError for a
 * failed page, and an error when it got fewer songs than the first page's
 * `total_count` said there were (the songs changed while they were read,
 * and offset paging skipped one), rather than give part of the list.
 */
export async function fetchSongIdsWithTag(
    tagId: string,
    { paced = false }: PcoRequestOptions = {}
): Promise<string[]> {
    const id = assertPcoId(tagId);
    const { data, totalCount } = await pcoFetchAll<PcoSongResource>(
        `/songs?where[song_tag_ids]=${id}&per_page=100`,
        "songs",
        { maxPages: MAX_SONG_PAGES, paced }
    );
    const ids = [...new Set(data.map((song) => song.id))];
    if (ids.length < totalCount) {
        throw new Error(
            `Planning Center listed ${totalCount} songs with tag ${id} but sent ${ids.length}: the songs changed while they were read`
        );
    }
    return ids;
}

/** A tag of a song as Planning Center gives it: its group's id when Planning Center names it. */
export type SongTag = Pick<PcoTag, "id" | "name"> & { groupId: string | null };

/**
 * Song `songId`'s tags as Planning Center has them now (`songs/{id}/tags`,
 * every page), for a write that must start from them
 * (refresh-before-write). Unpaced unless asked: someone is waiting. Throws
 * InvalidPcoIdError before fetching, or PcoError (404 when there is no such
 * song).
 */
export async function fetchSongTags(
    songId: string,
    { paced = false }: PcoRequestOptions = {}
): Promise<SongTag[]> {
    const id = assertPcoId(songId);
    const { data } = await pcoFetchAll<PcoTagResource>(`/songs/${id}/tags?per_page=100`, "tags", {
        paced,
    });
    return data.map((tag) => ({
        id: tag.id,
        name: tag.attributes.name ?? "",
        groupId: tag.relationships?.tag_group?.data?.id ?? null,
    }));
}
