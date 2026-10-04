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
 * Notes in other categories are never touched, and of the hymnal notes the
 * app deletes only those it wrote itself: one typed by hand is never
 * deleted. The Schedule tab's choices play no part: the notes are for the
 * musicians, the choices for the bulletin text.
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
 * How a service type's categories answer to the hymnal notes' category name
 * (as `sameCategoryName` compares names): one category ("found"); none
 * ("missing"), as until someone creates it in Planning Center, since the API
 * cannot; or more than one ("ambiguous"), as "Hymnal" and "hymnal" would
 * be: the app refuses then, since it cannot tell which the notes go in.
 */
export type HymnNoteCategoryMatch =
    | { status: "found"; category: ItemNoteCategory }
    | { status: "missing" }
    | { status: "ambiguous"; categories: ItemNoteCategory[] };

/** The categories among a service type's named `name` (see `HymnNoteCategoryMatch`). */
export function matchHymnNoteCategory(
    categories: readonly ItemNoteCategory[],
    name: string
): HymnNoteCategoryMatch {
    const matches = categories.filter((category) => sameCategoryName(category.name, name));
    if (matches.length === 0) {
        return { status: "missing" };
    }
    return matches.length === 1
        ? { status: "found", category: matches[0] }
        : { status: "ambiguous", categories: matches };
}

