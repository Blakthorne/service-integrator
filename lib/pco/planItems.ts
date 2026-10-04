import "server-only";
import { cache } from "react";
import type { PlanItemWithSong } from "../domain";
import { pcoFetchAll } from "./client";
import { assertPcoId } from "./ids";
import { joinItemsToSongs, toPlanItem } from "./mappers";
import type { PcoItemResource } from "./resources";

/** What getPlanItems returns. */
export interface PlanItems {
    /** The plan's items sorted by sequence, each joined to its song. */
    items: PlanItemWithSong[];
    /** PCO's `meta.total_count` for the plan's items. */
    totalCount: number;
}

/**
 * All of a plan's items with their songs (`include=song`), sorted by
 * sequence. Pages 100 at a time through links.next, so long plans are not cut
 * off at PCO's default page size of 25. Throws InvalidPcoIdError or PcoError
 * (404 if the plan is missing).
 */
export const getPlanItems = cache(
    async (serviceTypeId: string, planId: string): Promise<PlanItems> => {
        const st = assertPcoId(serviceTypeId);
        const id = assertPcoId(planId);
        const { data, included, totalCount } =
            await pcoFetchAll<PcoItemResource>(
                `/service_types/${st}/plans/${id}/items?include=song&per_page=100`,
                "planItems"
            );
        const items = data
            .map(toPlanItem)
            .sort((a, b) => a.sequence - b.sequence);
        return { items: joinItemsToSongs(items, included), totalCount };
    }
);
