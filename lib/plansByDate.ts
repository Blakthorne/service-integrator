import type { Plan } from "./domain";

/**
 * Sort plans newest first and group them by calendar date. Sorting is a plain
 * string comparison of `sortDate`, done on a copy so `plans` is not mutated.
 * Plans are grouped by the part of `sortDate` before the "T". The sort is
 * stable, so plans with equal `sortDate` keep their input order (the all-plans
 * route passes them in service-type order), and the keys of the result are in
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

/**
 * Heading text for a `YYYY-MM-DD` plan date, e.g. "2025-06-15" becomes
 * "Sunday, June 15, 2025". The date is parsed and formatted in the runtime's
 * local time zone, so it shows the same calendar day everywhere.
 */
export function formatPlanDateHeading(date: string): string {
    return new Date(date + "T00:00:00").toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
    });
}
