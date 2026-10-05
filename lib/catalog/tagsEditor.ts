import type { PcoTag, PcoTagGroup } from "@/lib/domain";

/**
 * The song page's Tags card: which of Planning Center's song tags a linked
 * song has, grouped as Planning Center groups them, and the editor that
 * changes them a group at a time, as each group allows (any number of its
 * tags, or one). The tags are the mirror's (`pco_tag_groups`, `pco_tags`,
 * `pco_song_tags`), in its order: groups by name, tags by name. Pure and
 * safe on both sides.
 */

/** One group of a song's tags, as the card lists them. */
export interface SongTagsLine {
    groupId: string;
    /** The group's name, such as "Type". */
    group: string;
    /** The names of the song's tags in it, such as "Hymn". */
    tags: string[];
}

/** The song's tags (`songTags`, by id) by group, in the mirror's order; a group it has none of is left out. */
export function songTagLines(
    groups: readonly PcoTagGroup[],
    songTags: readonly Pick<PcoTag, "id">[]
): SongTagsLine[] {
    const has = new Set(songTags.map(({ id }) => id));
    return groups.flatMap((group) => {
        const tags = group.tags.filter(({ id }) => has.has(id)).map(({ name }) => name);
        return tags.length > 0 ? [{ groupId: group.id, group: group.name, tags }] : [];
    });
}

/** The ids of `chosen` that are tags of `groups`, in the mirror's order. */
function inMirrorOrder(groups: readonly PcoTagGroup[], chosen: ReadonlySet<string>): string[] {
    return groups.flatMap((group) => group.tags.filter(({ id }) => chosen.has(id)).map(({ id }) => id));
}

/** The editor's first choice: the song's tags of `groups`, in the mirror's order. */
export function songTagSelection(
    groups: readonly PcoTagGroup[],
    songTags: readonly Pick<PcoTag, "id">[]
): string[] {
    return inMirrorOrder(groups, new Set(songTags.map(({ id }) => id)));
}

/**
 * The selection with tag `tagId` of `group` chosen, or not. In a group that
 * takes one tag, choosing one gives up the group's other. The result is in
 * the mirror's order, and holds only tags of `groups`.
 */
export function chooseTag(
    selection: readonly string[],
    groups: readonly PcoTagGroup[],
    group: PcoTagGroup,
    tagId: string,
    chosen: boolean
): string[] {
    const next = new Set(selection);
    if (chosen && !group.allowMultiple) {
        for (const tag of group.tags) {
            next.delete(tag.id);
        }
    }
    if (chosen) {
        next.add(tagId);
    } else {
        next.delete(tagId);
    }
    return inMirrorOrder(groups, next);
}

/** The selection with none of `group`'s tags: the "None" of a group that takes one tag. */
export function clearTagGroup(
    selection: readonly string[],
    groups: readonly PcoTagGroup[],
    group: PcoTagGroup
): string[] {
    const groupTags = new Set(group.tags.map(({ id }) => id));
    return inMirrorOrder(groups, new Set(selection.filter((id) => !groupTags.has(id))));
}

/** Whether two selections hold the same tags, in any order. */
export function sameTagSelection(a: readonly string[], b: readonly string[]): boolean {
    const first = new Set(a);
    const second = new Set(b);
    return first.size === second.size && [...first].every((id) => second.has(id));
}

