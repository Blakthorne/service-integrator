import "server-only";
import { cache } from "react";
import { getDb } from "@/lib/db";
import { findCatalogMatches, listCatalogSongs } from "@/lib/db/catalog";
import { errorMessage } from "@/lib/db/errors";
import { lastPastOccurrences } from "@/lib/db/history";
import { findPcoSongs } from "@/lib/db/pcoSongs";
import type {
    CatalogMatch,
    LinkSuggestion,
    Plan,
    PlanItemWithSong,
    PlanSummary,
    ScheduleSelection,
    ServiceType,
} from "@/lib/domain";
import { planHymnNoteStatus, type HymnNoteStatus } from "@/lib/hymnNotes";
import {
    getAllPlans,
    getPlan,
    getPlanItems,
    getServiceType,
    parsePcoId,
} from "@/lib/pco";
import { planLabel } from "@/lib/planLabel";
import { groupPlansByDate, localYmd, sortPlanDates } from "@/lib/plansByDate";
import { TOP_SUGGESTIONS, buildCatalogIndex, suggestLinks } from "@/lib/reconcile";
import { repeatWarningFor, repeatWindowStart, type RepeatWarning } from "@/lib/repeatWarnings";
import { planTextSettings, type PlanTextSettings } from "@/lib/settings";
import { createTtlCache } from "@/lib/ttlCache";
import { readAppWrittenNoteIds, readItemNoteCategories } from "./hymnNotes";
import { getScheduleSelections } from "./selections";
import { getSettings } from "./settings";

/** What the plans list shows. */
export interface PlansByDate {
    /** The dates (`YYYY-MM-DD`) that have plans, newest first. */
    dates: string[];
    /** The plans on each date, the later service first. */
    plansByDate: Record<string, PlanSummary[]>;
    /** Service types whose plans could not be loaded, so are missing. */
    failedServiceTypeIds: string[];
}

/** Every service type's plans, grouped by date for the plans list. */
export const getPlansByDate = cache(async (): Promise<PlansByDate> => {
    const { plans, failedServiceTypeIds } = await getAllPlans();
    const plansByDate = groupPlansByDate(plans);
    return {
        dates: sortPlanDates(plansByDate),
        plansByDate,
        failedServiceTypeIds,
    };
});

/** What Planning Center gives a plan's pages: the plan, its service type and its items. */
export interface PlanData {
    plan: Plan;
    serviceType: ServiceType;
    /** The plan's items sorted by sequence, each joined to its song. */
    items: PlanItemWithSong[];
}

/** Everything a plan's pages show. */
export interface PlanDetail extends PlanData {
    /**
     * The catalog song each song item's Planning Center song is linked to,
     * by Planning Center song id: its title, tune and labelled entries in
     * book order, in the books in use only (a book that is not active
     * prints no numbers: `findCatalogMatches`). A song that is not linked
     * has no entry, so an item renamed in the plan keeps its numbers.
     */
    catalog: Record<string, CatalogMatch>;
    /**
     * The best few catalog songs (`TOP_SUGGESTIONS`) for each song item's
     * Planning Center song that is not linked, by Planning Center song id,
     * matched by the song's own title rather than the item's; an empty list
     * when nothing matches. A song set aside as not hymnal material
     * (ignored on Reconcile) has no entry.
     */
    suggestions: Record<string, LinkSuggestion[]>;
    /**
     * Why the catalog could not be read (the database cannot be opened, or a
     * query failed), or null when it was read. `catalog` and `suggestions`
     * are then empty: the plan's pages work without them, and the Schedule
     * tab says that numbers cannot be shown.
     */
    catalogError: string | null;
    /**
     * The Schedule tab's saved choices for this plan's items, by item id,
     * to seed its reducer. A choice whose option this build does not know,
     * or for an item no longer in the plan, is left out (and stays stored).
     * A choice that no longer makes sense (Numbers for a song that lost its
     * link) is kept: `mergeScheduleSelections` shows the default instead.
     */
    selections: Record<string, ScheduleSelection>;
    /**
     * Why the saved choices could not be read, or null when they were.
     * `selections` is then empty, and every song shows its default.
     */
    selectionsError: string | null;
    /**
     * The settings this plan's text follows, resolved for its service type:
     * the schedule header label, the number separator, the CCLI number, and
     * the credit roles and phrases. The copyright text takes it as it is.
     */
    scheduleSettings: PlanTextSettings;
    /**
     * Why the settings could not be read, or null when they were;
     * `scheduleSettings` then holds the defaults, today's text.
     */
    settingsError: string | null;
    /**
     * The plan's hymnal notes against its service type's category (see
     * `planHymnNoteStatus`): each song item's diff when the category is
     * found, or why it cannot be compared: no such category, or the
     * categories or the catalog could not be read.
     */
    hymnNoteStatus: HymnNoteStatus;
    /**
     * The song items that repeat a song sung lately, by item id: the past
     * plan (dated before today) its Planning Center song was last sung in,
     * from the plan history, when that is within the `repeatWarningWeeks`
     * setting's weeks before today, leaving out this plan itself. An item
     * with no song, or whose song was not sung lately, has no entry, and
     * none has when the warnings are off (0 weeks). When the history cannot
     * be read it is logged and there are none: the plan's pages go on
     * without the warnings.
     */
    repeatWarnings: Record<string, RepeatWarning>;
}

