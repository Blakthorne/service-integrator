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
