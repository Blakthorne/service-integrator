import type { CatalogMatch, ItemNote, ItemNoteCategory, PlanItem } from "./domain";
import { catalogMatchFor, formatScheduleNumbers, type ScheduleEntry } from "./serviceSchedule";
import type { AppSettings, HymnNoteSettings } from "./settings";

/**
 * The hymnal notes: a note on each song item of a plan, in one item note
 * category of its service type ("Hymnal" by default, the
 * `hymnNoteCategoryName` setting), that carries the song's hymnal numbers
 * from its catalog link for the musicians: "R-396 / G-317", and the tune
 * too when `hymnNoteIncludesTune` is on. Pure and safe on both sides:
 * lib/queries/hymnNotes.ts reads the plan and writes what `diffHymnNotes`
 * says, and the pages show the same diff.
 *
 * Notes in other categories are never touched. The Schedule tab's choices
 * play no part: the notes are for the musicians, the choices for the
 * bulletin text.
 */

/** What a hymnal note is made from: the linked catalog song's tune and entries, in book order. */
export type HymnNoteMatch = Pick<CatalogMatch, "tuneName"> & {
    entries: readonly ScheduleEntry[];
};

/**
 * What goes between the numbers and the tune: "R-396 / G-317 · ST. ANNE".
 * Written as an escape, since notes are compared by their text.
 */
export const HYMN_NOTE_TUNE_SEPARATOR = " \u00b7 ";

/**
 * The hymnal note for a song item linked to `match`: its numbers as the
 * schedule text prints them (`formatScheduleNumbers`, joined with the
 * `numberSeparator` setting), followed by the tune's name when
 * `hymnNoteIncludesTune` is on and the tune is known. Null when there is
 * nothing to say: the song is not linked, or its catalog song is in no
 * book (a tune alone is not a note).
 */
export function formatHymnNote(
    match: HymnNoteMatch | null | undefined,
    settings: HymnNoteSettings
): string | null {
    if (!match) {
        return null;
    }
    const numbers = formatScheduleNumbers(match.entries, settings.numberSeparator);
    if (numbers === "") {
        return null;
    }
    const tune = match.tuneName?.trim() ?? "";
    return settings.hymnNoteIncludesTune && tune !== ""
        ? `${numbers}${HYMN_NOTE_TUNE_SEPARATOR}${tune}`
        : numbers;
}

