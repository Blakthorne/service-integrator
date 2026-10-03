import "server-only";
import { cache } from "react";
import type {
    HymnData,
    Plan,
    PlanItemWithSong,
    PlanSummary,
    ServiceType,
} from "@/lib/domain";
import { hymnCatalog } from "@/lib/hymnCatalog";
import { buildHymnIndex, matchHymns } from "@/lib/hymnMatch";
import {
    getAllPlans,
    getPlan,
    getPlanItems,
    getServiceType,
    parsePcoId,
} from "@/lib/pco";
import { groupPlansByDate, sortPlanDates } from "@/lib/plansByDate";
import { createTtlCache } from "@/lib/ttlCache";

/** The hymnbook lookup, built once per server process. */
const hymnIndex = buildHymnIndex(hymnCatalog);

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

/** Everything a plan's pages show. */
export interface PlanDetail {
    plan: Plan;
    serviceType: ServiceType;
    /** The plan's items sorted by sequence, each joined to its song. */
    items: PlanItemWithSong[];
    /** Hymnbook matches for the song items' titles, in item order. */
    hymns: HymnData[];
}

/**
 * Load a plan, its service type and its items in parallel, and match its
 * songs against the hymnbooks. PCO errors pass through (wrap the call in
 * orNotFound to turn a missing plan into a 404).
 */
export const getPlanDetail = cache(
    async (serviceTypeId: string, planId: string): Promise<PlanDetail> => {
        const [plan, serviceType, { items }] = await Promise.all([
            getPlan(serviceTypeId, planId),
            getServiceType(serviceTypeId),
            getPlanItems(serviceTypeId, planId),
        ]);
        const songTitles = items
            .filter((item) => item.itemType === "song")
            .map((item) => item.title);
        return {
            plan,
            serviceType,
            items,
            hymns: matchHymns(hymnIndex, songTitles),
        };
    }
);

/** Page-title text for a plan and its items. */
export interface PlanLabels {
    /** "<service type name> · <plan dates>", e.g. "Sunday Morning · October 4, 2026". */
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
            const { plan, serviceType, items } = await getPlanDetail(
                serviceTypeId,
                planId
            );
            return {
                plan: `${serviceType.name} · ${plan.dates}`,
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
