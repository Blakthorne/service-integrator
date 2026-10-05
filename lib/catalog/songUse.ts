import type { CatalogSongSummary } from "@/lib/domain";
import { formatShortDate } from "@/lib/format";
import { formatLastScheduled } from "./lastScheduled";

/**
 * What a row of the songs list says of when its linked song was used: the
 * date it was last sung, from the plan history (`lastSungAt`: a plan dated
 * before today), and the date it was last scheduled, from Planning Center
 * (`lastScheduledAt`, which counts upcoming plans), so a song only scheduled
 * ahead reads "Never sung" over "Last scheduled 10/11/26". Pure and safe on
 * both sides; the dates are formatted from their text, the same in every
 * time zone.
 */

/** What the lines read of a row. */
export type SongUseRow = Pick<CatalogSongSummary, "lastScheduledAt" | "lastSungAt">;

/**
 * The lines for a song that is linked to Planning Center, at most two:
 *
 * - "Last sung 9/27/26", or "Never sung" for a song that was scheduled but
 *   not yet sung. Only once the plan history has been read (`historyRead`):
 *   before that nothing is known of what was sung, and a song that was
 *   never scheduled says "Never scheduled" alone, which covers it;
 * - "Last scheduled 10/11/26", or "Never scheduled". It is left out of a
 *   song the history says was sung whose date Planning Center has not yet
 *   given (the song sync runs apart from the history sync), rather than
 *   contradict it.
 */
export function songUseLines(
    { lastScheduledAt, lastSungAt }: SongUseRow,
    historyRead: boolean
): string[] {
    const scheduled = formatLastScheduled(lastScheduledAt);
    const sung = historyRead && lastSungAt !== null ? formatShortDate(lastSungAt) : null;
    const lines: string[] = [];
    if (sung !== null) {
        lines.push(`Last sung ${sung}`);
    } else if (historyRead && scheduled !== null) {
        lines.push("Never sung");
    }
    if (scheduled !== null) {
        lines.push(`Last scheduled ${scheduled}`);
    } else if (sung === null) {
        lines.push("Never scheduled");
    }
    return lines;
}
