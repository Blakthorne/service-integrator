// Calendar dates from Planning Center (a plan's date) are labels, not instants:
// "June 15" means June 15 wherever the code runs. These helpers build the
// instant with Date.UTC and format it with timeZone "UTC", so the output is the
// same on the server, in every browser, and in every time zone. For a point in
// time that should follow the viewer's zone, use the <LocalTime> component.

const PLAN_DATE_HEADING = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
});

const SHORT_DATE = new Intl.DateTimeFormat("en-US", {
    month: "numeric",
    day: "numeric",
    year: "2-digit",
    timeZone: "UTC",
});

// Years before 1000 are rejected: Date.UTC reads 0-99 as 1900-1999.
const YMD_PATTERN = /^([1-9][0-9]{3})-([0-9]{2})-([0-9]{2})$/;

/** Midnight UTC of a real `YYYY-MM-DD` calendar date, or null for anything else. */
function parseYmd(ymd: string): Date | null {
    const match = YMD_PATTERN.exec(ymd);
    if (match === null) {
        return null;
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    // Date.UTC rolls an impossible date over ("2025-02-30" becomes March 2), so
    // a field that changed means the date does not exist.
    if (
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month - 1 ||
        date.getUTCDate() !== day
    ) {
        return null;
    }
    return date;
}

/**
 * The calendar date of a Planning Center `sort_date`: its `YYYY-MM-DD` part,
 * e.g. "2026-10-04T08:00:00Z" gives "2026-10-04". The date is taken as written,
 * whatever follows it (the time and offset are ignored), because Planning
 * Center's date is the org's local calendar date.
 *
 * Returns null unless the string starts with a real calendar date (month 1-12,
 * a day that exists, a year from 1000) that is followed by nothing or by a "T".
 */
export function planDateFromSortDate(sortDate: string): string | null {
    if (typeof sortDate !== "string") {
        return null;
    }
    const boundary = sortDate.charAt(10); // "" when the string ends at the date
    if (boundary !== "" && boundary !== "T") {
        return null;
    }
    const ymd = sortDate.slice(0, 10);
    return parseYmd(ymd) === null ? null : ymd;
}

/**
 * A heading for a `YYYY-MM-DD` plan date, e.g. "2025-06-15" gives
 * "Sunday, June 15, 2025". The same text in every time zone.
 *
 * Input that is not a real calendar date is returned unchanged, so a bad value
 * shows up on screen instead of throwing during render.
 */
export function formatPlanDateHeading(ymd: string): string {
    const date = parseYmd(ymd);
    return date === null ? ymd : PLAN_DATE_HEADING.format(date);
}

/**
 * A short date for a `YYYY-MM-DD` plan date, e.g. "2025-06-15" gives "6/15/25".
 * The same text in every time zone.
 *
 * Input that is not a real calendar date is returned unchanged.
 */
export function formatShortDate(ymd: string): string {
    const date = parseYmd(ymd);
    return date === null ? ymd : SHORT_DATE.format(date);
}

const MONTH_DAY = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
});

/**
 * A `YYYY-MM-DD` plan date without its year, e.g. "2026-09-20" gives "Sep 20".
 * The same text in every time zone.
 *
 * Input that is not a real calendar date is returned unchanged.
 */
export function formatMonthDay(ymd: string): string {
    const date = parseYmd(ymd);
    return date === null ? ymd : MONTH_DAY.format(date);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** `YYYY-MM-DD` of a Date made at midnight UTC. */
function ymdOf(date: Date): string {
    return date.toISOString().slice(0, 10);
}

/** Midnight UTC of a real `YYYY-MM-DD` date. Throws a RangeError for anything else. */
function requireYmd(ymd: string): Date {
    const date = parseYmd(ymd);
    if (date === null) {
        throw new RangeError(`Not a calendar date: ${JSON.stringify(ymd)}`);
    }
    return date;
}

function requireInteger(value: number, what: string): void {
    if (!Number.isInteger(value)) {
        throw new RangeError(`${what} must be a whole number: ${value}`);
    }
}

/**
 * The date `days` days after `ymd` (before it, for a negative number), as
 * `YYYY-MM-DD`: calendar arithmetic, the same in every time zone. Throws a
 * RangeError unless `ymd` is a real calendar date and `days` a whole number.
 */
export function addDaysToYmd(ymd: string, days: number): string {
    requireInteger(days, "days");
    const date = requireYmd(ymd);
    date.setUTCDate(date.getUTCDate() + days);
    return ymdOf(date);
}

/**
 * The date `months` months after `ymd` (before it, for a negative number),
 * as `YYYY-MM-DD`, on the same day of the month, or the last day of a month
 * that is shorter ("2026-03-31" less a month is "2026-02-28"). Throws a
 * RangeError unless `ymd` is a real calendar date and `months` a whole
 * number.
 */
export function addMonthsToYmd(ymd: string, months: number): string {
    requireInteger(months, "months");
    const date = requireYmd(ymd);
    const day = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + months);
    const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(day, lastDay));
    return ymdOf(date);
}

/**
 * How many days `to` is after `from` (negative when it is before), both
 * `YYYY-MM-DD`. Throws a RangeError unless both are real calendar dates.
 */
export function daysBetweenYmd(from: string, to: string): number {
    return Math.round((requireYmd(to).getTime() - requireYmd(from).getTime()) / DAY_MS);
}
