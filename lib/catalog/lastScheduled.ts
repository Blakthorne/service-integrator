import { formatShortDate, planDateFromSortDate } from "@/lib/format";

/**
 * The calendar date, `YYYY-MM-DD`, that a song was last scheduled, from its
 * Planning Center song's `last_scheduled_at` ("2026-09-27T08:00:00Z"), or
 * null when it has none. Planning Center labels the church's local time `Z`,
 * so the date part is taken as written and never shifted into the viewer's
 * time zone (convention 10).
 *
 * A value that does not start with a real calendar date comes back as it
 * was written, so it shows up on screen and in an export rather than vanish.
 */
export function lastScheduledDate(lastScheduledAt: string | null): string | null {
    if (lastScheduledAt === null) {
        return null;
    }
    return planDateFromSortDate(lastScheduledAt) ?? lastScheduledAt;
}

/**
 * The date the songs list shows, "9/27/26": the same text on the server and
 * in every time zone. Null when there is no date.
 */
export function formatLastScheduled(lastScheduledAt: string | null): string | null {
    const date = lastScheduledDate(lastScheduledAt);
    return date === null ? null : formatShortDate(date);
}
