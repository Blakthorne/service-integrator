import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { getDb } from "@/lib/db";
import { findCatalogMatches } from "@/lib/db/catalog";
import { errorMessage } from "@/lib/db/errors";
import {
    findCreatedItemNoteIds,
    recordWrite,
    type NewWriteLogEntry,
} from "@/lib/db/writeLog";
import type { CatalogMatch, ItemNote, ItemNoteCategory, PlanItem, ServiceType } from "@/lib/domain";
import {
    ambiguousCategoryMessage,
    matchHymnNoteCategory,
    matchesPreview,
    missingCategoryMessage,
    planHymnNoteStatus,
    previewedByItem,
    settingsUnavailableMessage,
    songItemNoteIds,
    type HymnNoteAction,
    type HymnNoteChange,
    type HymnNoteDiff,
    type HymnNoteKeep,
    type HymnNoteStatus,
    type ItemNoteCategoriesRead,
    type PreviewedHymnNote,
} from "@/lib/hymnNotes";
import {
    PcoError,
    PcoValidationError,
    assertPcoId,
    createItemNote,
    deleteItemNote,
    fetchPlanItems,
    getItemNoteCategories,
    getPlanItems,
    getServiceType,
    getServiceTypes,
    updateItemNote,
} from "@/lib/pco";
import { getSettings } from "./settings";

/**
 * The hymnal notes of a plan in Planning Center: what a sync would change
 * (`previewHymnNotes`), the sync itself (`syncHymnNotes`), and, for
 * Settings, the category each service type has for them. The diff is
 * `diffHymnNotes`'s (lib/hymnNotes.ts); the writes are lib/pco/writes.ts's,
 * each recorded in the write log, which also says which notes the app
 * wrote: the only ones it deletes.
 */

/**
 * A service type's item note categories, or why they could not be read.
 * Never rejects: a failure is logged.
 */
export async function readItemNoteCategories(
    serviceTypeId: string
): Promise<ItemNoteCategoriesRead> {
    try {
        return { ok: true, categories: await getItemNoteCategories(serviceTypeId) };
    } catch (error) {
        console.error(
            `Failed to read the item note categories of service type ${serviceTypeId}:`,
            error
        );
        return { ok: false, error: errorMessage(error) };
    }
}

/** The Planning Center songs the song items schedule, each once. */
function pcoSongIdsOf(items: readonly Pick<PlanItem, "itemType" | "songId">[]): string[] {
    return [
        ...new Set(
            items.flatMap((item) =>
                item.itemType === "song" && item.songId !== null ? [item.songId] : []
            )
        ),
    ];
}

/**
 * The notes on these items' song items that the app wrote itself
 * (`findCreatedItemNoteIds`), the only ones it deletes, for a page to show
 * what a sync would do. Never throws: when the write log cannot be read it
 * logs the error and gives none, which shows every note as kept, never as
 * deleted. One query, and none when the song items have no notes.
 */
export function readAppWrittenNoteIds(
    items: readonly (Pick<PlanItem, "itemType"> & { notes: readonly ItemNote[] })[]
): ReadonlySet<string> {
    const noteIds = songItemNoteIds(items);
    if (noteIds.length === 0) {
        return new Set();
    }
    try {
        return findCreatedItemNoteIds(getDb(), noteIds);
    } catch (error) {
        console.error("Failed to read which item notes the app wrote:", error);
        return new Set();
    }
}

/** The catalog songs the items' Planning Center songs are linked to, by Planning Center song id. Two queries. */
function catalogOf(
    db: DatabaseSync,
    items: readonly Pick<PlanItem, "itemType" | "songId">[]
): Record<string, CatalogMatch> {
    return Object.fromEntries(findCatalogMatches(db, pcoSongIdsOf(items)));
}

/**
 * What a sync of plan `planId`'s hymnal notes would do: the category it
 * writes to, with each song item's diff, or why it cannot (the category is
 * missing or ambiguous, or the settings, the categories or the database
 * could not be read). Reads
 * the service type, the plan's items and the service type's categories from
 * Planning Center in parallel (three requests, deduped within a request),
 * then the catalog and which of the items' notes the app wrote (at most
 * three queries). A plan or service type that cannot be read throws, as on
 * the plan's pages.
 */
