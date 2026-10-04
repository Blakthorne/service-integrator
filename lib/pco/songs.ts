import "server-only";
import { cache } from "react";
import type { PcoSong } from "../unusedHymns";
import { pcoFetchAll } from "./client";
import type { PcoSongResource } from "./resources";

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
