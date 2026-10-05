import type { ScheduleSelection } from "./domain";
import {
    sameSavedSelection,
    savedSelection,
    scheduleSelectionsReducer,
    type ScheduleSelections,
    type ScheduleSelectionsAction,
} from "./scheduleSelections";

/**
 * A plan's Schedule-tab choices while its pages are open, and their saving.
 * Pure and safe on both sides: `PlanProvider` keeps one store per plan and
 * reads it with `useSyncExternalStore`; the store itself knows nothing of
 * React, so it is tested without a browser.
 *
 * Every change applies at once, and when it changes what the database keeps
 * of the item's choice (`savedSelection`), it is saved through `save` (the
 * plan's `saveScheduleSelection` action). Saves for one item go one at a
 * time: a change made while one is on its way waits, a newer change
 * replaces a waiting one, and the result of a save that a newer one follows
 * is ignored, so the last choice is the one saved and the one reported.
 * A failed save keeps the choice on screen and says so (`saves`), until a
 * later save of the item succeeds: a retry, or another change.
 *
 * The store outlives the provider that made it: a save still on its way
 * when the plan's pages go (the custom text saved as its box unmounts)
 * still reaches the database, and a page that Back brings back finds its
 * store again (`createPlanSelectionsRegistry`).
 */

/** How saving one choice went: saved, or why not, fit to show. */
export type SelectionSaveResult = { ok: true } | { ok: false; message: string };

/** Saves `selection` as item `itemId`'s choice: the plan's `saveScheduleSelection` action, with its ids. */
export type SaveSelection = (
    itemId: string,
    selection: ScheduleSelection
) => Promise<SelectionSaveResult>;

/** The reason given when a save never answered: the network failed, or the session ended. */
export const SAVE_NO_ANSWER_MESSAGE = "The server did not answer.";

/**
 * How an item's choice stands in the database, when there is something to
 * say; an item with no entry is saved, or has not been changed.
 *
 * - "saving": a save is on its way, and none has failed.
 * - "failed": the last save failed, for `message`, so the choice on screen
 *   is not saved. `retrying` while a later save is on its way. `attempt`
 *   is new for each failure, so each one can be announced, the same words
 *   too.
 */
export type SelectionSaveState =
    | { status: "saving" }
    | { status: "failed"; message: string; attempt: number; retrying: boolean };

/** What a store holds: the choices, and how the saves of the changed ones stand, by item ID. */
export interface PlanSelectionsSnapshot {
    selections: ScheduleSelections;
    saves: Readonly<Record<string, SelectionSaveState>>;
}

/** A plan's choices (see the module's comment). */
export interface PlanSelectionsStore {
    /** The choices and the saves' states now: the same object until something changes. */
    getSnapshot(): PlanSelectionsSnapshot;
    /** Calls `listener` after every change. Returns what stops it. */
    subscribe(listener: () => void): () => void;
    /** Apply a change at once, and save it when it changes what the database keeps. */
    dispatch(action: ScheduleSelectionsAction): void;
    /** Save item `itemId`'s choice again after its save failed. Does nothing while a save of it is on its way. */
    retry(itemId: string): void;
}

/** One item's saves: whether one is on its way, the choice waiting to follow it, and the last failure. */
interface ItemSaves {
    inFlight: boolean;
    waiting: ScheduleSelection | null;
    failure: { message: string; attempt: number } | null;
}

/**
 * A store seeded with `selections` (the plan's saved choices). Every change
 * that alters what the database keeps is saved through `save`, whatever
 * happened before: even when the saved choices could not be read, a save is
 * tried, and says so when it fails, since the database may have recovered
 * since (`getDb()` tries again after a failure).
 */
