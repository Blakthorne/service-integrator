import "server-only";
import { cache } from "react";
import type { PlanItemWithSong } from "../domain";
import { pcoFetch } from "./client";
import { assertPcoId } from "./ids";
import { joinItemsToSongs, toPlanItem } from "./mappers";
import type {
    PcoItemResource,
    PcoListResponse,
    PcoResourceIdentifier,
} from "./resources";

/** What getPlanItems returns. */
export interface PlanItems {
    /** The plan's items sorted by sequence, each joined to its song. */
    items: PlanItemWithSong[];
    /** PCO's `meta.total_count` for the plan's items. */
    totalCount: number;
}

/**
 * A plan's items with their songs (`include=song`), sorted by sequence.
 * Throws InvalidPcoIdError or PcoError (404 if the plan is missing).
 */
export const getPlanItems = cache(
    async (serviceTypeId: string, planId: string): Promise<PlanItems> => {
        const st = assertPcoId(serviceTypeId);
        const id = assertPcoId(planId);
        const page = await pcoFetch<
            PcoListResponse<PcoItemResource, PcoResourceIdentifier>
        >(`/service_types/${st}/plans/${id}/items?include=song`, "planItems");
        const items = page.data
            .map(toPlanItem)
            .sort((a, b) => a.sequence - b.sequence);
        return {
            items: joinItemsToSongs(items, page.included ?? []),
            totalCount: page.meta.total_count,
        };
    }
);
