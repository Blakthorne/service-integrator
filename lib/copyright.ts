import type { PlanItemWithSong, Song } from "./domain";
import { DEFAULT_SETTINGS, type CopyrightSettings } from "./settings";

/** The song fields the copyright text is built from. */
export type CopyrightSong = Pick<Song, "title" | "author" | "copyright"> &
    Partial<Pick<Song, "admin">>;

/**
 * The plan-item fields the copyright views read: its type, its position and
 * the song it was joined to by PCO ID. A PlanItemWithSong fits.
 */
export type CopyrightItem = Pick<PlanItemWithSong, "itemType" | "sequence"> & {
    song: CopyrightSong | null;
};

/**
 * Build the attribution block shown (and copied) for a song:
 * `"<title>" <author line>.`, the copyright line, then the CCLI footer,
 * which names the church's license from the settings
 * (`ccliLicenseNumber`; the default is the number it always printed).
 *
 * Moved verbatim from SongCopyright.tsx; copyright.test.ts pins its behavior,
 * quirks included (for example ".." after an author that already ends in a
 * period). A missing, empty or whitespace-only copyright is "Public Domain.".
 */
export function formatCopyrightText(
    song: CopyrightSong,
    { ccliLicenseNumber }: CopyrightSettings = DEFAULT_SETTINGS
): string {
    // PCO can send a null author; treat it like an empty one ("Unknown").
    const author = song.author ?? "";

    // First split by comma to check if there are three authors
    const commaAuthors = author.split(",").map((a) => a.trim());
    let authorLine: string;

    if (commaAuthors.length >= 3) {
        // If there are three or more authors separated by commas
        const wordsAuthors = commaAuthors.slice(0, 2).join(" and ");
        const musicAuthor = commaAuthors[2];
        authorLine = `Words by ${wordsAuthors}. Music by ${musicAuthor}`;
    } else {
        // If not three authors, split by "and"
        const authors = author.split(" and ").map((a) => a.trim());
        if (authors.length === 1) {
            // Single author case
            authorLine = `Words and Music by ${authors[0] || "Unknown"}`;
        } else {
            // Two authors case
            const wordsAuthor = authors[0] || "Unknown";
            const musicAuthor = authors[1] || wordsAuthor;
            authorLine = `Words by ${wordsAuthor}. Music by ${musicAuthor}`;
        }
    }

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

    return `"${song.title}" ${authorLine}.\n${copyrightLine}\nUsed by permission. CCLI Streaming License ${ccliLicenseNumber}.`;
}

/**
 * The song behind a plan item for the copyright views: the song it was joined
 * to by PCO ID (see joinItemsToSongs), so an item renamed in the plan still
 * gets its song's copyright. Only "song" items qualify. Returns null for other
 * item types and for items without a song.
 */
export function getItemCopyrightInfo(
    item: CopyrightItem
): CopyrightSong | null {
    if (item.itemType !== "song" || item.song === null) {
        return null;
    }
    const { title, author, copyright, admin } = item.song;
    return { title, author, copyright, admin };
}

/**
 * The text the "Copy All" button on the Copyright Information tab copies: the
 * formatted copyright block of every song item, in sequence order, separated
 * by a blank line, each following `settings` (see formatCopyrightText).
 * Items without a song are skipped (see getItemCopyrightInfo).
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
