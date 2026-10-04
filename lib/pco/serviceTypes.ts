import "server-only";
import { cache } from "react";
import type { ServiceType } from "../domain";
import { pcoFetch, pcoFetchAll } from "./client";
import { assertPcoId } from "./ids";
import { toServiceType } from "./mappers";
import type { PcoServiceTypeResource, PcoSingleResponse } from "./resources";

/**
 * Every service type, in PCO's order, archived ones included (the all-plans
 * route never filtered them either). Follows links.next.
 */
export const getServiceTypes = cache(async (): Promise<ServiceType[]> => {
    const { data } = await pcoFetchAll<PcoServiceTypeResource>(
        "/service_types?per_page=100",
        "serviceTypes"
    );
    return data.map(toServiceType);
});

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
