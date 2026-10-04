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
 * Every id or code they take has already been validated, so it is interpolated
 * without encoding: Planning Center ids are digit strings from `parsePcoId`,
 * catalog ids are integers from `parseCatalogId` and book codes come from
 * `parseBookCode` (letters, digits, `-` and `_`). Never pass anything else (a
 * title, free text, a raw URL parameter).
 */
/** Filters of the catalog's songs list that other pages link to. */
export interface CatalogListFilters {
    linked?: "yes" | "no";
    used?: "never";
}

export const routes = {
    home: () => "/" as const,
    plans: () => "/plans" as const,
    plan: (serviceTypeId: string, planId: string) =>
        `/plans/${serviceTypeId}/${planId}` as const,
    planSchedule: (serviceTypeId: string, planId: string) =>
        `/plans/${serviceTypeId}/${planId}/schedule` as const,
    planItem: (serviceTypeId: string, planId: string, itemId: string) =>
        `/plans/${serviceTypeId}/${planId}/items/${itemId}` as const,
    settings: () => "/settings" as const,
    catalog: () => "/catalog" as const,
    catalogSong: (songId: number) => `/catalog/songs/${songId}` as const,
    catalogTunes: () => "/catalog/tunes" as const,
    catalogTune: (tuneId: number) => `/catalog/tunes/${tuneId}` as const,
    catalogBooks: () => "/catalog/books" as const,
    catalogBook: (bookCode: string) => `/catalog/books/${bookCode}` as const,
    catalogImport: () => "/catalog/import" as const,
    catalogImportRun: (runId: number) => `/catalog/import/${runId}` as const,
    /**
     * The songs list with filters set, for links from other pages (Reconcile,
     * the old Unused Hymns URL). The values are the list's own URL filters
     * (see lib/catalog/filter.ts).
     */
    catalogFiltered: (filters: CatalogListFilters) => {
        const query = new URLSearchParams();
        if (filters.linked !== undefined) {
            query.set("linked", filters.linked);
        }
        if (filters.used !== undefined) {
            query.set("used", filters.used);
        }
        const search = query.toString();
        return search === ""
            ? ("/catalog" as const)
            : (`/catalog?${search}` as const);
    },
    catalogReconcile: () => "/catalog/reconcile" as const,
    /**
     * The new-song form. With a Planning Center song it is prefilled from
     * that song and links it on create; `returnTo` (a path that
     * `safeCallbackUrl` accepts) is where the form goes back to afterwards.
     */
    catalogSongNew: (options: { pcoSongId?: string; returnTo?: string } = {}) => {
        const query = new URLSearchParams();
        if (options.pcoSongId !== undefined) {
            query.set("pcoSongId", options.pcoSongId);
        }
        if (options.returnTo !== undefined) {
            query.set("returnTo", options.returnTo);
        }
        const search = query.toString();
        return search === ""
            ? ("/catalog/songs/new" as const)
            : (`/catalog/songs/new?${search}` as const);
    },
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
        href: routes.plans(),
        label: "Plans",
        isActive: (pathname) =>
            pathname === routes.home() || isAtOrBelow(pathname, routes.plans()),
    },
    {
        href: routes.catalog(),
        label: "Catalog",
        isActive: (pathname) => isAtOrBelow(pathname, routes.catalog()),
    },
];

/** The icons a utility link can show; `Navigation/NavUtilityLinks.tsx` draws each. */
export type NavIcon = "gear";

/** An icon link at the right of the top bar. Its `label` is its accessible name and tooltip. */
export interface NavUtilityItem extends NavItem {
    icon: NavIcon;
}

/** The icon links beside Sign Out, in display order. */
export const NAV_UTILITY_ITEMS: readonly NavUtilityItem[] = [
    {
        href: routes.settings(),
        label: "Settings",
        icon: "gear",
        isActive: (pathname) => isAtOrBelow(pathname, routes.settings()),
    },
];

/**
 * The `aria-current` value for a nav item at `pathname`: "page" on the item's
 * own page, "true" anywhere else in its section, and undefined outside it.
 *
 * Inside a section the page's own breadcrumb is the one marked
 * `aria-current="page"`, so the nav item only says "true"; that way a plan page
 * does not announce both as the current page.
 */
export function navAriaCurrent(
    item: NavItem,
    pathname: string
): "page" | "true" | undefined {
    if (!item.isActive(pathname)) {
        return undefined;
    }
    return pathname === item.href ? "page" : "true";
}

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

/** A section of the catalog, shown in its sub-navigation. */
export interface CatalogSection {
    /**
     * The segment below the catalog layout on this section's pages, route
     * groups skipped, as `catalogLayoutSegment(useSelectedLayoutSegments())`
     * gives it (`lib/catalog/sections.ts`): `null` is the songs list at
     * `/catalog` itself, and a song page's segment is `"songs"`. Not
     * `useSelectedLayoutSegment()`, which returns `"(list)"` at `/catalog`,
     * the route group the songs list sits in.
     */
    segments: readonly (string | null)[];
    label: string;
    href: Route;
}

/** The catalog's sections, in display order. A new section adds its folder plus an entry here. */
export const CATALOG_SECTIONS: readonly CatalogSection[] = [
    { segments: [null, "songs"], label: "Songs", href: routes.catalog() },
    { segments: ["tunes"], label: "Tunes", href: routes.catalogTunes() },
    { segments: ["books"], label: "Books", href: routes.catalogBooks() },
    { segments: ["reconcile"], label: "Reconcile", href: routes.catalogReconcile() },
    { segments: ["import"], label: "Import", href: routes.catalogImport() },
];

/**
 * The catalog section that a segment from `catalogLayoutSegment` belongs to,
 * or undefined for a segment no section claims (a route group among them).
 */
export function catalogSectionFor(
    segment: string | null
): CatalogSection | undefined {
    return CATALOG_SECTIONS.find((section) => section.segments.includes(segment));
}

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
