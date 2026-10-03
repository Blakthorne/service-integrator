import type { PlanItem, Song } from "./domain";

/** The song fields the copyright text is built from. */
export type CopyrightSong = Pick<Song, "title" | "author" | "copyright"> &
    Partial<Pick<Song, "admin">>;

/** The plan-item fields the copyright views read. */
export type CopyrightItem = Pick<PlanItem, "title" | "itemType" | "sequence">;

/**
 * Build the attribution block shown (and copied) for a song:
 * `"<title>" <author line>.`, the copyright line, then the CCLI footer.
 *
 * Moved verbatim from SongCopyright.tsx; copyright.test.ts pins its behavior,
 * quirks included (for example "© ." for an empty copyright and ".." after an
 * author that already ends in a period).
 */
export function formatCopyrightText(song: CopyrightSong): string {
    // PCO can send a null author. It still throws below, as it always has
    // (copyright.test.ts pins that), until null is treated as "Unknown".
    const author = song.author as string;

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

    // Format copyright line with conditional © symbol
    let copyrightLine = song.copyright && song.copyright.trim();

    if (copyrightLine == null || copyrightLine === undefined) {
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

    return `"${song.title}" ${authorLine}.\n${copyrightLine}\nUsed by permission. CCLI Streaming License 1564484.`;
}

/**
 * Find the song behind a plan item for the copyright views. Only "song" items
 * qualify, and the song is the first one in `includedSongs` whose title is
 * identical (exact, case-sensitive) to the item's title. Returns null for
 * other item types and for items with no such song.
 */
export function getItemCopyrightInfo(
    item: CopyrightItem,
    includedSongs: CopyrightSong[]
): CopyrightSong | null {
    if (item.itemType === "song") {
        const song = includedSongs.find((song) => song.title === item.title);
        if (!song) return null;
        return {
            title: song.title,
            author: song.author,
            copyright: song.copyright,
            admin: song.admin,
        };
    }
    return null;
}

/**
 * The text the "Copy All" button on the Copyright Information tab copies: the
 * formatted copyright block of every song item, in sequence order, separated
 * by a blank line. Items without a matching song are skipped (see
 * getItemCopyrightInfo for how songs are matched).
 */
export function buildCopyrightCopyAllText(
    items: CopyrightItem[],
    includedSongs: CopyrightSong[]
): string {
    return items
        .filter((item) => item.itemType === "song")
        .sort((a, b) => a.sequence - b.sequence)
        .map((item) => {
            const info = getItemCopyrightInfo(item, includedSongs);
            return info ? formatCopyrightText(info) : null;
        })
        .filter((info): info is string => info !== null)
        .join("\n\n");
}
