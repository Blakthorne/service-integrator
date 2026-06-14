import type { PcoSong } from "./unusedHymns";

const PCO_SONGS_URL =
    "https://api.planningcenteronline.com/services/v2/songs?per_page=100";

/** Build the PCO Basic Auth headers from env credentials. Throws if missing. */
export function pcoAuthHeaders(): Record<string, string> {
    const id = process.env.PLANNING_CENTER_ID;
    const token = process.env.PLANNING_CENTER_TOKEN;
    if (!id || !token) {
        throw new Error("Planning Center credentials not configured");
    }
    const credentials = Buffer.from(`${id}:${token}`).toString("base64");
    return {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/json",
    };
}

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
