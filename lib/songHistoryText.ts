import { formatPlanDateHeading } from "./format";
import type { SongHistoryEntry } from "./reports";

/**
 * The words and rows of a song page's History card: each time the song is in
 * a plan, from the plan history (`getSongHistory`). Pure and safe on both
 * sides; the dates are formatted from their `YYYY-MM-DD` text, so the text is
 * the same on the server and in every time zone (convention 10).
 */

/** How many occurrences the card lists before it folds the earlier ones away. */
export const HISTORY_ROWS_SHOWN = 10;

/** A fold hides at least this many: "Show 1 earlier" would be a button for a row. */
const MIN_FOLDED = 3;

/** What the card says when the plan history holds no plan at all, so it cannot say when the song was sung. */
export const HISTORY_NOT_READ_TEXT =
    "The plan history has not been read yet, so it cannot say when this song was sung.";

/** What the card says when the history holds plans but none has the song. */
export const NOT_IN_HISTORY_TEXT = "This song is not in any plan the history holds.";

/**
 * A service type's name, or "Service type <id>" when its names are not known
 * (Planning Center did not answer, or no longer lists it: the history keeps
 * only the id).
 */
export function serviceTypeLabel(
    names: Readonly<Record<string, string>>,
    serviceTypeId: string
): string {
    const name = Object.hasOwn(names, serviceTypeId) ? names[serviceTypeId].trim() : "";
    return name === "" ? `Service type ${serviceTypeId}` : name;
}

/** An occurrence as the card lists it. */
export interface HistoryRow {
    /** Unique among the rows, for React. */
    key: string;
    /** The plan it was in: where its link goes (`routes.plan`). */
    planId: string;
    serviceTypeId: string;
    /** The plan's date as a heading ("Sunday, September 27, 2026"). */
    date: string;
    /** The plan's service type's name ("Sunday Morning"). */
    serviceTypeName: string;
    /** The plan is dated today or later: the song is scheduled, not yet sung. */
    upcoming: boolean;
}

/**
 * The card's rows for `entries` (a song's occurrences, newest first, as
 * `getSongHistory` gives them), in the same order, with each service type's
 * name from `names` (`serviceTypeLabel`).
 */
export function historyRows(
    entries: readonly SongHistoryEntry[],
    names: Readonly<Record<string, string>>
): HistoryRow[] {
    return entries.map(
        ({ planId, itemId, serviceTypeId, planDate, upcoming }): HistoryRow => ({
            key: `${planId}-${itemId}`,
            planId,
            serviceTypeId,
            date: formatPlanDateHeading(planDate),
            serviceTypeName: serviceTypeLabel(names, serviceTypeId),
            upcoming,
        })
    );
}

/**
 * The rows the card lists at once, and the earlier ones it folds away: the
 * first `HISTORY_ROWS_SHOWN`, unless there are too few more to be worth a
 * fold (fewer than three), when it lists them all.
 */
export function foldHistoryRows<T>(rows: readonly T[]): { shown: T[]; folded: T[] } {
    if (rows.length - HISTORY_ROWS_SHOWN < MIN_FOLDED) {
        return { shown: [...rows], folded: [] };
    }
    return { shown: rows.slice(0, HISTORY_ROWS_SHOWN), folded: rows.slice(HISTORY_ROWS_SHOWN) };
}
