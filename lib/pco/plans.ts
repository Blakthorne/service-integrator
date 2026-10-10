import "server-only";
import { cache } from "react";
import type { Plan, PlanSummary } from "../domain";
import { pcoFetch, pcoFetchAll, type PcoRequestOptions } from "./client";
import { assertPcoId, type PcoId } from "./ids";
import { toPlan } from "./mappers";
import type {
    PcoListResponse,
    PcoPlanField,
    PcoPlanResource,
    PcoSingleResponse,
} from "./resources";
import { fetchServiceTypes, getServiceTypes } from "./serviceTypes";

/** Up to 2,000 plans per service type; beyond that the fetch fails loudly. */
const MAX_PLAN_PAGES = 20;

/** Up to 500 upcoming plans per service type; the spike found just next Sunday's. */
const MAX_UPCOMING_PLAN_PAGES = 5;

/** The attributes a plan listing asks for: those `toPlan` reads, each once (a Record keeps the list whole). */
const PLAN_FIELDS: Readonly<Record<PcoPlanField, true>> = {
    created_at: true,
    dates: true,
    items_count: true,
    planning_center_url: true,
    short_dates: true,
    sort_date: true,
    title: true,
    updated_at: true,
};

/**
 * A service type's plans, newest first, 100 to a page, with only the
 * attributes `toPlan` reads (`fields[Plan]`). Planning Center works out each
 * of a plan's 26 attributes as it sends it, so a page of 100 with all of them
 * took 2.7 to 3.9 s, and with these 0.5 s; `links.next` keeps the fields.
 */
function planListingPath(id: PcoId): string {
    const fields = Object.keys(PLAN_FIELDS).join(",");
    return `/service_types/${id}/plans?order=-sort_date&per_page=100&fields[Plan]=${fields}`;
}

/**
 * All of a service type's plans, newest first, paging 100 at a time through
 * links.next. Throws InvalidPcoIdError, PcoError, or an error if the type
 * has more than MAX_PLAN_PAGES pages of plans.
 */
export const getPlansForServiceType = cache(
    async (serviceTypeId: string): Promise<Plan[]> => {
        const id = assertPcoId(serviceTypeId);
        const { data } = await pcoFetchAll<PcoPlanResource>(planListingPath(id), "plans", {
            maxPages: MAX_PLAN_PAGES,
        });
        return data.map((plan) => toPlan(plan, id));
    }
);

/**
 * Every plan of every service type (archived ones included), for the
 * history sync: each type's plans paged 100 at a time, each request paced
 * (it waits its turn at the shared pacer) and not wrapped in `cache()`,
 * since a job runs outside any request and must read Planning Center afresh
 * every time.
 *
 * It returns the whole listing or throws: PcoError for a failed page, an
 * error past MAX_PLAN_PAGES pages for a type, and an error when a type sent
 * fewer plans than its first page's `total_count` said it has (a plan was
 * added or removed while it was read, and offset paging skipped one), since
 * the sync takes a plan missing from the listing to be gone. A plan sent
 * twice, as such a change can also cause, appears once. Plans are in
 * service-type order, newest first within a type.
 */
export async function fetchAllPlans({ paced = false }: PcoRequestOptions = {}): Promise<Plan[]> {
    const serviceTypes = await fetchServiceTypes({ paced });
    const plans = new Map<string, Plan>();
    for (const serviceType of serviceTypes) {
        const id = assertPcoId(serviceType.id);
        const { data, totalCount } = await pcoFetchAll<PcoPlanResource>(
            planListingPath(id),
            "plans",
            { maxPages: MAX_PLAN_PAGES, paced }
        );
        const sent = new Set<string>();
        for (const resource of data) {
            sent.add(resource.id);
            if (!plans.has(resource.id)) {
                plans.set(resource.id, toPlan(resource, id));
            }
        }
        if (sent.size < totalCount) {
            throw new Error(
                `Planning Center listed ${totalCount} plans for service type ${id} but sent ${sent.size}: the plans changed while they were read`
            );
        }
    }
    return [...plans.values()];
}

