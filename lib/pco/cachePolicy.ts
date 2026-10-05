import "server-only";

/** The kinds of PCO resources the app fetches; each can be cached differently. */
export type PcoResourceKind =
    | "serviceTypes"
    | "plans"
    | "planItems"
    | "itemNoteCategories"
    | "songs";

/**
 * The fetch cache options for each kind of PCO resource: the single switch for
 * HTTP caching of PCO data. Everything is fetched fresh today, as the old API
 * routes did; per-request dedupe comes from React `cache()` in the getters.
 */
export const PCO_CACHE_POLICY: Readonly<Record<PcoResourceKind, RequestInit>> = {
    serviceTypes: { cache: "no-store" },
    plans: { cache: "no-store" },
    planItems: { cache: "no-store" },
    itemNoteCategories: { cache: "no-store" },
    songs: { cache: "no-store" },
};
