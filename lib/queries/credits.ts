import "server-only";
import { getDb, withTransaction } from "@/lib/db";
import { deriveSongCredits, type CreditStatusCounts } from "@/lib/db/credits";
import { listPcoSongs } from "@/lib/db/pcoSongs";
import { listStoredSettings } from "@/lib/db/settings";
import { resolveSettings } from "@/lib/settings";

/**
 * Songs' credits as the app derives them from the mirror (`pco_song_credits`;
 * see lib/credits.ts), for what changes them all at once: a change of the
 * credit roles. The sync derives them song by song (lib/queries/sync.ts),
 * and so does every write to a song (lib/queries/pcoSongs.ts).
 */

/** What `rederiveAllCredits` did: how many songs it read again, and how many read as each status. */
export interface RederivedCredits extends CreditStatusCounts {
    songs: number;
}

/**
 * Read every mirrored song's author again with the stored `creditRoles`
 * setting (its default when the stored value does not parse) and replace
 * the credits derived from it, all in one transaction, removed and ignored
 * songs too: what saving the roles calls, so that every song's credits
 * follow the new roles at once instead of at the next sync. It reads and
 * writes only the database, never Planning Center. Throws, changing
 * nothing, when the database cannot be opened, read or written.
 */
export function rederiveAllCredits(): RederivedCredits {
    const db = getDb();
    return withTransaction(db, () => {
        const roles = resolveSettings(listStoredSettings(db)).settings.creditRoles;
        const songs = listPcoSongs(db);
        return { songs: songs.length, ...deriveSongCredits(db, songs, roles) };
    });
}