export async function previewHymnNotes(
    serviceTypeId: string,
    planId: string
): Promise<HymnNoteStatus> {
    const [serviceType, { items }, categories] = await Promise.all([
        getServiceType(serviceTypeId),
        getPlanItems(serviceTypeId, planId),
        readItemNoteCategories(serviceTypeId),
    ]);
    const { settings, error: settingsError } = getSettings();
    let catalog: Record<string, CatalogMatch> = {};
    let ownedNoteIds: ReadonlySet<string> = new Set();
    let catalogError: string | null = null;
    try {
        const db = getDb();
        catalog = catalogOf(db, items);
        ownedNoteIds = findCreatedItemNoteIds(db, songItemNoteIds(items));
    } catch (error) {
        console.error(
            `Failed to read the catalog links of plan ${serviceTypeId}/${planId}:`,
            error
        );
        catalogError = errorMessage(error);
    }
    return planHymnNoteStatus({
        serviceTypeName: serviceType.name,
        items,
        catalog,
        catalogError,
        categories,
        settings,
        settingsError,
        ownedNoteIds,
    });
}

/** What a hymnal note write asked for, as the write log records it. */
export type ItemNoteWritePayload = {
    serviceTypeId: string;
    planId: string;
    itemId: string;
} & (
    | { action: "create"; categoryId: string; content: string }
    | { action: "update"; noteId: string; previous: string; content: string }
    | {
          action: "delete";
          noteId: string;
          previous: string;
          reason: "nothing-to-say" | "duplicate";
      }
);

/** What came of a hymnal note write, as the write log records it. */
export type ItemNoteWriteResult =
    /** Created or updated: the note as Planning Center has it now. */
    | { note: ItemNote }
    /** Deleted: the note's id. */
    | { deleted: string }
    /** Refused or failed: why, Planning Center's status, and its reasons for a 422. */
    | { error: string; status?: number; details?: string[] };

/** What became of one song item's hymnal note in a sync. */
export interface HymnNoteSyncItem {
    itemId: string;
    title: string;
    sequence: number;
    /** What the diff called for. */
    action: HymnNoteAction;
    /**
     * - "done": every change was made;
     * - "failed": a change failed, and the item's later changes were not
     *   tried;
     * - "nothing-to-do": none was needed ("unchanged", "keep" or "none");
     * - "changed": what it needs now is not what the preview showed (or the
     *   preview did not have it), so nothing was written for it: changed
     *   since the preview; preview again;
     * - "not-attempted": a write before it met Planning Center's rate limit
     *   (a 429 the client did not retry), so the sync stopped there and
     *   tried nothing for it: preview again in a minute.
     */
    outcome: "done" | "failed" | "nothing-to-do" | "changed" | "not-attempted";
    /** The changes made, in order. */
    made: HymnNoteChange[];
    /** The notes it left alone because the app did not write them. */
    keep: HymnNoteKeep[];
    /** Why it failed, fit to show; null unless it failed. */
    error: string | null;
}

/** How a sync went, in numbers. */
export interface HymnNoteSyncCounts {
    created: number;
    updated: number;
    deleted: number;
    /** Items that needed nothing. */
    unchanged: number;
    /** Notes left alone because the app did not write them. */
    kept: number;
    /** Items with a change that failed. */
    failed: number;
    /**
     * Items not written because they changed since the preview. The sync
     * always counts them; optional in the type only so that results built
     * before it existed (a test's fixture) still type.
     */
    changed?: number;
    /**
     * Items not tried because Planning Center's rate limit stopped the sync
     * first. Always counted, and optional in the type, as `changed` is.
     */
    notAttempted?: number;
}