/**
 * Load a plan, its service type and its items in parallel: the Planning
 * Center part of `getPlanDetail`, which `getPlanLabels` shares without
 * touching the database.
 */
const getPlanData = cache(
    async (serviceTypeId: string, planId: string): Promise<PlanData> => {
        const [plan, serviceType, { items }] = await Promise.all([
            getPlan(serviceTypeId, planId),
            getServiceType(serviceTypeId),
            getPlanItems(serviceTypeId, planId),
        ]);
        return { plan, serviceType, items };
    }
);

/**
 * The catalog links of a plan's song items (see `PlanDetail`): the linked
 * songs' catalog songs, and suggestions for the others. It opens the
 * database only when a song item has a Planning Center song, and then asks
 * at most seven queries, however many items: two for the links, one for the
 * mirror's ignored marks, and four for the catalog when a song needs
 * suggestions. Throws when the database cannot be read. The dashboard asks
 * it once for the items of every plan it shows.
 */
export function planCatalogLinks(
    items: readonly PlanItemWithSong[]
): Pick<PlanDetail, "catalog" | "suggestions"> {
    /** Each Planning Center song the items schedule, with its title as Planning Center gives it, if it does. */
    const songTitles = new Map<string, string | null>();
    /** The first item title of each, the last resort to suggest by. */
    const itemTitles = new Map<string, string>();
    for (const item of items) {
        if (item.itemType === "song" && item.songId !== null && !songTitles.has(item.songId)) {
            songTitles.set(item.songId, item.song?.title ?? null);
            itemTitles.set(item.songId, item.title);
        }
    }
    const pcoSongIds = [...songTitles.keys()];
    if (pcoSongIds.length === 0) {
        return { catalog: {}, suggestions: {} };
    }
    const db = getDb();
    const matches = findCatalogMatches(db, pcoSongIds);
    const unlinked = pcoSongIds.filter((id) => !matches.has(id));
    const suggestions: Record<string, LinkSuggestion[]> = {};
    if (unlinked.length > 0) {
        const mirrored = findPcoSongs(db, unlinked);
        const linkable = unlinked.filter((id) => (mirrored.get(id)?.ignoredAt ?? null) === null);
        if (linkable.length > 0) {
            const index = buildCatalogIndex(listCatalogSongs(db));
            for (const id of linkable) {
                const title =
                    songTitles.get(id) ?? mirrored.get(id)?.title ?? itemTitles.get(id) ?? "";
                suggestions[id] = suggestLinks({ title }, index).slice(0, TOP_SUGGESTIONS);
            }
        }
    }
    return { catalog: Object.fromEntries(matches), suggestions };
}

/**
 * `planCatalogLinks`, or no links and the reason when the catalog cannot be
 * read. Never throws: a failure is logged, and the plan's pages go on
 * without the catalog.
 */
function readPlanCatalogLinks(
    serviceTypeId: string,
    planId: string,
    items: readonly PlanItemWithSong[]
): Pick<PlanDetail, "catalog" | "suggestions" | "catalogError"> {
    try {
        return { ...planCatalogLinks(items), catalogError: null };
    } catch (error) {
        console.error(
            `Failed to read the catalog links of plan ${serviceTypeId}/${planId}:`,
            error
        );
        return { catalog: {}, suggestions: {}, catalogError: errorMessage(error) };
    }
}

/**
 * The saved choices for a plan's items (see `PlanDetail.selections`), or
 * none and the reason when they cannot be read. Never throws: a failure is
 * logged.
 */
function readPlanSelections(
    serviceTypeId: string,
    planId: string,
    items: readonly PlanItemWithSong[]
): Pick<PlanDetail, "selections" | "selectionsError"> {
    try {
        const inPlan = new Set(items.map((item) => item.id));
        return {
            selections: Object.fromEntries(
                Object.entries(getScheduleSelections(planId)).filter(([itemId]) =>
                    inPlan.has(itemId)
                )
            ),
            selectionsError: null,
        };
    } catch (error) {
        console.error(
            `Failed to read the saved choices of plan ${serviceTypeId}/${planId}:`,
            error
        );
        return { selections: {}, selectionsError: errorMessage(error) };
    }
}

