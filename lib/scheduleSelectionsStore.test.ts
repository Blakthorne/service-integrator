import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ScheduleSelection } from "./domain";
import type { ScheduleOption, ScheduleSelections } from "./scheduleSelections";
import {
    SAVE_NO_ANSWER_MESSAGE,
    createPlanSelectionsRegistry,
    createPlanSelectionsStore,
    type PlanSelectionsStore,
    type SaveSelection,
    type SelectionSaveResult,
} from "./scheduleSelectionsStore";

/** A save the test answers by hand. */
interface PendingSave {
    itemId: string;
    selection: ScheduleSelection;
    answer(result: SelectionSaveResult): Promise<void>;
    fail(error: unknown): Promise<void>;
}

/** Lets every promise callback queued so far run. */
async function settled(): Promise<void> {
    for (let i = 0; i < 5; i += 1) {
        await Promise.resolve();
    }
}

/** A save function that records each call and waits for the test to answer it. */
function fakeSave() {
    const calls: PendingSave[] = [];
    const save = vi.fn<SaveSelection>(
        (itemId, selection) =>
            new Promise<SelectionSaveResult>((resolve, reject) => {
                calls.push({
                    itemId,
                    selection,
                    answer: async (result) => {
                        resolve(result);
                        await settled();
                    },
                    fail: async (error) => {
                        reject(error);
                        await settled();
                    },
                });
            })
    );
    return { save, calls };
}

const OK = { ok: true } as const;
const LOCKED = { ok: false, message: "The database could not be written." } as const;

function choose(store: PlanSelectionsStore, itemId: string, option: ScheduleOption): void {
    store.dispatch({ type: "chooseOption", itemId, option });
}

function type(store: PlanSelectionsStore, itemId: string, text: string): void {
    store.dispatch({ type: "setCustomText", itemId, text });
}

let save: ReturnType<typeof fakeSave>["save"];
let calls: PendingSave[];

beforeEach(() => {
    ({ save, calls } = fakeSave());
    vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
});

function newStore(selections: ScheduleSelections = {}) {
    return createPlanSelectionsStore({ selections, save });
}

describe("createPlanSelectionsStore: the choices", () => {
    test("starts with the saved choices, and reports no saves", () => {
        const seed: ScheduleSelections = {
            "1": { option: "custom", customText: "last verse" },
            "2": { option: "blank" },
        };
        const store = newStore(seed);
        expect(store.getSnapshot()).toStrictEqual({ selections: seed, saves: {} });
    });

    test("the snapshot stays the same object until something changes", () => {
        const store = newStore();
        const first = store.getSnapshot();
        expect(store.getSnapshot()).toBe(first);
        choose(store, "1", "blank");
        const second = store.getSnapshot();
        expect(second).not.toBe(first);
        expect(store.getSnapshot()).toBe(second);
    });

    test("a change applies at once, before its save answers", () => {
        const store = newStore({ "1": { option: "numbers" } });
        choose(store, "1", "custom");
        type(store, "1", "verse 2");
        expect(store.getSnapshot().selections).toStrictEqual({
            "1": { option: "custom", customText: "verse 2" },
        });
    });

    test("tells its listeners of every change, until they stop listening", async () => {
        const store = newStore();
        const listener = vi.fn();
        const stop = store.subscribe(listener);
        choose(store, "1", "blank");
        expect(listener).toHaveBeenCalledTimes(1);
        await calls[0].answer(OK);
        expect(listener).toHaveBeenCalledTimes(2);
        stop();
        choose(store, "1", "numbers");
        expect(listener).toHaveBeenCalledTimes(2);
    });
});