/** What `syncHymnNotes` did. */
export type HymnNotesSyncResult =
    | {
          ok: true;
          /** The category written to. */
          category: ItemNoteCategory;
          /** Every song item, in sequence order. */
          items: HymnNoteSyncItem[];
          counts: HymnNoteSyncCounts;
      }
    /** Nothing was written: the category is missing, or the categories could not be read. */
    | { ok: false; kind: "no-category" | "unavailable"; message: string };

/** The reason a write failed, Planning Center's status, and its reasons for a 422. */
function writeError(error: unknown): Extract<ItemNoteWriteResult, { error: string }> {
    if (error instanceof PcoValidationError) {
        return {
            error: error.details.length > 0 ? error.details.join("; ") : error.message,
            status: error.status,
            details: [...error.details],
        };
    }
    if (error instanceof PcoError) {
        return { error: error.message, status: error.status };
    }
    return { error: errorMessage(error) };
}

/** Record a write; a failure to record is logged and does not stop the sync. */
function logWrite(db: DatabaseSync, entry: NewWriteLogEntry): void {
    try {
        recordWrite(db, entry);
    } catch (error) {
        console.error(`Failed to record a write to Planning Center (${entry.target}):`, error);
    }
}

/** Make one change; resolves to what the write log records of it. */
async function applyChange(
    serviceTypeId: string,
    planId: string,
    itemId: string,
    categoryId: string,
    change: HymnNoteChange
): Promise<ItemNoteWriteResult> {
    switch (change.kind) {
        case "create":
            return {
                note: await createItemNote(serviceTypeId, planId, itemId, categoryId, change.content),
            };
        case "update":
            return {
                note: await updateItemNote(serviceTypeId, planId, itemId, change.noteId, change.content),
            };
        case "delete":
            return {
                deleted: (await deleteItemNote(serviceTypeId, planId, itemId, change.noteId)).id,
            };
    }
}

/** What the write log records a change asked for. */
function payloadOf(
    ids: { serviceTypeId: string; planId: string; itemId: string },
    categoryId: string,
    change: HymnNoteChange
): ItemNoteWritePayload {
    switch (change.kind) {
        case "create":
            return { ...ids, action: "create", categoryId, content: change.content };
        case "update":
            return {
                ...ids,
                action: "update",
                noteId: change.noteId,
                previous: change.from,
                content: change.content,
            };
        case "delete":
            return {
                ...ids,
                action: "delete",
                noteId: change.noteId,
                previous: change.content,
                reason: change.reason,
            };
    }
}

/** What `syncItem` did: the item's result, and whether Planning Center's rate limit stopped it. */
interface ItemSync {
    item: HymnNoteSyncItem;
    /** A write met a 429 the client did not retry: the sync stops here. */
    rateLimited: boolean;
}

/** True for Planning Center's "too many requests", which the client has already retried as far as it will. */
function isRateLimited(error: unknown): boolean {
    return error instanceof PcoError && error.status === 429;
}

/** Make an item's changes in order, logging each; stop at the first that fails. */
async function syncItem(
    db: DatabaseSync,
    serviceTypeId: string,
    planId: string,
    category: ItemNoteCategory,
    diff: HymnNoteDiff
): Promise<ItemSync> {
    const { itemId, title, sequence, action, keep } = diff;
    const made: HymnNoteChange[] = [];
    const target = `plan ${planId} item ${itemId}`;
    for (const change of diff.changes) {
        const payload = payloadOf({ serviceTypeId, planId, itemId }, category.id, change);
        try {
            const result = await applyChange(serviceTypeId, planId, itemId, category.id, change);
            logWrite(db, { kind: "item-note", target, ok: true, payload, result });
            made.push(change);
        } catch (error) {
            console.error(
                `Failed to write the hymnal note of plan ${serviceTypeId}/${planId} item ${itemId}:`,
                error
            );
            const result = writeError(error);
            logWrite(db, { kind: "item-note", target, ok: false, payload, result });
            return {
                item: {
                    itemId,
                    title,
                    sequence,
                    action,
                    outcome: "failed",
                    made,
                    keep,
                    error: result.error,
                },
                rateLimited: isRateLimited(error),
            };
        }
    }
    return {
        item: {
            itemId,
            title,
            sequence,
            action,
            outcome: diff.changes.length > 0 ? "done" : "nothing-to-do",
            made,
            keep,
            error: null,
        },
        rateLimited: false,
    };
}

