import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { withTransaction } from "@/lib/db";
import { listCatalogSongs } from "@/lib/db/catalog";
import { deriveSongCredits } from "@/lib/db/credits";
import { applyAutoLinks } from "@/lib/db/links";
import {
    listPcoSongs,
    markMissingPcoSongsRemoved,
    upsertListedPcoSongs,
} from "@/lib/db/pcoSongs";
import { listStoredSettings } from "@/lib/db/settings";
import { fetchSongLibrary } from "@/lib/pco";
import { buildCatalogIndex, chooseAutoLinks } from "@/lib/reconcile";
import { resolveSettings } from "@/lib/settings";

/** What a sync of the Planning Center songs did, as its `sync_runs` row records it. */
export type PcoSongsSyncCounts = {
    /** Songs Planning Center listed. */
    fetched: number;
    /** Songs new to the mirror. */
    added: number;
    /** Songs whose fields changed, or that came back after being removed. */
    updated: number;
    /** Songs Planning Center no longer has, now marked removed. */
    removed: number;
    /** Links made by the sync (see `chooseAutoLinks`). */
    autoLinked: number;
};

/**
 * Mirror the Planning Center song library and make the links it allows: the
 * work of the `pco-songs` job (lib/jobs.ts), hourly, at boot and on demand.
 *
 * It first reads the whole library, paced (about 4 requests), and only then
 * writes, in one transaction at `now()`: every song is upserted and its
 * credits derived afresh from its author (`pco_song_credits`, read with the
 * stored `creditRoles` setting, or the default roles when it does not
 * parse), the songs the listing lacks are marked removed and those that
 * came back unmarked, and the auto-links `chooseAutoLinks` allows are made.
 * A song the mirror wrote since the listing began (a page saved it, or
 * mirrored it for a link, while the listing was read) is left as it is:
 * its fields and credits are newer than the listing's, so a save is never
 * put back to what it was (`upsertListedPcoSongs`), and it is not marked
 * removed, since Planning Center may have created it after the listing
 * passed it. A failed or partial read throws before anything is
 * written, and so does a listing with no songs at all while the mirror has
 * some, which is taken for a failure rather than a library emptied at once.
 */
export async function syncPcoSongs(
    db: DatabaseSync,
    now: () => Date = () => new Date()
): Promise<PcoSongsSyncCounts> {
    const listingStartedAt = now();
    const songs = await fetchSongLibrary();
    return withTransaction(db, () => {
        const at = now();
        if (songs.length === 0 && listPcoSongs(db).some(({ removedAt }) => removedAt === null)) {
            throw new Error(
                "Planning Center listed no songs, though the mirror has some; nothing was changed"
            );
        }
        const { added, updated, newer } = upsertListedPcoSongs(db, songs, listingStartedAt, at);
        const written = new Set(newer);
        deriveSongCredits(
            db,
            songs.filter(({ id }) => !written.has(id)),
            resolveSettings(listStoredSettings(db)).settings.creditRoles
        );
        const removed = markMissingPcoSongsRemoved(
            db,
            songs.map(({ id }) => id),
            listingStartedAt,
            at
        );
        const index = buildCatalogIndex(listCatalogSongs(db));
        const autoLinked = applyAutoLinks(db, chooseAutoLinks(listPcoSongs(db), index), at);
        return { fetched: songs.length, added, updated, removed, autoLinked };
    });
}

/** "1 song" or "397 songs". */
function songCount(count: number): string {
    return `${count} ${count === 1 ? "song" : "songs"}`;
}

/**
 * A sync's counts in words, for its run's message: "Synced 397 songs: 2
 * added, 1 removed, 5 auto-linked", leaving out what did not happen, or
 * "Synced 397 songs: no changes".
 */
export function describePcoSongsSync(counts: PcoSongsSyncCounts): string {
    const changes = (
        [
            [counts.added, "added"],
            [counts.updated, "updated"],
            [counts.removed, "removed"],
            [counts.autoLinked, "auto-linked"],
        ] as const
    )
        .filter(([count]) => count > 0)
        .map(([count, what]) => `${count} ${what}`);
    return `Synced ${songCount(counts.fetched)}: ${changes.length > 0 ? changes.join(", ") : "no changes"}`;
}
