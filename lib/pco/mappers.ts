import "server-only";
import type {
    Plan,
    PlanItem,
    PlanItemWithSong,
    ServiceType,
    Song,
} from "../domain";
import type {
    PcoItemResource,
    PcoPlanResource,
    PcoResourceIdentifier,
    PcoServiceTypeResource,
    PcoSongResource,
} from "./resources";

/** Map a raw service type to the domain shape. */
export function toServiceType(resource: PcoServiceTypeResource): ServiceType {
    const { name, frequency, sequence, archived_at } = resource.attributes;
    return {
        id: resource.id,
        name,
        frequency,
        sequence,
        archived: Boolean(archived_at),
    };
}

/**
 * Map a raw plan to the domain shape. `planningCenterUrl` is the plan's web
 * page (`attributes.planning_center_url`), not the API URL in `links.self`.
 * `serviceTypeId` comes from the plan's relationship, or else from
 * `requestedServiceTypeId`, the type whose plans were requested.
 */
export function toPlan(
    resource: PcoPlanResource,
    requestedServiceTypeId: string
): Plan {
    const attributes = resource.attributes;
    return {
        id: resource.id,
        serviceTypeId:
            resource.relationships?.service_type?.data?.id ??
            requestedServiceTypeId,
        title: attributes.title ?? null,
        dates: attributes.dates,
        shortDates: attributes.short_dates,
        sortDate: attributes.sort_date,
        itemsCount: attributes.items_count,
        planningCenterUrl: attributes.planning_center_url,
        createdAt: attributes.created_at,
        updatedAt: attributes.updated_at,
    };
}

/** Map a raw plan item to the domain shape, keeping the ID of its song. */
export function toPlanItem(resource: PcoItemResource): PlanItem {
    const attributes = resource.attributes;
    return {
        id: resource.id,
        title: attributes.title,
        itemType: attributes.item_type,
        sequence: attributes.sequence,
        servicePosition: attributes.service_position,
        keyName: attributes.key_name ?? null,
        length: attributes.length,
        description: attributes.description ?? null,
        createdAt: attributes.created_at,
        updatedAt: attributes.updated_at,
        songId: resource.relationships?.song?.data?.id ?? null,
    };
}

/**
 * Map a raw song to the domain shape. Null stays null (and a field missing
 * from the JSON becomes null); an empty string stays an empty string.
 */
export function toSong(resource: PcoSongResource): Song {
    const attributes = resource.attributes;
    return {
        id: resource.id,
        title: attributes.title,
        author: attributes.author ?? null,
        admin: attributes.admin ?? null,
        ccliNumber: attributes.ccli_number ?? null,
        copyright: attributes.copyright ?? null,
        notes: attributes.notes ?? null,
        themes: attributes.themes ?? null,
    };
}

function isSongResource(
    resource: PcoResourceIdentifier
): resource is PcoSongResource {
    return resource.type === "Song";
}

/**
 * Attach each plan item's song from the resources included with the items
 * (`include=song`). Only "song" items get one: the first included song whose
 * title is identical (case-sensitive) to the item's. Included resources that
 * are not songs are ignored. Items keep their order and are not modified.
 */
export function joinItemsToSongs(
    items: PlanItem[],
    included: readonly PcoResourceIdentifier[]
): PlanItemWithSong[] {
    const songs = included.filter(isSongResource).map(toSong);
    return items.map((item) => ({
        ...item,
        song:
            item.itemType === "song"
                ? (songs.find((song) => song.title === item.title) ?? null)
                : null,
    }));
}