/** "a", "a and b", "a, b and c". */
function listed(parts: readonly string[]): string {
    return parts.length <= 1
        ? parts.join("")
        : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * What the app says when several of a service type's categories have the
 * hymnal notes' name: `Sunday Morning has 2 item note categories named
 * "Hymnal" ("Hymnal" and "hymnal"), so the hymnal notes have no one place
 * to go. Rename or delete all but one in Planning Center.`
 */
export function ambiguousCategoryMessage(
    categoryName: string,
    serviceTypeName: string,
    categories: readonly Pick<ItemNoteCategory, "name">[]
): string {
    const names = listed(categories.map(({ name }) => `"${name}"`));
    return `${serviceTypeName} has ${categories.length} item note categories named "${categoryName}" (${names}), so the hymnal notes have no one place to go. Rename or delete all but one in Planning Center.`;
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
 * What a song item's hymnal note needs. The app updates any hymnal note on
 * a song with numbers, which is its job, but deletes only the notes it
 * wrote itself (see `diffHymnNotes`): any other note it would delete is
 * left alone, so a note typed by hand never goes.
 *
 * - "create": it has none, and its song has numbers;
 * - "update": its note says something else;
 * - "unchanged": its note says what it should;
 * - "delete": its song has nothing to say (not linked, or in no book), and
 *   it has notes the app wrote: they go;
 * - "dedupe": its note says what it should, and it has more the app wrote
 *   (Planning Center allows several in one category): they go;
 * - "keep": its song has nothing to say, and it has notes, none of them
 *   the app's: they are left alone;
 * - "none": it has no note and its song has nothing to say.
 *
 * An item whose note says something else is "update" even when it has
 * extras, and its changes delete the app's extras too. Whatever the action,
 * the notes left alone are listed in the diff's `keep`: an item can be
 * "unchanged" with an extra note someone typed.
 */
export type HymnNoteAction =
    | "create"
    | "update"
    | "unchanged"
    | "delete"
    | "dedupe"
    | "keep"
    | "none";

/**
 * Why a hymnal note would go: "nothing-to-say", its song has no numbers;
 * "duplicate", it is an extra note in the category.
 */
export type HymnNoteRemovalReason = "nothing-to-say" | "duplicate";

/** One write that brings an item's hymnal note in step. */
export type HymnNoteChange =
    | { kind: "create"; content: string }
    | { kind: "update"; noteId: string; from: string; content: string }
    | {
          kind: "delete";
          noteId: string;
          /** What the note says, for the preview and the write log. */
          content: string;
          reason: HymnNoteRemovalReason;
      };

/**
 * A hymnal note the app leaves alone: it would go (`reason`), but the app
 * did not write it, and deletes only its own notes. The preview shows it as
 * left alone (not written by the app).
 */
export interface HymnNoteKeep {
    kind: "keep";
    noteId: string;
    /** What the note says. */
    content: string;
    /** Why it would otherwise go. */
    reason: HymnNoteRemovalReason;
}

/** A song item's hymnal note: what it says, what it should say, and the writes between. */
export interface HymnNoteDiff {
    itemId: string;
    /** The item's title in the plan. */
    title: string;
    sequence: number;
    /** What its note should say; null when its song has nothing to say. */
    content: string | null;
    /**
     * What its note says now: the note brought in step when its song has
     * numbers (see `diffHymnNotes`), else its first in the category; null
     * when it has none.
     */
    current: string | null;
    action: HymnNoteAction;
    /**
     * The writes that bring it in step, in the order to make them: create
     * or update the note brought in step, then delete the app's others.
     * Empty for "unchanged", "keep" and "none".
     */
    changes: HymnNoteChange[];
    /** Its notes in the category that would go but are left alone, since the app did not write them. */
    keep: HymnNoteKeep[];
}

/** True when a note's content says `content`, spaces around either aside. */
function says(note: ItemNote, content: string): boolean {
    return note.content.trim() === content.trim();
}

/**
 * Whether a note is in `category`: by its category's id, or, only when
 * Planning Center sent the note without one, by name (`sameCategoryName`).
 * So a note in another category of the same name (a deleted category's,
 * whose notes keep its name) is never taken for one of `category`'s.
 */
function inCategory(note: ItemNote, category: Pick<ItemNoteCategory, "id" | "name">): boolean {
    return note.categoryId !== null
        ? note.categoryId === category.id
        : sameCategoryName(note.categoryName, category.name);
}

/**
 * What each song item's note in `category` needs (see `HymnNoteAction`), in
 * sequence order. A note is in the category when its category's id is the
 * category's, or, only for a note Planning Center sent without one, when
 * its category's name is (`inCategory`); notes in other categories are
 * never touched, a deleted one of the same name included, and items that
 * are not songs are left out. What a note should say comes from
 * `formatHymnNote`.
 *
 * `ownedNoteIds` are the notes the app wrote itself (its successful creates,
 * from the write log): the only ones it deletes. Every other note it would
 * delete goes in `keep` instead. So a write log that has lost history (a
 * restored database, say) can only keep a note that could have gone, never
 * delete one.
 *
 * Of an item's notes in the category, the one brought in step is the first
 * that already says what it should, else the first the app wrote, else the
 * first (in Planning Center's order): a note typed by hand is changed only
 * when the app has no note of its own there. Each other note is deleted
 * when the app wrote it, and kept when it did not.
 */
export function diffHymnNotes(
    items: readonly HymnNoteItem[],
    category: Pick<ItemNoteCategory, "id" | "name">,
    settings: HymnNoteSettings,
    ownedNoteIds: ReadonlySet<string>
): HymnNoteDiff[] {
    return items
        .filter((item) => item.itemType === "song")
        .sort((a, b) => a.sequence - b.sequence)
        .map((item) => {
            const content = formatHymnNote(item.match, settings);
            const notes = item.notes.filter((note) => inCategory(note, category));
            const kept =
                content === null
                    ? undefined
                    : (notes.find((note) => says(note, content)) ??
                      notes.find((note) => ownedNoteIds.has(note.id)) ??
                      notes[0]);
            const reason: HymnNoteRemovalReason =
                content === null ? "nothing-to-say" : "duplicate";
            const deletes: HymnNoteChange[] = [];
            const keep: HymnNoteKeep[] = [];
            for (const note of notes) {
                if (note === kept) {
                    continue;
                }
                const { id: noteId, content: noteContent } = note;
                if (ownedNoteIds.has(noteId)) {
                    deletes.push({ kind: "delete", noteId, content: noteContent, reason });
                } else {
                    keep.push({ kind: "keep", noteId, content: noteContent, reason });
                }
            }
            const diff = (action: HymnNoteAction, changes: HymnNoteChange[]): HymnNoteDiff => ({
                itemId: item.id,
                title: item.title,
                sequence: item.sequence,
                content,
                current: (kept ?? notes[0])?.content ?? null,
                action,
                changes,
                keep,
            });
            if (content === null) {
                if (notes.length === 0) {
                    return diff("none", []);
                }
                return diff(deletes.length > 0 ? "delete" : "keep", deletes);
            }
            if (kept === undefined) {
                return diff("create", [{ kind: "create", content }]);
            }
            if (says(kept, content)) {
                return diff(deletes.length > 0 ? "dedupe" : "unchanged", deletes);
            }
            return diff("update", [
                { kind: "update", noteId: kept.id, from: kept.content, content },
                ...deletes,
            ]);
        });
}

/**
 * The ids of the notes on song items, in every category, each once: the
 * notes whose authorship to look up in the write log.
 */
export function songItemNoteIds(
    items: readonly (Pick<PlanItem, "itemType"> & { notes: readonly ItemNote[] })[]
): string[] {
    return [
        ...new Set(
            items.flatMap((item) =>
                item.itemType === "song" ? item.notes.map((note) => note.id) : []
            )
        ),
    ];
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
        keep: 0,
        none: 0,
    };
    for (const { action } of diffs) {
        counts[action] += 1;
    }
    return counts;
}

/** The items whose notes need a write: every action but "unchanged", "keep" and "none". */
export function hymnNotesToSync(diffs: readonly HymnNoteDiff[]): HymnNoteDiff[] {
    return diffs.filter((diff) => diff.changes.length > 0);
}

/**
 * What a song card says of its hymnal note: "in-sync" (it says what it
 * should), "differs" (it says something else, there are extras of the
 * app's, or it should go), or "missing" (it should exist and does not).
 * Null when the app has nothing to say and nothing to do: no note, or only
 * notes it leaves alone.
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
        case "keep":
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
 * - "unavailable": the notes cannot be compared, and nothing is written:
 *   the categories or the catalog could not be read, or several categories
 *   have the name ("ambiguous-category"), so the notes have no one place to
 *   go until all but one are renamed or deleted in Planning Center.
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
      }
    | {
          kind: "unavailable";
          reason: "ambiguous-category";
          /** Why, fit to show (`ambiguousCategoryMessage`). */
          message: string;
          /** The name the settings give the category. */
          categoryName: string;
          /** The service type's categories of that name. */
          categories: ItemNoteCategory[];
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
    /**
     * The notes on the items that the app wrote itself (see `diffHymnNotes`),
     * the only ones it deletes; when the write log cannot say, none.
     */
    ownedNoteIds: ReadonlySet<string>;
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
 * be read make it "unavailable"; then a missing category, or several of
 * the name, which are the fix to ask for whatever else is wrong, make it
 * "no-category" or "unavailable" ("ambiguous-category"); then a catalog
 * that could not be read makes it "unavailable", since what each note
 * should say is not known. Otherwise each song item's diff against the
 * category, found by name (`matchHymnNoteCategory`) and matched to the
 * notes by its id.
 */
export function planHymnNoteStatus({
    serviceTypeName,
    items,
    catalog,
    catalogError,
    categories,
    settings,
    ownedNoteIds,
}: PlanHymnNoteInput): HymnNoteStatus {
    const categoryName = settings.hymnNoteCategoryName;
    if (!categories.ok) {
        return {
            kind: "unavailable",
            reason: "categories",
            message: `Planning Center's item note categories could not be read${sentence(categories.error) || "."} Hymnal notes can't be compared.`,
        };
    }
    const match = matchHymnNoteCategory(categories.categories, categoryName);
    if (match.status === "missing") {
        return {
            kind: "no-category",
            categoryName,
            message: missingCategoryMessage(categoryName, serviceTypeName),
        };
    }
    if (match.status === "ambiguous") {
        return {
            kind: "unavailable",
            reason: "ambiguous-category",
            message: ambiguousCategoryMessage(categoryName, serviceTypeName, match.categories),
            categoryName,
            categories: match.categories,
        };
    }
    const { category } = match;
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
        items: diffHymnNotes(hymnNoteItems(items, catalog), category, settings, ownedNoteIds),
    };
}

/** The diff of item `itemId` in a plan's hymnal notes, or null when there is none (not ready, or not a song item). */
export function hymnNoteDiffFor(status: HymnNoteStatus, itemId: string): HymnNoteDiff | null {
    return status.kind === "ready"
        ? (status.items.find((diff) => diff.itemId === itemId) ?? null)
        : null;
}
