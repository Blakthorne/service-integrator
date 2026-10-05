import "server-only";
import { cache } from "react";
import type { PcoLibrarySong, SongArrangement } from "../domain";
import { pcoFetch, pcoFetchAll } from "./client";
import { assertPcoId } from "./ids";
import { toPcoLibrarySong, toSongArrangement } from "./mappers";
import type { PcoArrangementResource, PcoSingleResponse, PcoSongResource } from "./resources";

/** 10,000 songs at per_page=100; the library had 397 songs on 2026-10-03. */
const MAX_SONG_PAGES = 100;

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
 * One song of the library with every field the mirror keeps, read afresh
 * every time: for a write that must start from what Planning Center has now
 * (refresh-before-write), or read a song again after one. Not paced:
 * someone is waiting. Throws InvalidPcoIdError before fetching, or PcoError
 * (404 when there is no such song).
 */
export async function fetchSong(songId: string): Promise<PcoLibrarySong> {
    const id = assertPcoId(songId);
    const { data } = await pcoFetch<PcoSingleResponse<PcoSongResource>>(
        `/songs/${id}`,
        "songs"
    );
    return toPcoLibrarySong(data);
}

/**
 * One song of the library with every field the mirror keeps, as linking
 * from a page needs when the mirror lacks it: `fetchSong`, deduped within a
 * request. Not paced: someone is waiting. Throws InvalidPcoIdError before
 * fetching, or PcoError (404 when there is no such song).
 */
export const getSong = cache(fetchSong);

/**
 * Song `songId`'s arrangements, in Planning Center's order, archived ones
 * included (every song has at least one: Planning Center makes a "Default
 * Arrangement" with each new song). Not paced: someone is waiting. Throws
 * InvalidPcoIdError before fetching, or PcoError (404 when there is no such
 * song).
 */
export const getSongArrangements = cache(
    async (songId: string): Promise<SongArrangement[]> => {
        const id = assertPcoId(songId);
        const { data } = await pcoFetchAll<PcoArrangementResource>(
            `/songs/${id}/arrangements?per_page=100`,
            "arrangements"
        );
        return data.map(toSongArrangement);
    }
);
