import "server-only";
import { creditLabelSets, type CreditLabelSet } from "@/lib/creditRoleImpact";
import { getDb, withTransaction } from "@/lib/db";
import { deriveSongCredits, type CreditStatusCounts } from "@/lib/db/credits";
import { errorMessage } from "@/lib/db/errors";
import { listPcoSongs } from "@/lib/db/pcoSongs";
import { listStoredSettings } from "@/lib/db/settings";
import { resolveSettings } from "@/lib/settings";

/**
 * Songs' credits as the app derives them from the mirror (`pco_song_credits`;
 * see lib/credits.ts), for what changes them all at once: a change of the
 * credit roles, and what such a change would do to them. The sync derives
 * them song by song (lib/queries/sync.ts), and so does every write to a
 * song (lib/queries/pcoSongs.ts).
 */

/** The labels the songs' authors use, or why they could not be read. */
export interface CreditLabelSetsRead {
    /** Biggest first (`creditLabelSets`); none when they could not be read. */
    sets: CreditLabelSet[];
    /** Why they could not be read, or null. */
    error: string | null;
}

/**
 * The labels the mirrored songs' authors use, read with the stored
 * `creditRoles` setting (its default when the stored value does not parse)
 * and grouped by `creditLabelSets`: what the Settings page's Credits form
 * shows the impact of new roles from, and what `saveCreditsAction` checks
 * that impact against before it saves. Songs that Planning Center no longer
 * has are left out: they print no copyright text. It reads the database
 * alone, never Planning Center, and never throws: a failure is logged and
 * comes back as `error`, with no sets.
 */
export function getCreditLabelSets(): CreditLabelSetsRead {
    try {
        const db = getDb();
        const roles = resolveSettings(listStoredSettings(db)).settings.creditRoles;
        const authors = listPcoSongs(db)
            .filter((song) => song.removedAt === null)
            .map((song) => song.author);
        return { sets: creditLabelSets(authors, roles), error: null };
    } catch (error) {
        console.error("Failed to read the labels of the songs' credits:", error);
        return { sets: [], error: errorMessage(error) };
    }
}

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
