import "server-only";
import { cache } from "react";
import type { Plan, PlanSummary } from "../domain";
import { pcoFetch, pcoFetchAll } from "./client";
import { assertPcoId } from "./ids";
import { toPlan } from "./mappers";
import type {
    PcoListResponse,
    PcoPlanResource,
    PcoSingleResponse,
} from "./resources";
import { getServiceTypes } from "./serviceTypes";

/** Up to 2,000 plans per service type; beyond that the fetch fails loudly. */
const MAX_PLAN_PAGES = 20;

/**
 * All of a service type's plans, newest first, paging 100 at a time through
 * links.next. Throws InvalidPcoIdError, PcoError, or an error if the type
 * has more than MAX_PLAN_PAGES pages of plans.
 */
export const getPlansForServiceType = cache(
    async (serviceTypeId: string): Promise<Plan[]> => {
        const id = assertPcoId(serviceTypeId);
        const { data } = await pcoFetchAll<PcoPlanResource>(
            `/service_types/${id}/plans?order=-sort_date&per_page=100`,
            "plans",
            { maxPages: MAX_PLAN_PAGES }
        );
        return data.map((plan) => toPlan(plan, id));
    }
);

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
 * (`filter=future`), the earliest by `sort_date`, or null when there is
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
