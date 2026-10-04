import "server-only";
import { cache } from "react";
import type { PcoLibrarySong } from "../domain";
import type { PcoSong } from "../unusedHymns";
import { pcoFetch, pcoFetchAll } from "./client";
import { assertPcoId } from "./ids";
import { toPcoLibrarySong } from "./mappers";
import type { PcoSingleResponse, PcoSongResource } from "./resources";

/** 10,000 songs at per_page=100; the library had 397 songs on 2026-10-03. */
const MAX_SONG_PAGES = 100;

/**
 * The entire PCO song library (title and last-scheduled date of each song),
 * paged 100 at a time through links.next. Throws PcoError on a failed page,
 * or an error if the library has more than MAX_SONG_PAGES pages.
 */
export const fetchAllSongs = cache(async (): Promise<PcoSong[]> => {
    const { data } = await pcoFetchAll<PcoSongResource>(
        "/songs?per_page=100",
        "songs",
        { maxPages: MAX_SONG_PAGES }
    );
    return data.map((resource) => ({
        title: resource.attributes.title,
        lastScheduledAt: resource.attributes.last_scheduled_at,
    }));
});

/**
 * The whole song library with every field the mirror keeps, for the sync
 * job: paged 100 at a time, each request paced (it waits its turn at the
 * shared pacer), and not wrapped in `cache()`, since a job runs outside any
 * request and must read Planning Center afresh every time.
 *
 * It returns the whole library or throws: PcoError for a failed page, an
 * error past MAX_SONG_PAGES pages, and an error when it got fewer songs than
 * the first page's `total_count` said there were (the library changed while
 * it was read, and offset paging skipped a song). A song sent twice, as such
 * a change can also cause, appears once.
 */
export async function fetchSongLibrary(): Promise<PcoLibrarySong[]> {
    const { data, totalCount } = await pcoFetchAll<PcoSongResource>(
        "/songs?per_page=100",
        "songs",
        { maxPages: MAX_SONG_PAGES, paced: true }
    );
    const songs = new Map<string, PcoLibrarySong>();
    for (const resource of data) {
        if (!songs.has(resource.id)) {
            songs.set(resource.id, toPcoLibrarySong(resource));
        }
    }
    if (songs.size < totalCount) {
        throw new Error(
            `Planning Center listed ${totalCount} songs but sent ${songs.size}: the library changed while it was read`
        );
    }
    return [...songs.values()];
}

/**
 * One song of the library with every field the mirror keeps, as linking
 * from a page needs when the mirror lacks it. Not paced: someone is waiting.
 * Throws InvalidPcoIdError before fetching, or PcoError (404 when there is
 * no such song).
 */
export const getSong = cache(async (songId: string): Promise<PcoLibrarySong> => {
    const id = assertPcoId(songId);
    const { data } = await pcoFetch<PcoSingleResponse<PcoSongResource>>(
        `/songs/${id}`,
        "songs"
    );
    return toPcoLibrarySong(data);
});
