import "server-only";
import { cache } from "react";
import type { ServiceType } from "../domain";
import { pcoFetch, pcoFetchAll, type PcoRequestOptions } from "./client";
import { assertPcoId } from "./ids";
import { toServiceType } from "./mappers";
import type { PcoServiceTypeResource, PcoSingleResponse } from "./resources";

/**
 * Every service type, in PCO's order, archived ones included (the all-plans
 * route never filtered them either). Follows links.next. Read afresh every
 * time; a background job passes `paced: true`, and pages use
 * `getServiceTypes`.
 */
export async function fetchServiceTypes({
    paced = false,
}: PcoRequestOptions = {}): Promise<ServiceType[]> {
    const { data } = await pcoFetchAll<PcoServiceTypeResource>(
        "/service_types?per_page=100",
        "serviceTypes",
        { paced }
    );
    return data.map(toServiceType);
}

/** `fetchServiceTypes`, deduped within a request: what pages read. */
export const getServiceTypes = cache(async (): Promise<ServiceType[]> => fetchServiceTypes());

/** One service type. Throws InvalidPcoIdError or PcoError (404 if missing). */
export const getServiceType = cache(
    async (serviceTypeId: string): Promise<ServiceType> => {
        const id = assertPcoId(serviceTypeId);
        const { data } = await pcoFetch<PcoSingleResponse<PcoServiceTypeResource>>(
            `/service_types/${id}`,
            "serviceTypes"
        );
        return toServiceType(data);
    }
);