/**
 * The warnings for the song items of plan `planId` that repeat a song sung
 * in the last `weeks` weeks (see `PlanDetail.repeatWarnings`), as of `now`.
 * One query, and none for a plan without song items or with the warnings
 * off. Never throws: a failure is logged and gives none.
 */
function readRepeatWarnings(
    planId: string,
    items: readonly PlanItemWithSong[],
    weeks: number,
    now: Date = new Date()
): Record<string, RepeatWarning> {
    const songItems = items.filter((item) => item.itemType === "song" && item.songId !== null);
    if (weeks <= 0 || songItems.length === 0) {
        return {};
    }
    try {
        const today = localYmd(now);
        const from = repeatWindowStart(today, weeks);
        if (from === null) {
            return {};
        }
        const latest = lastPastOccurrences(
            getDb(),
            songItems.flatMap((item) => (item.songId === null ? [] : [item.songId])),
            { from, today, excludePlanId: planId }
        );
        const warnings: Record<string, RepeatWarning> = {};
        for (const item of songItems) {
            const sung = item.songId === null ? undefined : latest.get(item.songId);
            if (sung !== undefined) {
                warnings[item.id] = repeatWarningFor(sung, today);
            }
        }
        return warnings;
    } catch (error) {
        console.error(`Failed to read the repeat warnings of plan ${planId}:`, error);
        return {};
    }
}

/**
 * Load a plan, its service type and its items, and the service type's item
 * note categories, in parallel (four requests); then find the songs'
 * catalog links and suggestions, the plan's saved choices, the settings,
 * which of its notes the app wrote and which of its songs were sung lately
 * in the database (at most eleven queries), and compare the hymnal notes. PCO
 * errors in the plan, its service type or its items pass through (wrap the
 * call in orNotFound to turn a missing plan into a 404). Nothing else does:
 * categories or a database that cannot be read leave the plan without what
 * they would give, each with the reason (`catalogError`, `selectionsError`,
 * `settingsError`, `hymnNoteStatus`).
 */
export const getPlanDetail = cache(
    async (serviceTypeId: string, planId: string): Promise<PlanDetail> => {
        const [{ plan, serviceType, items }, categories] = await Promise.all([
            getPlanData(serviceTypeId, planId),
            readItemNoteCategories(serviceTypeId),
        ]);
        const links = readPlanCatalogLinks(serviceTypeId, planId, items);
        const { settings, error: settingsError } = getSettings();
        return {
            plan,
            serviceType,
            items,
            ...links,
            ...readPlanSelections(serviceTypeId, planId, items),
            scheduleSettings: planTextSettings(settings, serviceType),
            settingsError,
            hymnNoteStatus: planHymnNoteStatus({
                serviceTypeName: serviceType.name,
                items,
                catalog: links.catalog,
                catalogError: links.catalogError,
                categories,
                settings,
                settingsError,
                ownedNoteIds: readAppWrittenNoteIds(items),
            }),
            repeatWarnings: readRepeatWarnings(plan.id, items, settings.repeatWarningWeeks),
        };
    }
);

/** Page-title text for a plan and its items. */
export interface PlanLabels {
    /** The plan's label (see planLabel), e.g. "October 4, 2026 · Sunday Morning". */
    plan: string;
    /** Each item's title, by item ID. */
    items: Record<string, string>;
}

const PLAN_LABELS_TTL_MS = 5 * 60 * 1000;

const planLabelsCache = createTtlCache<string, PlanLabels>({
    ttlMs: PLAN_LABELS_TTL_MS,
});

function fallbackLabels(): PlanLabels {
    return { plan: "Plan", items: {} };
}

/**
 * Labels for `generateMetadata`, which re-runs on every navigation, so they
 * are cached for 5 minutes per plan. Never throws: on any error it logs and
 * returns the generic "Plan" label, and invalid IDs get that label without
 * calling PCO (the page itself renders the 404).
 */
export async function getPlanLabels(
    serviceTypeId: string,
    planId: string
): Promise<PlanLabels> {
    if (parsePcoId(serviceTypeId) === null || parsePcoId(planId) === null) {
        return fallbackLabels();
    }
    try {
        return await planLabelsCache.get(`${serviceTypeId}/${planId}`, async () => {
            const { plan, serviceType, items } = await getPlanData(
                serviceTypeId,
                planId
            );
            return {
                plan: planLabel(plan, serviceType),
                items: Object.fromEntries(
                    items.map((item) => [item.id, item.title])
                ),
            };
        });
    } catch (error) {
        console.error(
            `Failed to load labels for plan ${serviceTypeId}/${planId}:`,
            error
        );
        return fallbackLabels();
    }
}