/** What getAllPlans returns. */
export interface AllPlans {
    /** Each service type's plans, in service-type order. */
    plans: PlanSummary[];
    /** Service types whose plans could not be fetched (and are missing). */
    failedServiceTypeIds: string[];
}

/**
 * The plans of every service type, each tagged with its type's ID and name.
 * A type whose plans fail to load is logged, skipped and reported in
 * `failedServiceTypeIds`; failing to load the service types throws.
 */
export const getAllPlans = cache(async (): Promise<AllPlans> => {
    const serviceTypes = await getServiceTypes();
    const results = await Promise.allSettled(
        serviceTypes.map((serviceType) => getPlansForServiceType(serviceType.id))
    );

    const plans: PlanSummary[] = [];
    const failedServiceTypeIds: string[] = [];
    results.forEach((result, i) => {
        const { id, name } = serviceTypes[i];
        if (result.status === "fulfilled") {
            for (const plan of result.value) {
                plans.push({ ...plan, serviceType: { id, name } });
            }
        } else {
            console.error(
                `Failed to fetch plans for service type ${id}:`,
                result.reason
            );
            failedServiceTypeIds.push(id);
        }
    });
    return { plans, failedServiceTypeIds };
});

/** One plan of a service type. Throws InvalidPcoIdError or PcoError (404 if missing). */
export const getPlan = cache(
    async (serviceTypeId: string, planId: string): Promise<Plan> => {
        const st = assertPcoId(serviceTypeId);
        const id = assertPcoId(planId);
        const { data } = await pcoFetch<PcoSingleResponse<PcoPlanResource>>(
            `/service_types/${st}/plans/${id}`,
            "plans"
        );
        return toPlan(data, st);
    }
);

/**
 * A service type's next plan: of the plans Planning Center counts as future
 * (`filter=future`, which keeps all of today's plans for the whole day, as
 * the spike found), the earliest by `sort_date`, or null when there is
 * none. One request: it asks for them earliest first (`order=sort_date`),
 * and only a few plans lie ahead (the spike found just next Sunday's), so
 * the first page holds the earliest; the earliest is picked here too, so
 * the answer stands whatever order the page comes in. Throws
 * InvalidPcoIdError or PcoError.
 */
export const getNextPlan = cache(async (serviceTypeId: string): Promise<Plan | null> => {
    const id = assertPcoId(serviceTypeId);
    const { data } = await pcoFetch<PcoListResponse<PcoPlanResource>>(
        `/service_types/${id}/plans?filter=future&order=sort_date&per_page=25`,
        "plans"
    );
    let next: Plan | null = null;
    for (const resource of data) {
        const plan = toPlan(resource, id);
        if (next === null || plan.sortDate < next.sortDate) {
            next = plan;
        }
    }
    return next;
});

/**
 * A service type's upcoming plans: those Planning Center counts as future
 * (`filter=future`, which keeps all of today's plans for the whole day, as
 * the spike found), earliest first by `sort_date` (asked for, and sorted
 * here too, so the order stands whatever order the pages come in). Every
 * page, read afresh every time: for a write that must check a plan is
 * still ahead. Throws InvalidPcoIdError or PcoError (404 when there is no
 * such service type).
 */
export async function fetchUpcomingPlans(serviceTypeId: string): Promise<Plan[]> {
    const id = assertPcoId(serviceTypeId);
    const { data } = await pcoFetchAll<PcoPlanResource>(
        `/service_types/${id}/plans?filter=future&order=sort_date&per_page=100`,
        "plans",
        { maxPages: MAX_UPCOMING_PLAN_PAGES }
    );
    return data
        .map((plan) => toPlan(plan, id))
        .sort((a, b) => (a.sortDate < b.sortDate ? -1 : a.sortDate > b.sortDate ? 1 : 0));
}

/** `fetchUpcomingPlans`, deduped within a request: what pages read. */
export const getUpcomingPlans = cache(fetchUpcomingPlans);
