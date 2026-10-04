import "server-only";
import type {
    PcoLibrarySong,
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

/**
 * A CCLI number as a whole number, or null. Planning Center sends a number;
 * anything else (a fraction, words) is dropped, because the mirror stores an
 * integer and one bad value must not fail a whole sync. Digits sent as text
 * are read as the number.
 */
function ccliNumberOf(value: unknown): number | null {
    if (typeof value === "number") {
        return Number.isSafeInteger(value) ? value : null;
    }
    if (typeof value === "string" && /^\s*[0-9]{1,15}\s*$/.test(value)) {
        return Number(value);
    }
    return null;
}

/**
 * Map a raw song to a library song, with every field the mirror keeps. A
 * null or missing field becomes null (a missing title an empty one), an
 * empty string stays an empty string, and the song is hidden only when
 * Planning Center says so.
 */
export function toPcoLibrarySong(resource: PcoSongResource): PcoLibrarySong {
    const attributes = resource.attributes;
    return {
        id: resource.id,
        title: attributes.title ?? "",
        author: attributes.author ?? null,
        copyright: attributes.copyright ?? null,
        ccliNumber: ccliNumberOf(attributes.ccli_number),
        admin: attributes.admin ?? null,
        themes: attributes.themes ?? null,
        hidden: attributes.hidden === true,
        lastScheduledAt: attributes.last_scheduled_at ?? null,
        createdAt: attributes.created_at ?? null,
        updatedAt: attributes.updated_at ?? null,
    };
}

function isSongResource(
    resource: PcoResourceIdentifier
): resource is PcoSongResource {
    return resource.type === "Song";
}

/**
 * Attach each plan item's song from the resources included with the items
 * (`include=song`). Only "song" items get one: the included song whose ID is
 * the item's `songId`, so an item renamed in the plan still finds its song.
 * Without a songId (or if that song wasn't included), the first included
 * song with an identical (case-sensitive) title is used. Included resources
 * that are not songs are ignored. Items keep their order and are not modified.
 */
export function joinItemsToSongs(
    items: PlanItem[],
    included: readonly PcoResourceIdentifier[]
): PlanItemWithSong[] {
    const songs = included.filter(isSongResource).map(toSong);
    const songsById = new Map(songs.map((song) => [song.id, song]));
    const songFor = (item: PlanItem): Song | null => {
        if (item.itemType !== "song") {
            return null;
        }
        const linked = item.songId === null ? undefined : songsById.get(item.songId);
        return linked ?? songs.find((song) => song.title === item.title) ?? null;
    };
    return items.map((item) => ({ ...item, song: songFor(item) }));
}