describe("createPlanSelectionsStore: what is saved", () => {
    test("a radio choice is saved at once", () => {
        const store = newStore();
        choose(store, "1", "blank");
        expect(save).toHaveBeenCalledTimes(1);
        expect(save).toHaveBeenCalledWith("1", { option: "blank" });
    });

    test("Custom is saved with the text, and each text change while it is chosen", async () => {
        const store = newStore();
        choose(store, "1", "custom");
        expect(save).toHaveBeenLastCalledWith("1", { option: "custom", customText: "" });
        await calls[0].answer(OK);
        type(store, "1", "verse 2");
        expect(save).toHaveBeenLastCalledWith("1", { option: "custom", customText: "verse 2" });
    });

    test("text typed while another option shows is saved only when Custom is chosen", async () => {
        const store = newStore({ "2": { option: "numbers" } });
        type(store, "1", "typed first");
        type(store, "2", "typed under Numbers");
        expect(save).not.toHaveBeenCalled();
        choose(store, "1", "custom");
        expect(save).toHaveBeenCalledWith("1", { option: "custom", customText: "typed first" });
        choose(store, "2", "custom");
        expect(save).toHaveBeenCalledWith("2", {
            option: "custom",
            customText: "typed under Numbers",
        });
    });

    test("a change that leaves the saved choice as it was saves nothing", () => {
        const store = newStore({ "1": { option: "custom", customText: "x" } });
        type(store, "1", "x");
        expect(save).not.toHaveBeenCalled();
    });

    test("each change is saved, whatever became of the saves before it", async () => {
        const store = newStore();
        choose(store, "1", "blank");
        await calls[0].answer(LOCKED);
        choose(store, "2", "blank");
        expect(save).toHaveBeenLastCalledWith("2", { option: "blank" });
        await calls[1].answer(OK);
        expect(store.getSnapshot().saves).toStrictEqual({
            "1": { status: "failed", message: LOCKED.message, attempt: 1, retrying: false },
        });
    });
});

describe("createPlanSelectionsStore: saves in order", () => {
    test("a save on its way is reported as saving, and nothing once it is done", async () => {
        const store = newStore();
        choose(store, "1", "blank");
        expect(store.getSnapshot().saves).toStrictEqual({ "1": { status: "saving" } });
        await calls[0].answer(OK);
        expect(store.getSnapshot().saves).toStrictEqual({});
    });

    test("one item's saves go one at a time, and only the newest waiting change follows", async () => {
        const store = newStore();
        choose(store, "1", "blank");
        choose(store, "1", "custom");
        type(store, "1", "a");
        type(store, "1", "ab");
        expect(calls.map((call) => call.selection)).toStrictEqual([{ option: "blank" }]);

        await calls[0].answer(OK);
        expect(calls.map((call) => call.selection)).toStrictEqual([
            { option: "blank" },
            { option: "custom", customText: "ab" },
        ]);
        expect(store.getSnapshot().saves).toStrictEqual({ "1": { status: "saving" } });
        await calls[1].answer(OK);
        expect(store.getSnapshot().saves).toStrictEqual({});
        expect(save).toHaveBeenCalledTimes(2);
    });

    test("an older save that failed is ignored when a newer one follows it, which decides", async () => {
        const store = newStore();
        choose(store, "1", "blank");
        choose(store, "1", "numbers");
        await calls[0].answer(LOCKED);
        expect(store.getSnapshot().saves).toStrictEqual({ "1": { status: "saving" } });
        await calls[1].answer(OK);
        expect(store.getSnapshot().saves).toStrictEqual({});
    });

    test("the last save decides: an older one that worked does not hide a newer failure", async () => {
        const store = newStore();
        choose(store, "1", "blank");
        choose(store, "1", "numbers");
        await calls[0].answer(OK);
        await calls[1].answer(LOCKED);
        expect(store.getSnapshot().saves).toStrictEqual({
            "1": { status: "failed", message: LOCKED.message, attempt: 1, retrying: false },
        });
        expect(store.getSnapshot().selections["1"]).toStrictEqual({ option: "numbers" });
    });

    test("different items save side by side", async () => {
        const store = newStore();
        choose(store, "1", "blank");
        choose(store, "2", "blank");
        expect(calls.map((call) => call.itemId)).toStrictEqual(["1", "2"]);
        await calls[1].answer(LOCKED);
        expect(store.getSnapshot().saves).toStrictEqual({
            "1": { status: "saving" },
            "2": { status: "failed", message: LOCKED.message, attempt: 1, retrying: false },
        });
    });
});

