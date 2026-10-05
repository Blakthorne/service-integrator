import "server-only";
import { cache } from "react";
import type { ItemNoteCategory, PlanItem, PlanItemWithSong } from "../domain";
import { pcoFetchAll, type PcoRequestOptions } from "./client";
import { assertPcoId } from "./ids";
import {
    itemNotesByItem,
    joinItemsToSongs,
    toItemNoteCategory,
    toPlanItem,
} from "./mappers";
import type { PcoItemNoteCategoryResource, PcoItemResource } from "./resources";

/** What getPlanItems returns. */
export interface PlanItems {
    /** The plan's items sorted by sequence, each joined to its song and its notes. */
    items: PlanItemWithSong[];
    /** PCO's `meta.total_count` for the plan's items. */
    totalCount: number;
}

/**
 * All of a plan's items with their songs and item notes
 * (`include=song,item_notes`), sorted by sequence, read afresh every time:
 * for a write that must start from what Planning Center has now
 * (refresh-before-write). Pages and other reads use `getPlanItems`, which
 * is this, deduped within a request. Pages 100 at a time through
 * links.next, so long plans are not cut off at PCO's default page size of
 * 25. Throws InvalidPcoIdError or PcoError (404 if the plan is missing).
 */
export async function fetchPlanItems(
    serviceTypeId: string,
    planId: string
): Promise<PlanItems> {
    const st = assertPcoId(serviceTypeId);
    const id = assertPcoId(planId);
    const { data, included, totalCount } = await pcoFetchAll<PcoItemResource>(
        `/service_types/${st}/plans/${id}/items?include=song,item_notes&per_page=100`,
        "planItems"
    );
    const notes = itemNotesByItem(data, included);
    const items = data.map(toPlanItem).sort((a, b) => a.sequence - b.sequence);
    return {
        items: joinItemsToSongs(items, included).map((item) => ({
            ...item,
            notes: notes.get(item.id) ?? [],
        })),
        totalCount,
    };
}

/**
 * A plan's song items, in sequence order: its items with `include=song`
 * (paged 100 at a time) kept to those of type "song" that name a Planning
 * Center song, which is what the history keeps of a plan. An item whose
 * song was deleted in Planning Center becomes a plain item there, so it is
 * left out too. Read afresh every time, and paced when `paced` is true: the
 * history sync's reads, which run outside any request. Throws
 * InvalidPcoIdError before fetching, or PcoError (404 if the plan is
 * missing).
 */
export async function fetchPlanSongItems(
    serviceTypeId: string,
    planId: string,
    { paced = false }: PcoRequestOptions = {}
): Promise<PlanItem[]> {
    const st = assertPcoId(serviceTypeId);
    const id = assertPcoId(planId);
    const { data } = await pcoFetchAll<PcoItemResource>(
        `/service_types/${st}/plans/${id}/items?include=song&per_page=100`,
        "planItems",
        { paced }
    );
    return data
        .map(toPlanItem)
        .filter((item) => item.itemType === "song" && item.songId !== null)
        .sort((a, b) => a.sequence - b.sequence);
}

/**
 * `fetchPlanItems`, wrapped in React `cache()`: calls with the same IDs in
 * one request share one read. A write that must see the notes as they are
 * after an earlier write in the same request calls `fetchPlanItems`, since
 * this would hand back the first read.
 */
export const getPlanItems = cache(fetchPlanItems);

/**
 * A service type's item note categories ("Audio/Visual", "Band", ...), in
 * Planning Center's order, leaving out any it marks deleted. Each service
 * type has its own, with its own ids, and the API cannot create one.
 * Throws InvalidPcoIdError or PcoError (404 if the service type is missing).
 */
export const getItemNoteCategories = cache(
    async (serviceTypeId: string): Promise<ItemNoteCategory[]> => {
        const st = assertPcoId(serviceTypeId);
        const { data } = await pcoFetchAll<PcoItemNoteCategoryResource>(
            `/service_types/${st}/item_note_categories?per_page=100`,
            "itemNoteCategories"
        );
        return data
            .filter((resource) => !resource.attributes.deleted_at)
            .map(toItemNoteCategory);
    }
);
