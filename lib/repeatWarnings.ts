import { addDaysToYmd, daysBetweenYmd, formatMonthDay } from "./format";

/**
 * The warning a plan's song item carries when its song was sung lately: the
 * words and the window (`repeatWarningWeeks`, lib/settings.ts). Pure and safe
 * on both sides; `getPlanDetail` (lib/queries/plans.ts) finds the songs.
 *
 * Only past plans count (dated before today): a song in an upcoming plan is
 * scheduled, not sung, so another plan ahead is not a repeat.
 */

/** A song item's warning: the past plan its song was last sung in. */
export interface RepeatWarning {
    /** The past plan it was last sung in. */
    planId: string;
    serviceTypeId: string;
    /** That plan's date, `YYYY-MM-DD`. */
    planDate: string;
    /** How many days before today that plan was: at least 1. */
    daysAgo: number;
}

/**
 * The first date a past plan may have, as of `today` (`YYYY-MM-DD`), to
 * warn: `weeks` weeks before it, so a plan exactly that long ago is within
 * the window. Null when `weeks` is 0: the warnings are off. Throws a
 * RangeError unless `today` is a real calendar date.
 */
export function repeatWindowStart(today: string, weeks: number): string | null {
    return weeks > 0 ? addDaysToYmd(today, -7 * weeks) : null;
}

/** The warning for a song last sung in past plan `plan`, as of `today`. */
export function repeatWarningFor(
    plan: Pick<RepeatWarning, "planId" | "serviceTypeId" | "planDate">,
    today: string
): RepeatWarning {
    return {
        planId: plan.planId,
        serviceTypeId: plan.serviceTypeId,
        planDate: plan.planDate,
        daysAgo: daysBetweenYmd(plan.planDate, today),
    };
}

/**
 * How long ago a past plan was, in words: "yesterday", "5 days ago", "1 week
 * ago", "2 weeks ago" (whole weeks, rounded down). Today, which a past plan
 * never is, reads "today".
 */
export function describeDaysAgo(daysAgo: number): string {
    if (daysAgo <= 0) {
        return "today";
    }
    if (daysAgo === 1) {
        return "yesterday";
    }
    if (daysAgo < 7) {
        return `${daysAgo} days ago`;
    }
    const weeks = Math.floor(daysAgo / 7);
    return `${weeks} ${weeks === 1 ? "week" : "weeks"} ago`;
}

/** A warning in words: "Sung Sep 20 (2 weeks ago)". The same text on the server and in every browser. */
export function describeRepeatWarning({
    planDate,
    daysAgo,
}: Pick<RepeatWarning, "planDate" | "daysAgo">): string {
    return `Sung ${formatMonthDay(planDate)} (${describeDaysAgo(daysAgo)})`;
}

/**
 * The day a warning was worked out for ("today" when `getPlanDetail` ran):
 * its plan's date and the days from it to that day. Null when the plan's
 * date is not a real calendar date, which `repeatWarningFor` never makes.
 */
function warningDay({ planDate, daysAgo }: Pick<RepeatWarning, "planDate" | "daysAgo">): string | null {
    try {
        return addDaysToYmd(planDate, daysAgo);
    } catch {
        return null;
    }
}

/**
 * The warnings a plan's page may show, given the plan's own date
 * (`YYYY-MM-DD`; null when it is not known). `getPlanDetail` works every
 * warning out as of the day it ran, so "Sung Sep 20 (2 weeks ago)" means
 * something on a plan being prepared, dated today or later, and nothing on
 * a plan that is over: viewed a month later, its warnings would still say
 * how long ago a song was sung from *today*, not from that plan, and
 * the window would not be the one it was planned in. So a plan dated before
 * the day its warnings were made for shows none, and neither does a plan
 * whose date is not known. The day is read off each warning, which keeps
 * the server's calendar date (the church's) and never the browser's.
 */
export function warningsToShow(
    warnings: Readonly<Record<string, RepeatWarning>>,
    planDate: string | null
): Record<string, RepeatWarning> {
    if (planDate === null) {
        return {};
    }
    return Object.fromEntries(
        Object.entries(warnings).filter(([, warning]) => {
            const day = warningDay(warning);
            return day !== null && planDate >= day;
        })
    );
}
