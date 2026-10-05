import type { Plan } from "./domain";

/**
 * Sort plans newest first and group them by calendar date. Sorting is a plain
 * string comparison of `sortDate`, done on a copy so `plans` is not mutated.
 * Plans are grouped by the part of `sortDate` before the "T". The sort is
 * stable, so plans with equal `sortDate` keep their input order (getAllPlans
 * returns them in service-type order), and the keys of the result are in
 * newest-first order.
 */
export function groupPlansByDate<T extends Pick<Plan, "sortDate">>(
    plans: T[]
): Record<string, T[]> {
    // Sort all plans by date
    const sortedPlans = [...plans].sort((a: T, b: T) =>
        b.sortDate.localeCompare(a.sortDate)
    );

    // Group plans by date
    return sortedPlans.reduce((acc: Record<string, T[]>, plan: T) => {
        const date = plan.sortDate.split("T")[0]; // Get just the date part
        if (!acc[date]) {
            acc[date] = [];
        }
        acc[date].push(plan);
        return acc;
    }, {});
}

/**
 * The dates (keys) of a plans-by-date map, newest first. Plain string
 * comparison, which orders `YYYY-MM-DD` keys chronologically.
 */
export function sortPlanDates(plansByDate: Record<string, unknown>): string[] {
    return Object.keys(plansByDate).sort((a, b) => b.localeCompare(a));
}

// ---------------------------------------------------------------------------
// Navigating the plans list by date
//
// The list shows an Upcoming section (plans dated today or later, by the
// plan's calendar date against the server's today), then the past plans,
// paged as before, with "Jump to month": a choice of the months that have
// plans, which moves `?page=` to the page holding that month's first date.
// All of it is pure, on `YYYY-MM-DD` date keys, so the list does it in the
// browser.
// ---------------------------------------------------------------------------

/** How many dates each page of the plans list shows. */
export const PLAN_DATES_PER_PAGE = 25;

/** A `YYYY-MM-DD` date's month, `YYYY-MM`, or null for text that does not start with one. */
function monthOf(date: string): string | null {
    return /^[0-9]{4}-[0-9]{2}(?:-|$)/.test(date) ? date.slice(0, 7) : null;
}

/** Two digits: 4 is "04". */
function twoDigits(value: number): string {
    return String(value).padStart(2, "0");
}

/**
 * A moment's date on the calendar of the machine that runs this, as
 * `YYYY-MM-DD`: the server's today, which the plans list splits its dates
 * at.
 */
export function localYmd(date: Date): string {
    return `${date.getFullYear()}-${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())}`;
}

/** The plans list's dates, split at today. */
export interface SplitPlanDates {
    /** The dates on or after today, soonest first. */
    upcoming: string[];
    /** The dates before today, newest first. */
    past: string[];
}

/**
 * Split the plans list's dates (`YYYY-MM-DD`, in any order) at `today`
 * (`YYYY-MM-DD`): a plan dated today is upcoming all day, as Planning
 * Center's own "future" filter has it. Plain string comparison, which
 * orders such dates by time.
 */
export function splitPlanDates(dates: readonly string[], today: string): SplitPlanDates {
    const upcoming = dates.filter((date) => date >= today).sort((a, b) => a.localeCompare(b));
    const past = dates.filter((date) => date < today).sort((a, b) => b.localeCompare(a));
    return { upcoming, past };
}

/** A month that has plans, as "Jump to month" offers it. */
export interface PlanMonth {
    /** `YYYY-MM`, the value the choice posts. */
    month: string;
    /** "October 2026": the same text in every time zone. */
    label: string;
    /** How many of the dates fall in it. */
    dates: number;
}

const MONTH_LABEL = new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
});

/** "October 2026" for "2026-10", formatted with UTC math (convention 10). */
function monthLabel(month: string): string {
    const [year, number] = month.split("-").map(Number);
    return MONTH_LABEL.format(new Date(Date.UTC(year, number - 1, 1)));
}

/**
 * The months that have plans, in the order `dates` first reach them (so,
 * for the past dates, newest first), each once with how many of the dates
 * it has. A date that does not start with `YYYY-MM` is left out.
 */
export function planMonths(dates: readonly string[]): PlanMonth[] {
    const months = new Map<string, number>();
    for (const date of dates) {
        const month = monthOf(date);
        if (month !== null) {
            months.set(month, (months.get(month) ?? 0) + 1);
        }
    }
    return [...months].map(([month, count]) => ({ month, label: monthLabel(month), dates: count }));
}

/**
 * The page (from 1) of `dates`, paged `perPage` to a page in their order,
 * that holds the first of them in `month` (`YYYY-MM`): where "Jump to
 * month" takes the list. Null when no date is in that month.
 */
export function pageOfMonth(
    dates: readonly string[],
    month: string,
    perPage: number = PLAN_DATES_PER_PAGE
): number | null {
    const index = dates.findIndex((date) => monthOf(date) === month);
    return index === -1 ? null : Math.floor(index / perPage) + 1;
}

/** How "Jump to month" words a month in its list: "October 2026 (4 dates)". */
export function describeMonthOption(month: PlanMonth): string {
    return `${month.label} (${month.dates} ${month.dates === 1 ? "date" : "dates"})`;
}

/** What choosing a month in "Jump to month" does: the page to show, or why nothing happens. */
export type MonthJump =
    | { ok: true; page: number; message: string }
    | { ok: false; message: string };

/**
 * What "Jump to month" does when `month` (`YYYY-MM`, "" for none chosen) is
 * chosen from the months of `dates`, paged `perPage` to a page: the page
 * that holds the month's first date, with the sentence a status region
 * announces ("Showing October 2026: page 2 of 5."), or why it cannot (no
 * month chosen, or a month the list no longer has).
 */
export function jumpToMonth(
    dates: readonly string[],
    month: string,
    perPage: number = PLAN_DATES_PER_PAGE
): MonthJump {
    if (month === "") {
        return { ok: false, message: "Choose a month to jump to." };
    }
    const page = pageOfMonth(dates, month, perPage);
    if (page === null) {
        return { ok: false, message: "No plans are in that month." };
    }
    const totalPages = Math.max(1, Math.ceil(dates.length / perPage));
    return { ok: true, page, message: `Showing ${monthLabel(month)}: page ${page} of ${totalPages}.` };
}