/** A category name as it is matched: trimmed, runs of whitespace as one space, in lower case. */
function categoryKey(name: string): string {
    return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Whether two category names are the same name: without regard to case,
 * to whitespace around them, or to how much whitespace is between words
 * ("hymnal" and " Hymnal " are; "Hymnals" is not).
 */
export function sameCategoryName(a: string, b: string): boolean {
    return categoryKey(a) === categoryKey(b);
}

/**
 * The category named `name` (as `sameCategoryName` compares names) among a
 * service type's categories: the first, if two have that name. Null when
 * there is none, as there is none until someone creates it in Planning
 * Center: the API cannot.
 */
export function findHymnNoteCategory(
    categories: readonly ItemNoteCategory[],
    name: string
): ItemNoteCategory | null {
    return categories.find((category) => sameCategoryName(category.name, name)) ?? null;
}

/** A plan item as `diffHymnNotes` reads it: its catalog link, if any, and its notes. */
export type HymnNoteItem = Pick<PlanItem, "id" | "title" | "itemType" | "sequence"> & {
    /** The catalog song its Planning Center song is linked to; null when it has none. */
    match: HymnNoteMatch | null;
    /** Its notes in every category, in Planning Center's order. */
    notes: readonly ItemNote[];
};

/**
 * `items` as `diffHymnNotes` reads them: each with the catalog song its
 * Planning Center song is linked to in `catalog` (`PlanDetail.catalog`),
 * found by the link, never by the item's title.
 */
export function hymnNoteItems(
    items: readonly (Pick<PlanItem, "id" | "title" | "itemType" | "sequence" | "songId"> & {
        notes: readonly ItemNote[];
    })[],
    catalog: Readonly<Record<string, HymnNoteMatch>>
): HymnNoteItem[] {
    return items.map(({ id, title, itemType, sequence, songId, notes }) => ({
        id,
        title,
        itemType,
        sequence,
        match: catalogMatchFor(catalog, songId) ?? null,
        notes,
    }));
}

/**
 * What a song item's hymnal note needs:
 *
 * - "create": it has none, and its song has numbers;
 * - "update": its note says something else;
 * - "unchanged": its note says what it should;
 * - "delete": it has a note, but its song has nothing to say (not linked,
 *   or in no book), so every note in the category goes;
 * - "dedupe": its first note says what it should, but it has more in the
 *   category (Planning Center allows that): the rest go;
 * - "none": it has no note and its song has nothing to say.
 *
 * An item with extra notes whose first note also says something else is
 * "update", and its changes delete the extras too.
 */
export type HymnNoteAction = "create" | "update" | "unchanged" | "delete" | "dedupe" | "none";

/** One write that brings an item's hymnal note in step. */
export type HymnNoteChange =
    | { kind: "create"; content: string }
    | { kind: "update"; noteId: string; from: string; content: string }
    | {
          kind: "delete";
          noteId: string;
          /** What the note says, for the preview and the write log. */
          content: string;
          /** "nothing-to-say": the song has no numbers; "duplicate": an extra note in the category. */
          reason: "nothing-to-say" | "duplicate";
      };

/** A song item's hymnal note: what it says, what it should say, and the writes between. */
export interface HymnNoteDiff {
    itemId: string;
    /** The item's title in the plan. */
    title: string;
    sequence: number;
    /** What its note should say; null when its song has nothing to say. */
    content: string | null;
    /** What its note says now (the first in the category, the one kept); null when it has none. */
    current: string | null;
    action: HymnNoteAction;
    /**
     * The writes that bring it in step, in the order to make them: create
     * or update the note kept, then delete the others. Empty for
     * "unchanged" and "none".
     */
    changes: HymnNoteChange[];
}

/** True when a note's content says `content`, spaces around either aside. */
function says(note: ItemNote, content: string): boolean {
    return note.content.trim() === content.trim();
}

/**
 * What each song item's note in category `categoryName` needs (see
 * `HymnNoteAction`), in sequence order. The category is matched by name, as
 * `sameCategoryName` does; notes in other categories are never touched,
 * and items that are not songs are left out. What a note should say comes
 * from `formatHymnNote`. When an item has several notes in the category,
 * the first (in Planning Center's order) is kept and the rest deleted.
 */
export function diffHymnNotes(
    items: readonly HymnNoteItem[],
    categoryName: string,
    settings: HymnNoteSettings
): HymnNoteDiff[] {
    return items
        .filter((item) => item.itemType === "song")
        .sort((a, b) => a.sequence - b.sequence)
        .map((item) => {
            const content = formatHymnNote(item.match, settings);
            const [kept, ...extras] = item.notes.filter((note) =>
                sameCategoryName(note.categoryName, categoryName)
            );
            const diff = (action: HymnNoteAction, changes: HymnNoteChange[]): HymnNoteDiff => ({
                itemId: item.id,
                title: item.title,
                sequence: item.sequence,
                content,
                current: kept?.content ?? null,
                action,
                changes,
            });
            if (content === null) {
                return kept === undefined
                    ? diff("none", [])
                    : diff(
                          "delete",
                          [kept, ...extras].map((note) => ({
                              kind: "delete",
                              noteId: note.id,
                              content: note.content,
                              reason: "nothing-to-say",
                          }))
                      );
            }
            if (kept === undefined) {
                return diff("create", [{ kind: "create", content }]);
            }
            const duplicates: HymnNoteChange[] = extras.map((note) => ({
                kind: "delete",
                noteId: note.id,
                content: note.content,
                reason: "duplicate",
            }));
            if (says(kept, content)) {
                return diff(duplicates.length > 0 ? "dedupe" : "unchanged", duplicates);
            }
            return diff("update", [
                { kind: "update", noteId: kept.id, from: kept.content, content },
                ...duplicates,
            ]);
        });
}

/** How many song items need each action. */
export type HymnNoteCounts = Record<HymnNoteAction, number>;

/** How many of `diffs` need each action. */
export function countHymnNoteActions(diffs: readonly HymnNoteDiff[]): HymnNoteCounts {
    const counts: HymnNoteCounts = {
        create: 0,
        update: 0,
        unchanged: 0,
        delete: 0,
        dedupe: 0,
        none: 0,
    };
    for (const { action } of diffs) {
        counts[action] += 1;
    }
    return counts;
}

/** The items whose notes need a write: every action but "unchanged" and "none". */
export function hymnNotesToSync(diffs: readonly HymnNoteDiff[]): HymnNoteDiff[] {
    return diffs.filter((diff) => diff.changes.length > 0);
}

/**
 * What a song card says of its hymnal note: "in-sync" (it says what it
 * should), "differs" (it says something else, there are extras, or it
 * should go), or "missing" (it should exist and does not). Null when there
 * is nothing to say and no note.
 */
export type HymnNoteState = "in-sync" | "differs" | "missing";

export function hymnNoteState(diff: Pick<HymnNoteDiff, "action">): HymnNoteState | null {
    switch (diff.action) {
        case "unchanged":
            return "in-sync";
        case "create":
            return "missing";
        case "update":
        case "dedupe":
        case "delete":
            return "differs";
        case "none":
            return null;
    }
}

/**
 * A plan's hymnal notes against its service type's category:
 *
 * - "ready": the category was found, with each song item's diff;
 * - "no-category": the service type has no category of that name, so
 *   nothing can be written until someone creates it in Planning Center;
 * - "unavailable": the categories or the catalog could not be read, so the
 *   notes cannot be compared.
 */
export type HymnNoteStatus =
    | { kind: "ready"; category: ItemNoteCategory; items: HymnNoteDiff[] }
    | { kind: "no-category"; categoryName: string; message: string }
    | {
          kind: "unavailable";
          /** What could not be read. */
          reason: "categories" | "catalog";
          /** Why, fit to show. */
          message: string;
      };

/** The service type's item note categories, or why they could not be read. */
export type ItemNoteCategoriesRead =
    | { ok: true; categories: readonly ItemNoteCategory[] }
    | { ok: false; error: string };

/** What `planHymnNoteStatus` reads. */
export interface PlanHymnNoteInput {
    /** The plan's service type's name, for the message when the category is missing. */
    serviceTypeName: string;
    /** The plan's items, each with its notes. */
    items: readonly (Pick<PlanItem, "id" | "title" | "itemType" | "sequence" | "songId"> & {
        notes: readonly ItemNote[];
    })[];
    /** The catalog songs the items' Planning Center songs are linked to (`PlanDetail.catalog`). */
    catalog: Readonly<Record<string, HymnNoteMatch>>;
    /** Why the catalog could not be read, or null (`PlanDetail.catalogError`). */
    catalogError: string | null;
    categories: ItemNoteCategoriesRead;
    settings: HymnNoteSettings & Pick<AppSettings, "hymnNoteCategoryName">;
}

/** A reason that ends one sentence, for another to follow. */
function sentence(reason: string): string {
    const text = reason.trim();
    if (text === "") {
        return "";
    }
    return `: ${/[.!?]$/.test(text) ? text : `${text}.`}`;
}

/**
 * What the app says when a service type has no category for the hymnal
 * notes: `Create an item note category named "Hymnal" in Planning Center
 * for Sunday Morning.`
 */
export function missingCategoryMessage(categoryName: string, serviceTypeName: string): string {
    return `Create an item note category named "${categoryName}" in Planning Center for ${serviceTypeName}.`;
}

/**
 * A plan's hymnal notes (see `HymnNoteStatus`). Categories that could not
 * be read make it "unavailable"; then a missing category, which is the
 * fix to ask for whatever else is wrong, makes it "no-category"; then a
 * catalog that could not be read makes it "unavailable", since what each
 * note should say is not known. Otherwise each song item's diff against
 * the category, found by name (`findHymnNoteCategory`).
 */
export function planHymnNoteStatus({
    serviceTypeName,
    items,
    catalog,
    catalogError,
    categories,
    settings,
}: PlanHymnNoteInput): HymnNoteStatus {
    const categoryName = settings.hymnNoteCategoryName;
    if (!categories.ok) {
        return {
            kind: "unavailable",
            reason: "categories",
            message: `Planning Center's item note categories could not be read${sentence(categories.error) || "."} Hymnal notes can't be compared.`,
        };
    }
    const category = findHymnNoteCategory(categories.categories, categoryName);
    if (category === null) {
        return {
            kind: "no-category",
            categoryName,
            message: missingCategoryMessage(categoryName, serviceTypeName),
        };
    }
    if (catalogError !== null) {
        return {
            kind: "unavailable",
            reason: "catalog",
            message: `The catalog is unavailable${sentence(catalogError) || "."} Hymnal notes can't be compared.`,
        };
    }
    return {
        kind: "ready",
        category,
        items: diffHymnNotes(hymnNoteItems(items, catalog), category.name, settings),
    };
}

/** The diff of item `itemId` in a plan's hymnal notes, or null when there is none (not ready, or not a song item). */
export function hymnNoteDiffFor(status: HymnNoteStatus, itemId: string): HymnNoteDiff | null {
    return status.kind === "ready"
        ? (status.items.find((diff) => diff.itemId === itemId) ?? null)
        : null;
}