/** An item the sync writes nothing for, with why (`outcome`). */
function unwrittenItem(
    diff: HymnNoteDiff,
    outcome: "changed" | "not-attempted"
): HymnNoteSyncItem {
    const { itemId, title, sequence, action } = diff;
    return { itemId, title, sequence, action, outcome, made: [], keep: [], error: null };
}

/** The changes made, the notes left alone, and the items that failed, changed or needed nothing. */
function countSync(items: readonly HymnNoteSyncItem[]): Required<HymnNoteSyncCounts> {
    const counts: Required<HymnNoteSyncCounts> = {
        created: 0,
        updated: 0,
        deleted: 0,
        unchanged: 0,
        kept: 0,
        failed: 0,
        changed: 0,
        notAttempted: 0,
    };
    for (const item of items) {
        counts.kept += item.keep.length;
        if (item.outcome === "nothing-to-do") {
            counts.unchanged += 1;
        } else if (item.outcome === "failed") {
            counts.failed += 1;
        } else if (item.outcome === "changed") {
            counts.changed += 1;
        } else if (item.outcome === "not-attempted") {
            counts.notAttempted += 1;
        }
        for (const change of item.made) {
            if (change.kind === "create") {
                counts.created += 1;
            } else if (change.kind === "update") {
                counts.updated += 1;
            } else {
                counts.deleted += 1;
            }
        }
    }
    return counts;
}

/**
 * Bring plan `planId`'s hymnal notes in step with its songs' catalog links.
 *
 * It reads the plan's items afresh first (refresh-before-write) with
 * `fetchPlanItems`, never the request's `cache()`d read, which a page
 * rendered earlier in the request may hold and which would then be handed
 * back to any page rendered after the sync too; and it reads the service
 * type and its categories (three requests in parallel), then the catalog,
 * and which of the items' notes the write log says the app wrote: the only
 * ones it deletes (any other is kept, so a note typed by hand, or one the
 * log has lost track of, is never deleted). It recomputes the diff from
 * these, so it writes what is needed now, not what a preview showed.
 *
 * `previewed` is the plan the preview showed: its items as the dialog got
 * them (`status.items`). With it, the sync writes an item only when its
 * fresh diff is what the preview showed (`matchesPreview`: the same action
 * and writes, each to the same note with the same words), so Confirm writes
 * what the person saw; any other item is reported "changed", and nothing is
 * written for it. It comes from a browser and is only compared: every write
 * is the sync's own. Left out, every item's fresh diff is written.
 *
 * Then it makes the changes one at a time, unpaced
 * (someone is waiting), recording a `write_log` row (`item-note`) for each,
 * with what it asked for and what came of it or Planning Center's error.
 * An item whose change fails stops there, and the sync goes on to the next
 * item; except at Planning Center's rate limit (a 429 the client did not
 * retry), where the sync stops: every later item that needed a write is
 * reported "not-attempted", and nothing more is sent.
 *
 * A missing category, several of the name, or settings or categories that
 * could not be read, refuse the sync ("no-category" or "unavailable"):
 * nothing is written or logged. A plan, service type or catalog that cannot
 * be read throws before anything is written.
 */
