import type { Route } from "next";

/**
 * Every internal href in the app comes from these builders (with
 * `typedRoutes: true`, `<Link href>` is checked against the routes that exist).
 *
 * Each builder returns a template literal `as const`. Do not annotate the
 * return type as `Route`: it only lists static routes, so a dynamic path such
 * as `/plans/${string}/${string}` would not compile. The literal type lets
 * `<Link>` match it against the route table.
 *
 * IDs are Planning Center ids: digit strings that `parsePcoId` has already
 * validated, so they are interpolated without encoding. Never pass anything
 * else (a title, free text, a raw URL parameter).
 */
export const routes = {
    home: () => "/" as const,
    plans: () => "/plans" as const,
    plan: (serviceTypeId: string, planId: string) =>
        `/plans/${serviceTypeId}/${planId}` as const,
    planSchedule: (serviceTypeId: string, planId: string) =>
        `/plans/${serviceTypeId}/${planId}/schedule` as const,
    planItem: (serviceTypeId: string, planId: string, itemId: string) =>
        `/plans/${serviceTypeId}/${planId}/items/${itemId}` as const,
    unusedHymns: () => "/unused-hymns" as const,
};

/** An entry of the top navigation bar. */
export interface NavItem {
    href: Route;
    label: string;
    /** Whether the link is the current section for `pathname` (no query string). */
    isActive: (pathname: string) => boolean;
}

/** True when `pathname` is `base` or below it: "/plans" matches "/plans/1" but not "/plansx". */
function isAtOrBelow(pathname: string, base: string): boolean {
    return pathname === base || pathname.startsWith(`${base}/`);
}

/** The top navigation bar, in display order. A new section adds its folder plus an entry here. */
export const NAV_ITEMS: readonly NavItem[] = [
    {
        // TODO(Phase 4): routes.plans()
        href: routes.home(),
        label: "Plans",
        isActive: (pathname) =>
            pathname === routes.home() || isAtOrBelow(pathname, routes.plans()),
    },
    {
        href: routes.unusedHymns(),
        label: "Unused Hymns",
        isActive: (pathname) => isAtOrBelow(pathname, routes.unusedHymns()),
    },
];

/** A tab of the plan page. Each tab is a nested route. */
export interface PlanTab {
    /** What `useSelectedLayoutSegment()` returns for the tab: `null` for the default tab. */
    segment: string | null;
    label: string;
    href: (serviceTypeId: string, planId: string) => string;
}

/**
 * The tabs of the plan page, in display order. `satisfies` keeps each `href`
 * builder's literal return type, so `<Link href={tab.href(st, plan)}>` stays
 * type-checked.
 */
export const PLAN_TABS = [
    { segment: null, label: "Copyright Information", href: routes.plan },
    {
        segment: "schedule",
        label: "Service Schedule",
        href: routes.planSchedule,
    },
] as const satisfies readonly PlanTab[];

const PCO_WEB_ORIGIN = "https://services.planningcenteronline.com";

/**
 * Links out to the Planning Center web app, for plain `<a target="_blank">`
 * links. These are the same URLs the UI builds today. IDs follow the same
 * rule as `routes`: validated digit strings, interpolated without encoding.
 */
export const pcoWebUrls = {
    plan: (planId: string) => `${PCO_WEB_ORIGIN}/plans/${planId}`,
    song: (songId: string) => `${PCO_WEB_ORIGIN}/songs/${songId}`,
};
