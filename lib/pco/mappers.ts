import "server-only";
import type {
    ItemNote,
    ItemNoteCategory,
    PcoLibrarySong,
    PcoTag,
    PcoTagGroup,
    Plan,
    PlanItem,
    ServiceType,
    Song,
    SongArrangement,
} from "../domain";
import type {
    PcoArrangementResource,
    PcoItemNoteCategoryResource,
    PcoItemNoteResource,
    PcoItemResource,
    PcoPlanResource,
    PcoResourceIdentifier,
    PcoServiceTypeResource,
    PcoSongResource,
    PcoTagGroupResource,
    PcoTagResource,
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

/**
 * Map a raw arrangement to the domain shape: archived when Planning Center
 * gives it an `archived_at`; a missing name becomes "" and a missing
 * creation time null.
 */
export function toSongArrangement(resource: PcoArrangementResource): SongArrangement {
    const attributes = resource.attributes;
    return {
        id: resource.id,
        name: attributes.name ?? "",
        archived: Boolean(attributes.archived_at),
        createdAt: attributes.created_at ?? null,
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
export function joinItemsToSongs<T extends PlanItem>(
    items: readonly T[],
    included: readonly PcoResourceIdentifier[]
): (T & { song: Song | null })[] {
    const songs = included.filter(isSongResource).map(toSong);
    const songsById = new Map(songs.map((song) => [song.id, song]));
    const songFor = (item: T): Song | null => {
        if (item.itemType !== "song") {
            return null;
        }
        const linked = item.songId === null ? undefined : songsById.get(item.songId);
        return linked ?? songs.find((song) => song.title === item.title) ?? null;
    };
    return items.map((item) => ({ ...item, song: songFor(item) }));
}

/**
 * Map a raw item note to the domain shape: its category's id from its
 * `item_note_category` relationship (null without one), and its category's
 * name and content, a null or missing one becoming "".
 */
export function toItemNote(resource: PcoItemNoteResource): ItemNote {
    const attributes = resource.attributes;
    return {
        id: resource.id,
        categoryId: resource.relationships?.item_note_category?.data?.id ?? null,
        categoryName: attributes.category_name ?? "",
        content: attributes.content ?? "",
    };
}

/** Map a raw item note category to the domain shape. */
export function toItemNoteCategory(resource: PcoItemNoteCategoryResource): ItemNoteCategory {
    return { id: resource.id, name: resource.attributes.name ?? "" };
}

function isItemNoteResource(
    resource: PcoResourceIdentifier
): resource is PcoItemNoteResource {
    return resource.type === "ItemNote";
}

/**
 * Each plan item's notes, by item id, from the resources included with the
 * items (`include=item_notes`): the notes each item's `item_notes`
 * relationship names, in its order. A note the relationship names but that
 * was not included is left out, and so is an included note no item names.
 * Included resources that are not item notes are ignored.
 */
export function itemNotesByItem(
    items: readonly PcoItemResource[],
    included: readonly PcoResourceIdentifier[]
): Map<string, ItemNote[]> {
    const notes = new Map(
        included.filter(isItemNoteResource).map((resource) => [resource.id, toItemNote(resource)])
    );
    const byItem = new Map<string, ItemNote[]>();
    for (const item of items) {
        const named = item.relationships?.item_notes?.data ?? [];
        byItem.set(
            item.id,
            named.flatMap(({ id }) => {
                const note = notes.get(id);
                return note ? [note] : [];
            })
        );
    }
    return byItem;
}

/** Map a raw tag of group `groupId` to the domain shape; a missing name becomes "". */
export function toPcoTag(resource: PcoTagResource, groupId: string): PcoTag {
    return { id: resource.id, groupId, name: resource.attributes.name ?? "" };
}

function isTagResource(resource: PcoResourceIdentifier): resource is PcoTagResource {
    return resource.type === "Tag";
}

/** By name without regard to case, then by id: the order a group's tags are given in. */
function byName(a: PcoTag, b: PcoTag): number {
    const [nameA, nameB] = [a.name.toLowerCase(), b.name.toLowerCase()];
    if (nameA !== nameB) {
        return nameA < nameB ? -1 : 1;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Map raw tag groups to the domain shape, in the order given, each with its
 * tags from the resources included with them (`include=tags`), by name: the
 * tags its `tags` relationship names, and any whose own `tag_group`
 * relationship names it. A tag named but not included is left out, and so
 * is an included one no group claims. A group may have several of its tags
 * chosen unless Planning Center says `allow_multiple_selections: false`.
 */
export function toPcoTagGroups(
    groups: readonly PcoTagGroupResource[],
    included: readonly PcoResourceIdentifier[]
): PcoTagGroup[] {
    const tags = included.filter(isTagResource);
    const tagsById = new Map(tags.map((tag) => [tag.id, tag]));
    return groups.map((group) => {
        const ids = new Set(group.relationships?.tags?.data?.map(({ id }) => id) ?? []);
        for (const tag of tags) {
            if (tag.relationships?.tag_group?.data?.id === group.id) {
                ids.add(tag.id);
            }
        }
        const { name, tags_for, allow_multiple_selections } = group.attributes;
        return {
            id: group.id,
            name: name ?? "",
            tagsFor: tags_for ?? "",
            allowMultiple: allow_multiple_selections !== false,
            tags: [...ids]
                .flatMap((id) => {
                    const tag = tagsById.get(id);
                    return tag ? [toPcoTag(tag, group.id)] : [];
                })
                .sort(byName),
        };
    });
}
