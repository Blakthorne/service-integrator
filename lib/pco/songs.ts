import "server-only";
import { cache } from "react";
import type { PcoSong } from "../unusedHymns";
import { pcoFetchAll } from "./client";
import type { PcoSongResource } from "./resources";

/**
 * The entire PCO song library (title and last-scheduled date of each song),
 * paged 100 at a time through links.next. Throws PcoError on a failed page.
 */
export const fetchAllSongs = cache(async (): Promise<PcoSong[]> => {
    const { data } = await pcoFetchAll<PcoSongResource>(
        "/songs?per_page=100",
        "songs"
    );
    return data.map((resource) => ({
        title: resource.attributes.title,
        lastScheduledAt: resource.attributes.last_scheduled_at,
    }));
});
