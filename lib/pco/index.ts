/**
 * The server-only Planning Center data layer. App code imports from here
 * (`@/lib/pco`), never from the files behind it, so `vi.mock("@/lib/pco")`
 * always applies.
 */
import "server-only";
import type { PcoSong } from "../unusedHymns";
import { pcoAuthHeaders } from "./client";

export { PcoError, PcoUrlError, pcoAuthHeaders } from "./client";
export {
    InvalidPcoIdError,
    assertPcoId,
    parsePcoId,
    type PcoId,
} from "./ids";
export { orNotFound } from "./next";

const PCO_SONGS_URL =
    "https://api.planningcenteronline.com/services/v2/songs?per_page=100";

interface PcoSongResource {
    attributes: {
        title: string;
        last_scheduled_at: string | null;
    };
}

interface PcoSongsPage {
    data: PcoSongResource[];
    links: { next?: string | null };
}

/** Page through the entire PCO song library, following links.next. */
export async function fetchAllSongs(): Promise<PcoSong[]> {
    const headers = pcoAuthHeaders();
    const songs: PcoSong[] = [];
    let url: string | null = PCO_SONGS_URL;

    while (url) {
        const response = await fetch(url, { headers, cache: "no-store" });
        if (!response.ok) {
            throw new Error(
                `Planning Center API responded with status: ${response.status}`
            );
        }
        const page: PcoSongsPage = await response.json();
        for (const resource of page.data) {
            songs.push({
                title: resource.attributes.title,
                lastScheduledAt: resource.attributes.last_scheduled_at,
            });
        }
        url = page.links?.next ?? null;
    }

    return songs;
}