/** "A", "A and B", "A, B and C". */
function listNames(names: readonly string[]): string {
    return names.length <= 2
        ? names.join(" and ")
        : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The tags a save would add and remove, by name, in the mirror's order. */
export interface TagChanges {
    added: string[];
    removed: string[];
}

/**
 * What saving `wanted` would change of the tags the editor showed
 * (`shown`): the tags of `groups` added and removed, by name, in the
 * mirror's order. A save sends just these changes, which are applied to
 * the song's tags as Planning Center has them then.
 */
export function tagChanges(
    shown: readonly string[],
    wanted: readonly string[],
    groups: readonly PcoTagGroup[]
): TagChanges {
    const before = new Set(shown);
    const after = new Set(wanted);
    const tags = groups.flatMap((group) => group.tags);
    return {
        added: tags.filter(({ id }) => after.has(id) && !before.has(id)).map(({ name }) => name),
        removed: tags.filter(({ id }) => before.has(id) && !after.has(id)).map(({ name }) => name),
    };
}

/**
 * What the Tags card says beside Save, before it is pressed: 'Save adds
 * "Easter" and removes "Special".', or that nothing has changed yet.
 */
export function describeTagChanges({ added, removed }: TagChanges): string {
    const quoted = (names: readonly string[]) => listNames(names.map((name) => `"${name}"`));
    if (added.length === 0 && removed.length === 0) {
        return "Nothing to save yet: no tag is ticked or unticked.";
    }
    if (removed.length === 0) {
        return `Save adds ${quoted(added)}.`;
    }
    if (added.length === 0) {
        return `Save removes ${quoted(removed)}.`;
    }
    return `Save adds ${quoted(added)} and removes ${quoted(removed)}.`;
}

/** What a group's fieldset says about choosing: any number of its tags, or one. */
export function tagGroupHint(group: Pick<PcoTagGroup, "allowMultiple">): string {
    return group.allowMultiple ? "Choose any of them." : "Choose one, or none.";
}

/** What the Tags card says when the mirror has no song tags at all. */
export const NO_SONG_TAGS =
    "No tags yet: the tags sync has not brought Planning Center's song tags into the app. It runs every hour, after the song sync.";

/** What a save of the tags gave back. */
export interface TagsSaved {
    /** False when the song had exactly these tags already, so nothing was sent. */
    changed: boolean;
    /** The song's whole set of tags in Planning Center now. */
    tagIds: readonly string[];
    /** Tags it has that the mirror does not know yet, which were kept. */
    kept: readonly Pick<PcoTag, "id" | "name">[];
}

/**
 * What the Tags card says once a save is done: the song's tags in Planning
 * Center now, by name, or that nothing changed; and any tag the app did not
 * know yet, which was kept.
 */
export function describeTagsSave(saved: TagsSaved, groups: readonly PcoTagGroup[]): string {
    const names = new Map(groups.flatMap((group) => group.tags.map((tag) => [tag.id, tag.name] as const)));
    const keptIds = new Set(saved.kept.map(({ id }) => id));
    const known = saved.tagIds.filter((id) => !keptIds.has(id)).map((id) => `"${names.get(id) ?? id}"`);
    let message: string;
    if (!saved.changed) {
        message = "Planning Center already had these tags, so nothing was changed.";
    } else if (known.length > 0) {
        message = `Saved. Its tags in Planning Center are now ${listNames(known)}.`;
    } else if (saved.kept.length === 0) {
        message = "Saved. The song has no tags in Planning Center now.";
    } else {
        message = "Saved. The song has none of these tags in Planning Center now.";
    }
    if (saved.kept.length === 0) {
        return message;
    }
    const kept = listNames(saved.kept.map(({ name }) => `"${name}"`));
    return saved.kept.length === 1
        ? `${message} It also has the tag ${kept}, which the app does not know yet, so it was kept.`
        : `${message} It also has the tags ${kept}, which the app does not know yet, so they were kept.`;
}

/** The most tag ids an action takes: far more than any song could have. */
const MAX_TAG_IDS = 500;

/**
 * Tag ids as an action receives them, from the network, so they may be
 * anything: a list of at most `MAX_TAG_IDS` texts. Null for anything else.
 * It checks the shape only; the action parses each id, and the query checks
 * them against the mirror.
 */
export function readTagIdsInput(value: unknown): string[] | null {
    if (!Array.isArray(value) || value.length > MAX_TAG_IDS) {
        return null;
    }
    return value.every((id) => typeof id === "string") ? [...value] : null;
}