export function createPlanSelectionsStore({
    selections: seed,
    save,
}: {
    selections: ScheduleSelections;
    save: SaveSelection;
}): PlanSelectionsStore {
    let selections = seed;
    const items = new Map<string, ItemSaves>();
    const listeners = new Set<() => void>();
    let failures = 0;
    let snapshot: PlanSelectionsSnapshot = { selections, saves: {} };

    function publish(): void {
        const saves: Record<string, SelectionSaveState> = {};
        for (const [itemId, item] of items) {
            if (item.failure !== null) {
                saves[itemId] = {
                    status: "failed",
                    ...item.failure,
                    retrying: item.inFlight,
                };
            } else if (item.inFlight) {
                saves[itemId] = { status: "saving" };
            }
        }
        snapshot = { selections, saves };
        for (const listener of [...listeners]) {
            listener();
        }
    }

    function settle(itemId: string, item: ItemSaves, result: SelectionSaveResult): void {
        item.inFlight = false;
        if (item.waiting !== null) {
            // A newer choice follows, so this result says nothing about what is saved.
            const next = item.waiting;
            item.waiting = null;
            send(itemId, item, next);
        } else if (result.ok) {
            item.failure = null;
        } else {
            failures += 1;
            item.failure = { message: result.message, attempt: failures };
        }
        publish();
    }

    function send(itemId: string, item: ItemSaves, selection: ScheduleSelection): void {
        item.inFlight = true;
        let saving: Promise<SelectionSaveResult>;
        try {
            saving = save(itemId, selection);
        } catch (error) {
            saving = Promise.reject(error);
        }
        saving
            .then(
                (result) => result,
                (error: unknown) => {
                    console.error(`Failed to save the choice for item ${itemId}:`, error);
                    return { ok: false, message: SAVE_NO_ANSWER_MESSAGE } as const;
                }
            )
            .then((result) => settle(itemId, item, result));
    }

    function enqueue(itemId: string, selection: ScheduleSelection): void {
        let item = items.get(itemId);
        if (item === undefined) {
            item = { inFlight: false, waiting: null, failure: null };
            items.set(itemId, item);
        }
        if (item.inFlight) {
            item.waiting = selection;
        } else {
            send(itemId, item, selection);
        }
    }

    return {
        getSnapshot: () => snapshot,
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        dispatch(action) {
            const before = savedSelection(selections[action.itemId]);
            selections = scheduleSelectionsReducer(selections, action);
            const after = savedSelection(selections[action.itemId]);
            if (after !== null && !sameSavedSelection(before, after)) {
                enqueue(action.itemId, after);
            }
            publish();
        },
        retry(itemId) {
            const item = items.get(itemId);
            const selection = savedSelection(selections[itemId]);
            if (item === undefined || item.failure === null || item.inFlight || selection === null) {
                return;
            }
            send(itemId, item, selection);
            publish();
        },
    };
}

/** What the registry keeps of a plan: the store, and the plan's data it was last shown with. */
export interface PlanSelectionsRegistry<D extends object> {
    /**
     * The store of plan `key` when it was last shown with this very `detail`
     * (the same object, not an equal one), else undefined.
     */
    find(key: string, detail: D): PlanSelectionsStore | undefined;
    /** Note that `store` is plan `key`'s, now shown with `detail`. */
    remember(key: string, detail: D, store: PlanSelectionsStore): void;
}

/** How many plans a registry remembers by default: the ones visited last. */
const REMEMBERED_PLANS = 20;

/**
 * The stores of the plans visited last (at most `limit`), each with the
 * plan's data it was last shown with.
 *
 * It exists for Back and Forward. Next's router keeps a page as it was
 * rendered and shows that again on Back, so a plan's pages come back with
 * the `detail` they were rendered with, the very same object, and its saved
 * choices as they were then, before the changes made since. Finding the
 * store by that object gives those changes back. Any other `detail` was
 * just read from the server, choices and all, so it gets a new store.
 */
export function createPlanSelectionsRegistry<D extends object>(
    limit: number = REMEMBERED_PLANS
): PlanSelectionsRegistry<D> {
    const entries = new Map<string, { detail: D; store: PlanSelectionsStore }>();
    return {
        find(key, detail) {
            const entry = entries.get(key);
            return entry !== undefined && entry.detail === detail ? entry.store : undefined;
        },
        remember(key, detail, store) {
            // Deleted first, so the Map's order is the order of use.
            entries.delete(key);
            entries.set(key, { detail, store });
            for (const oldest of entries.keys()) {
                if (entries.size <= limit) {
                    break;
                }
                entries.delete(oldest);
            }
        },
    };
}
