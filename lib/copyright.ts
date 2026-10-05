import { creditLineOf, parseCredits, type CreditsParse } from "./credits";
import type { PlanItemWithSong, Song } from "./domain";
import { DEFAULT_SETTINGS, type CopyrightSettings } from "./settings";

/**
 * The song fields the copyright text is built from. Its credits are
 * `credits` when the caller has parsed them (`parseCredits`), else what
 * `author` reads as with the settings' roles.
 */
export type CopyrightSong = Pick<Song, "title" | "author" | "copyright"> &
    Partial<Pick<Song, "admin">> & { credits?: CreditsParse };

/**
 * The plan-item fields the copyright views read: its type, its position and
 * the song it was joined to by PCO ID. A PlanItemWithSong fits.
 */
export type CopyrightItem = Pick<PlanItemWithSong, "itemType" | "sequence"> & {
    song: CopyrightSong | null;
};

/**
 * Build the attribution block shown (and copied) for a song:
 * `"<title>" <credit line>`, the copyright line, then the CCLI footer,
 * which names the church's license from the settings
 * (`ccliLicenseNumber`; the default is the number it always printed).
 *
 * The credit line is the song's credits (`credits`, or else what its
 * author reads as with the settings' `creditRoles`), printed with the
 * settings' `creditPhrases` by `creditLineOf`: "Words by Isaac Watts.
 * Music by William Croft." for an author in the labelled convention, and,
 * for any other (an author with no labels, or labels that do not parse),
 * the line the copyright text always printed, followed by a period.
 *
 * Moved verbatim from SongCopyright.tsx; copyright.test.ts pins its behavior,
 * quirks included, and credits.test.ts the line it always printed for an
 * author (for example ".." after an author that already ends in a period).
 * A missing, empty or whitespace-only copyright is "Public Domain.".
 */
export function formatCopyrightText(
    song: CopyrightSong,
    {
        ccliLicenseNumber,
        creditRoles = DEFAULT_SETTINGS.creditRoles,
        creditPhrases = DEFAULT_SETTINGS.creditPhrases,
    }: CopyrightSettings = DEFAULT_SETTINGS
): string {
    // PCO can send a null author; it reads like an empty one ("Unknown").
    const credits = song.credits ?? parseCredits(song.author, creditRoles);
    const creditLine = creditLineOf(credits, { creditRoles, creditPhrases });

    // Format copyright line with conditional © symbol. A missing, empty or
    // whitespace-only copyright counts as public domain.
    let copyrightLine = song.copyright?.trim();

    if (!copyrightLine) {
        copyrightLine = "Public Domain.";
    } else {
        if (!copyrightLine.endsWith(".")) {
            copyrightLine += ".";
        }

        if (copyrightLine.toLowerCase() !== "public domain.") {
            copyrightLine = `© ${copyrightLine}`;
        }

        // Add admin information if available
        if (song.admin && song.admin.trim()) {
            copyrightLine += ` Admin. by ${song.admin}`;
        }

        if (!copyrightLine.endsWith(".")) {
            copyrightLine += ".";
        }
    }

    return `"${song.title}" ${creditLine}\n${copyrightLine}\nUsed by permission. CCLI Streaming License ${ccliLicenseNumber}.`;
}

/**
 * The song behind a plan item for the copyright views: the song it was joined
 * to by PCO ID (see joinItemsToSongs), so an item renamed in the plan still
 * gets its song's copyright. Only "song" items qualify. Returns null for other
 * item types and for items without a song. Its credits come along when the
 * song carries them parsed.
 */
export function getItemCopyrightInfo(
    item: CopyrightItem
): CopyrightSong | null {
    if (item.itemType !== "song" || item.song === null) {
        return null;
    }
    const { title, author, copyright, admin, credits } = item.song;
    return { title, author, copyright, admin, ...(credits ? { credits } : {}) };
}

/**
 * The text the "Copy All" button on the Copyright Information tab copies: the
 * formatted copyright block of every song item, in sequence order, separated
 * by a blank line, each following `settings` (see formatCopyrightText: the
 * CCLI number, and the credit roles and phrases) and taking the song's
 * parsed credits when it carries them. Items without a song are skipped (see
 * getItemCopyrightInfo).
 */
export function buildCopyrightCopyAllText(
    items: CopyrightItem[],
    settings: CopyrightSettings = DEFAULT_SETTINGS
): string {
    return items
        .filter((item) => item.itemType === "song")
        .sort((a, b) => a.sequence - b.sequence)
        .map((item) => {
            const info = getItemCopyrightInfo(item);
            return info ? formatCopyrightText(info, settings) : null;
        })
        .filter((info): info is string => info !== null)
        .join("\n\n");
}
