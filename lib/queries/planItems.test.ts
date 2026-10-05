import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { recentWrites } from "@/lib/db/writeLog";
import { openTestDb } from "@/lib/db/testing";
import {
    PCO_BASE,
    calledRequests,
    calledUrls,
    itemResource,
    json,
    listPage,
    stubFetchRoutes,
    stubPcoCredentials,
    stubPcoPacer,
} from "@/lib/pco/testing";

// vi.hoisted: vi.mock factories run before the module's own declarations.
const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/lib/db", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/db")>()),
    getDb,
}));

import {
    ITEMS_CHANGED_MESSAGE,
    ITEMS_REORDERED_MESSAGE,
    REORDER_IN_PROGRESS_MESSAGE,
    reorderItems,
} from "./planItems";

const ST = "1405391";
const PLAN = "81234567";
const itemsUrl = `${PCO_BASE}/service_types/${ST}/plans/${PLAN}/items?include=song,item_notes&per_page=100`;
const reorderUrl = `${PCO_BASE}/service_types/${ST}/plans/${PLAN}/item_reorder`;

const T0 = new Date("2026-10-04T12:00:00.000Z");

let db: DatabaseSync;

beforeEach(() => {
    db = openTestDb();
    getDb.mockReturnValue(db);
    stubPcoCredentials();
    stubPcoPacer();
    vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
    db.close();
    getDb.mockReset();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

/** A plan's items: a header, three songs and a plain item, in this order. */
const TITLES: Record<string, string> = {
    "901": "Welcome",
    "902": "O God, Our Help",
    "903": "Amazing Grace",
    "904": "Offering",
    "905": "Abide with Me",
};
const SHOWN = ["901", "902", "903", "904", "905"];

/** Planning Center's items, in this order (their `sequence`s follow it). */
function planItems(ids: readonly string[] = SHOWN) {
    return listPage(
        ids.map((id, i) =>
            itemResource(id, {
                title: TITLES[id] ?? `Item ${id}`,
                sequence: i + 1,
                item_type: id === "901" ? "header" : "song",
            })
        )
    );
}

/** The routes of a plan whose items are `ids`, whose reorder Planning Center accepts. */
function routes(ids: readonly string[] = SHOWN, reorder: unknown = () => new Response(null, { status: 204 })) {
    return { [itemsUrl]: planItems(ids), [`POST ${reorderUrl}`]: reorder };
}

/** The writes a fetch mock was sent. */
function writesSent(fetchMock: ReturnType<typeof vi.fn>) {
    return calledRequests(fetchMock).filter(({ method }) => method !== "GET");
}

const ORDER = ["903", "901", "902", "905", "904"];

describe("reorderItems", () => {
    test("reads the items afresh, then sends every id in the new order, and says what moved", async () => {
        const fetchMock = stubFetchRoutes(routes());

        await expect(reorderItems(ST, PLAN, { shown: SHOWN, order: ORDER }, T0)).resolves.toEqual({
            ok: true,
            itemIds: ORDER,
            moved: 5,
        });

        expect(calledRequests(fetchMock)).toEqual([
            { method: "GET", url: itemsUrl, body: undefined },
            {
                method: "POST",
                url: reorderUrl,
                body: { data: { type: "PlanItemReorder", attributes: { sequence: ORDER } } },
            },
        ]);
        // Not paced: someone is waiting; never cached.
        expect(fetchMock.mock.calls[1][1]).toMatchObject({ cache: "no-store" });
    });

    test("counts only the items that changed place", async () => {
        stubFetchRoutes(routes());
        await expect(
            reorderItems(ST, PLAN, { shown: SHOWN, order: ["901", "903", "902", "904", "905"] }, T0)
        ).resolves.toMatchObject({ ok: true, moved: 2 });
    });

    test("reads afresh every time, never what an earlier read in the request cached", async () => {
        const fetchMock = stubFetchRoutes(routes());
        await reorderItems(ST, PLAN, { shown: SHOWN, order: ORDER }, T0);
        await reorderItems(ST, PLAN, { shown: SHOWN, order: ORDER }, T0);
        expect(calledUrls(fetchMock).filter((url) => url === itemsUrl)).toHaveLength(2);
    });

    test("logs the write: the order before and after, the titles and how many moved", async () => {
        stubFetchRoutes(routes());

        await reorderItems(ST, PLAN, { shown: SHOWN, order: ORDER }, T0);

        expect(recentWrites(db)).toEqual([
            {
                id: expect.any(Number),
                at: T0.toISOString(),
                kind: "item",
                target: `plan ${PLAN}`,
                ok: true,
                payload: {
                    action: "reorder",
                    serviceTypeId: ST,
                    planId: PLAN,
                    count: 5,
                    moved: 5,
                    from: SHOWN,
                    to: ORDER,
                    titles: TITLES,
                },
                result: { itemIds: ORDER },
            },
        ]);
    });

    describe("a plan that changed since the preview", () => {
        test("is refused when an item was added: nothing is sent or logged", async () => {
            const fetchMock = stubFetchRoutes(routes([...SHOWN, "906"]));

            await expect(reorderItems(ST, PLAN, { shown: SHOWN, order: ORDER }, T0)).resolves.toEqual({
                ok: false,
                reason: "changed",
                message: ITEMS_CHANGED_MESSAGE,
            });

            expect(writesSent(fetchMock)).toEqual([]);
            expect(recentWrites(db)).toEqual([]);
        });

        test("is refused when an item was removed", async () => {
            const fetchMock = stubFetchRoutes(routes(["901", "902", "903", "905"]));
            await expect(reorderItems(ST, PLAN, { shown: SHOWN, order: ORDER }, T0)).resolves.toMatchObject({
                ok: false,
                reason: "changed",
                message: ITEMS_CHANGED_MESSAGE,
            });
            expect(writesSent(fetchMock)).toEqual([]);
        });

        test("is refused when an item was replaced by another", async () => {
            const fetchMock = stubFetchRoutes(routes(["901", "902", "903", "904", "999"]));
            await expect(reorderItems(ST, PLAN, { shown: SHOWN, order: ORDER }, T0)).resolves.toMatchObject({
                ok: false,
                reason: "changed",
            });
            expect(writesSent(fetchMock)).toEqual([]);
        });

        test("is refused, in its own words, when someone put the same items in another order", async () => {
            const fetchMock = stubFetchRoutes(routes(["902", "901", "903", "904", "905"]));

            await expect(reorderItems(ST, PLAN, { shown: SHOWN, order: ORDER }, T0)).resolves.toEqual({
                ok: false,
                reason: "changed",
                message: ITEMS_REORDERED_MESSAGE,
            });

            expect(writesSent(fetchMock)).toEqual([]);
            expect(recentWrites(db)).toEqual([]);
        });
    });

    test("writes nothing for the order that was shown, and says nothing moved", async () => {
        const fetchMock = stubFetchRoutes(routes());
        await expect(reorderItems(ST, PLAN, { shown: SHOWN, order: SHOWN }, T0)).resolves.toEqual({
            ok: true,
            itemIds: SHOWN,
            moved: 0,
        });
        expect(writesSent(fetchMock)).toEqual([]);
        expect(recentWrites(db)).toEqual([]);
    });

    describe("an order it cannot write", () => {
        test.each([
            ["an item twice", { shown: SHOWN, order: ["901", "901", "903", "904", "905"] }],
            ["other items", { shown: SHOWN, order: ["901", "902", "903", "904", "999"] }],
            ["fewer items", { shown: SHOWN, order: ["901", "902"] }],
            ["no items", { shown: [], order: [] }],
            ["an id that is not one", { shown: ["901", "../1"], order: ["../1", "901"] }],
        ])("is refused for %s, before Planning Center is read", async (_name, previewed) => {
            const fetchMock = stubFetchRoutes({});
            await expect(reorderItems(ST, PLAN, previewed, T0)).resolves.toMatchObject({
                ok: false,
                reason: "invalid",
            });
            expect(fetchMock).not.toHaveBeenCalled();
            expect(getDb).not.toHaveBeenCalled();
        });

        test("is refused as no such plan for a service type or plan id that is not one", async () => {
            const fetchMock = stubFetchRoutes({});
            for (const [st, plan] of [
                ["x", PLAN],
                [ST, "01"],
                [ST, "../1"],
            ]) {
                await expect(reorderItems(st, plan, { shown: SHOWN, order: ORDER }, T0)).resolves.toEqual({
                    ok: false,
                    reason: "not-found",
                    message: "There is no such plan.",
                });
            }
            expect(fetchMock).not.toHaveBeenCalled();
        });
    });

    test("is refused as no such plan when Planning Center answers 404, logging nothing", async () => {
        const fetchMock = stubFetchRoutes({ [itemsUrl]: () => json({ errors: [] }, { status: 404 }) });
        await expect(reorderItems(ST, PLAN, { shown: SHOWN, order: ORDER }, T0)).resolves.toEqual({
            ok: false,
            reason: "not-found",
            message: "There is no such plan.",
        });
        expect(writesSent(fetchMock)).toEqual([]);
        expect(recentWrites(db)).toEqual([]);
    });

    describe("a write Planning Center refuses or fails", () => {
        const INVALID = {
            errors: [{ status: "422", title: "Validation Error", detail: "is invalid", source: { parameter: "sequence" } }],
        };

        test("is refused with Planning Center's reasons for a 422, and logged as a write that failed", async () => {
            stubFetchRoutes(routes(SHOWN, () => json(INVALID, { status: 422 })));

            await expect(reorderItems(ST, PLAN, { shown: SHOWN, order: ORDER }, T0)).resolves.toEqual({
                ok: false,
                reason: "refused",
                message: "Planning Center refused the new order: sequence: is invalid",
                details: ["sequence: is invalid"],
            });

            expect(recentWrites(db)).toEqual([
                expect.objectContaining({
                    kind: "item",
                    target: `plan ${PLAN}`,
                    ok: false,
                    payload: expect.objectContaining({ action: "reorder", from: SHOWN, to: ORDER }),
                    result: { error: "sequence: is invalid", status: 422, details: ["sequence: is invalid"] },
                }),
            ]);
        });

        test("throws for any other failure, after logging it, and frees the plan", async () => {
            stubFetchRoutes(routes(SHOWN, () => json({ errors: [] }, { status: 500 })));
            await expect(reorderItems(ST, PLAN, { shown: SHOWN, order: ORDER }, T0)).rejects.toMatchObject({
                status: 500,
            });
            expect(recentWrites(db)).toEqual([
                expect.objectContaining({
                    ok: false,
                    result: { error: expect.stringContaining("status: 500"), status: 500 },
                }),
            ]);

            stubFetchRoutes(routes());
            await expect(reorderItems(ST, PLAN, { shown: SHOWN, order: ORDER }, T0)).resolves.toMatchObject({
                ok: true,
            });
        });

        test("throws when the items cannot be read, writing nothing, and frees the plan", async () => {
            stubFetchRoutes({ [itemsUrl]: () => json({ errors: [] }, { status: 500 }) });
            await expect(reorderItems(ST, PLAN, { shown: SHOWN, order: ORDER }, T0)).rejects.toMatchObject({
                status: 500,
            });
            expect(recentWrites(db)).toEqual([]);

            stubFetchRoutes(routes());
            await expect(reorderItems(ST, PLAN, { shown: SHOWN, order: ORDER }, T0)).resolves.toMatchObject({
                ok: true,
            });
        });
    });

    describe("the database", () => {
        test("is opened before anything is sent: one that cannot be opened throws, and nothing is read or written", async () => {
            getDb.mockImplementation(() => {
                throw new Error("Could not open the database at /srv/data/x: denied");
            });
            const fetchMock = stubFetchRoutes({});
            await expect(reorderItems(ST, PLAN, { shown: SHOWN, order: ORDER }, T0)).rejects.toThrow(
                "Could not open the database"
            );
            expect(fetchMock).not.toHaveBeenCalled();
        });

        test("a log row that cannot be written is logged, and does not hide a write that was made", async () => {
            db.exec("DROP TABLE write_log");
            stubFetchRoutes(routes());
            await expect(reorderItems(ST, PLAN, { shown: SHOWN, order: ORDER }, T0)).resolves.toMatchObject({
                ok: true,
                moved: 5,
            });
            expect(console.error).toHaveBeenCalledWith(
                `Failed to record a write to Planning Center (plan ${PLAN}):`,
                expect.any(Error)
            );
        });
    });

    describe("one reorder per plan at a time", () => {
        /** A promise that is open once `open()` is called. */
        function gate() {
            let open!: () => void;
            const opened = new Promise<void>((resolve) => {
                open = resolve;
            });
            return { opened, open };
        }

        test("refuses a second reorder of the plan while the first is under way, from another copy of the module too", async () => {
            const { opened, open } = gate();
            const fetchMock = stubFetchRoutes(
                routes(SHOWN, async () => {
                    await opened;
                    return new Response(null, { status: 204 });
                })
            );
            vi.resetModules();
            const copy = await import("./planItems");

            const first = reorderItems(ST, PLAN, { shown: SHOWN, order: ORDER }, T0);
            const busy = { ok: false, reason: "busy", message: REORDER_IN_PROGRESS_MESSAGE };
            await expect(copy.reorderItems(ST, PLAN, { shown: SHOWN, order: ORDER }, T0)).resolves.toEqual(busy);
            await expect(reorderItems(ST, PLAN, { shown: SHOWN, order: SHOWN }, T0)).resolves.toEqual(busy);
            open();

            await expect(first).resolves.toMatchObject({ ok: true });
            expect(writesSent(fetchMock)).toHaveLength(1);
            expect(recentWrites(db)).toHaveLength(1);
        });

        test("lets reorders of other plans run together, and a plan be reordered again once the first is done", async () => {
            const { opened, open } = gate();
            const other = "81234999";
            const otherItems = `${PCO_BASE}/service_types/${ST}/plans/${other}/items?include=song,item_notes&per_page=100`;
            let posts = 0;
            stubFetchRoutes({
                ...routes(SHOWN, async () => {
                    posts += 1;
                    await opened;
                    return new Response(null, { status: 204 });
                }),
                [otherItems]: planItems(),
                [`POST ${PCO_BASE}/service_types/${ST}/plans/${other}/item_reorder`]: () =>
                    new Response(null, { status: 204 }),
            });

            const first = reorderItems(ST, PLAN, { shown: SHOWN, order: ORDER }, T0);
            await vi.waitFor(() => expect(posts).toBe(1));
            await expect(reorderItems(ST, other, { shown: SHOWN, order: ORDER }, T0)).resolves.toMatchObject({
                ok: true,
            });
            open();
            await expect(first).resolves.toMatchObject({ ok: true });
            await expect(reorderItems(ST, PLAN, { shown: SHOWN, order: ORDER }, T0)).resolves.toMatchObject({
                ok: true,
            });
        });
    });
});