export async function syncHymnNotes(
    serviceTypeId: string,
    planId: string,
    previewed?: readonly PreviewedHymnNote[]
): Promise<HymnNotesSyncResult> {
    const st = assertPcoId(serviceTypeId);
    const plan = assertPcoId(planId);
    const [serviceType, { items }, categories] = await Promise.all([
        getServiceType(st),
        fetchPlanItems(st, plan),
        readItemNoteCategories(st),
    ]);
    const { settings, error: settingsError } = getSettings();
    if (settingsError !== null) {
        // The defaults would name another category, or drop the tune the
        // church chose from every note: write nothing.
        return { ok: false, kind: "unavailable", message: settingsUnavailableMessage(settingsError) };
    }
    const db = getDb();
    const status = planHymnNoteStatus({
        serviceTypeName: serviceType.name,
        items,
        catalog: catalogOf(db, items),
        catalogError: null,
        categories,
        settings,
        settingsError,
        ownedNoteIds: findCreatedItemNoteIds(db, songItemNoteIds(items)),
    });
    if (status.kind !== "ready") {
        return { ok: false, kind: status.kind, message: status.message };
    }
    const expected = previewed === undefined ? null : previewedByItem(previewed);
    const results: HymnNoteSyncItem[] = [];
    let rateLimited = false;
    for (const diff of status.items) {
        if (expected !== null && !matchesPreview(diff, expected.get(diff.itemId))) {
            results.push(unwrittenItem(diff, "changed"));
        } else if (rateLimited && diff.changes.length > 0) {
            // The same limit would refuse it too.
            results.push(unwrittenItem(diff, "not-attempted"));
        } else {
            const synced = await syncItem(db, st, plan, status.category, diff);
            results.push(synced.item);
            rateLimited ||= synced.rateLimited;
        }
    }
    return { ok: true, category: status.category, items: results, counts: countSync(results) };
}

/** Whether a service type has the hymnal notes' category. */
export type HymnNoteCategoryLookup =
    | { status: "found"; category: ItemNoteCategory }
    /** It has none of that name: `message` asks for one to be created. */
    | { status: "missing"; message: string }
    /**
     * Several of its categories have that name, so the notes have no one
     * place to go: `message` asks for all but one to be renamed or deleted.
     */
    | { status: "ambiguous"; categories: ItemNoteCategory[]; message: string }
    /** Its categories could not be read. */
    | { status: "unavailable"; error: string };

/** A service type, and whether it has the hymnal notes' category. */
export interface ServiceTypeHymnNoteCategory {
    serviceType: ServiceType;
    category: HymnNoteCategoryLookup;
}

/** The hymnal notes' category in each service type, or why the service types could not be read. */
export type HymnNoteCategories =
    | {
          ok: true;
          /** The category's name, from the settings. */
          categoryName: string;
          /** Each service type that is not archived, in Planning Center's order. */
          serviceTypes: ServiceTypeHymnNoteCategory[];
      }
    | { ok: false; error: string };

/**
 * For Settings: each service type that is not archived, and whether it has
 * the item note category the hymnal notes go in (the
 * `hymnNoteCategoryName` setting, matched by name). One request for the
 * service types, then one per service type, in parallel. Never throws: a
 * failure is logged, and comes back as the reason.
 */
export async function getHymnNoteCategories(): Promise<HymnNoteCategories> {
    let serviceTypes: ServiceType[];
    try {
        serviceTypes = (await getServiceTypes()).filter((serviceType) => !serviceType.archived);
    } catch (error) {
        console.error("Failed to read the service types:", error);
        return { ok: false, error: errorMessage(error) };
    }
    const categoryName = getSettings().settings.hymnNoteCategoryName;
    const reads = await Promise.all(
        serviceTypes.map((serviceType) => readItemNoteCategories(serviceType.id))
    );
    return {
        ok: true,
        categoryName,
        serviceTypes: serviceTypes.map((serviceType, i) => {
            const read = reads[i];
            if (!read.ok) {
                return { serviceType, category: { status: "unavailable", error: read.error } };
            }
            const match = matchHymnNoteCategory(read.categories, categoryName);
            const category: HymnNoteCategoryLookup =
                match.status === "found"
                    ? { status: "found", category: match.category }
                    : match.status === "missing"
                      ? {
                            status: "missing",
                            message: missingCategoryMessage(categoryName, serviceType.name),
                        }
                      : {
                            status: "ambiguous",
                            categories: match.categories,
                            message: ambiguousCategoryMessage(
                                categoryName,
                                serviceType.name,
                                match.categories
                            ),
                        };
            return { serviceType, category };
        }),
    };
}