describe("createPlanSelectionsStore: failures", () => {
    test("a failed save keeps the choice and says why, until a retry saves it", async () => {
        const store = newStore({ "1": { option: "numbers" } });
        choose(store, "1", "blank");
        await calls[0].answer(LOCKED);
        expect(store.getSnapshot()).toStrictEqual({
            selections: { "1": { option: "blank" } },
            saves: {
                "1": { status: "failed", message: LOCKED.message, attempt: 1, retrying: false },
            },
        });

        store.retry("1");
        expect(calls[1].selection).toStrictEqual({ option: "blank" });
        // The failure still stands while the retry is on its way.
        expect(store.getSnapshot().saves).toStrictEqual({
            "1": { status: "failed", message: LOCKED.message, attempt: 1, retrying: true },
        });
        await calls[1].answer(OK);
        expect(store.getSnapshot().saves).toStrictEqual({});
    });

    test("each failure is a new attempt, so a repeated message is new too", async () => {
        const store = newStore();
        choose(store, "1", "blank");
        await calls[0].answer(LOCKED);
        store.retry("1");
        await calls[1].answer(LOCKED);
        expect(store.getSnapshot().saves["1"]).toStrictEqual({
            status: "failed",
            message: LOCKED.message,
            attempt: 2,
            retrying: false,
        });
    });

    test("another change after a failure saves the new choice, which clears it", async () => {
        const store = newStore();
        choose(store, "1", "blank");
        await calls[0].answer(LOCKED);
        choose(store, "1", "custom");
        expect(calls[1].selection).toStrictEqual({ option: "custom", customText: "" });
        expect(store.getSnapshot().saves["1"]).toMatchObject({ status: "failed", retrying: true });
        await calls[1].answer(OK);
        expect(store.getSnapshot().saves).toStrictEqual({});
    });

    test("a retry sends the choice on screen now", async () => {
        const store = newStore();
        choose(store, "1", "custom");
        await calls[0].answer(LOCKED);
        // Text typed in the meantime was saved with Custom, and failed too.
        type(store, "1", "x");
        await calls[1].answer(LOCKED);
        store.retry("1");
        expect(calls[2].selection).toStrictEqual({ option: "custom", customText: "x" });
    });

    test("a retry does nothing unless the last save failed and none is on its way", async () => {
        const store = newStore();
        store.retry("1");
        choose(store, "1", "blank");
        store.retry("1");
        expect(save).toHaveBeenCalledTimes(1);
        await calls[0].answer(OK);
        store.retry("1");
        expect(save).toHaveBeenCalledTimes(1);
    });

    test("a save that never answers fails as no answer, and the cause is logged", async () => {
        const store = newStore();
        choose(store, "1", "blank");
        const cause = new TypeError("Failed to fetch");
        await calls[0].fail(cause);
        expect(store.getSnapshot().saves["1"]).toStrictEqual({
            status: "failed",
            message: SAVE_NO_ANSWER_MESSAGE,
            attempt: 1,
            retrying: false,
        });
        expect(console.error).toHaveBeenCalledWith("Failed to save the choice for item 1:", cause);
    });

    test("a save that throws before it starts fails the same way", async () => {
        const store = createPlanSelectionsStore({
            selections: {},
            save: () => {
                throw new Error("Not signed in");
            },
        });
        choose(store, "1", "blank");
        await settled();
        expect(store.getSnapshot().saves["1"]).toMatchObject({
            status: "failed",
            message: SAVE_NO_ANSWER_MESSAGE,
        });
    });

    test("a save still reaches the database, and reports, after its listeners have gone", async () => {
        const store = newStore();
        const stop = store.subscribe(() => {});
        stop();
        type(store, "1", "x");
        choose(store, "1", "custom");
        expect(save).toHaveBeenCalledWith("1", { option: "custom", customText: "x" });
        await calls[0].answer(LOCKED);
        expect(store.getSnapshot().saves["1"]).toMatchObject({ status: "failed" });
    });
});

describe("createPlanSelectionsRegistry", () => {
    const detail = { selections: {} };

    test("finds a plan's store only with the very data it was last shown with", () => {
        const registry = createPlanSelectionsRegistry<object>();
        const store = newStore();
        registry.remember("1/2", detail, store);
        expect(registry.find("1/2", detail)).toBe(store);
        // An equal object is data just read from the server.
        expect(registry.find("1/2", { selections: {} })).toBeUndefined();
        expect(registry.find("1/3", detail)).toBeUndefined();
    });

    test("remembers the data the store was last shown with", () => {
        const registry = createPlanSelectionsRegistry<object>();
        const store = newStore();
        const revalidated = { selections: {} };
        registry.remember("1/2", detail, store);
        registry.remember("1/2", revalidated, store);
        expect(registry.find("1/2", revalidated)).toBe(store);
        expect(registry.find("1/2", detail)).toBeUndefined();
    });

    test("keeps only the plans used last", () => {
        const registry = createPlanSelectionsRegistry<object>(2);
        const stores = ["a", "b", "c"].map(() => newStore());
        registry.remember("a", detail, stores[0]);
        registry.remember("b", detail, stores[1]);
        // Using "a" again makes "b" the oldest.
        registry.remember("a", detail, stores[0]);
        registry.remember("c", detail, stores[2]);
        expect(registry.find("a", detail)).toBe(stores[0]);
        expect(registry.find("b", detail)).toBeUndefined();
        expect(registry.find("c", detail)).toBe(stores[2]);
    });
});
