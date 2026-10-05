import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { finishSyncRun, latestSyncRun, startSyncRun } from "@/lib/db/syncRuns";
import { openTestDb } from "@/lib/db/testing";
import {
    PCO_BASE,
    itemResource,
    json,
    listPage,
    planResource,
    serviceTypeResource,
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

import { syncPlanHistoryNow } from "./reports";

let db: DatabaseSync;

beforeEach(() => {
    db = openTestDb();
    getDb.mockReturnValue(db);
    stubPcoCredentials();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
    db.close();
    getDb.mockReset();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

const SERVICE_TYPES = `${PCO_BASE}/service_types?per_page=100`;
const PLANS = `${PCO_BASE}/service_types/1405391/plans?order=-sort_date&per_page=100`;
const ITEMS = `${PCO_BASE}/service_types/1405391/plans/501/items?include=song&per_page=100`;

describe("syncPlanHistoryNow", () => {
    test("runs the history sync as a job and gives its run", async () => {
        stubPcoPacer();
        stubFetchRoutes({
            [SERVICE_TYPES]: listPage([serviceTypeResource({}, "1405391")]),
            [PLANS]: listPage([planResource({ id: "501" }, { sort_date: "2026-09-27T08:00:00Z" })]),
            [ITEMS]: listPage([
                itemResource("1", { sequence: 1 }, { song: { data: { type: "Song", id: "77" } } }),
            ]),
        });

        const result = await syncPlanHistoryNow();

        expect(result).toEqual({ run: latestSyncRun(db, "history") });
        expect(result.run).toMatchObject({
            kind: "history",
            ok: true,
            counts: { plans: 1, added: 1, read: 1, occurrences: 1 },
        });
        expect(db.prepare("SELECT plan_id, pco_song_id FROM plan_occurrences").all()).toEqual([
            { plan_id: "501", pco_song_id: "77" },
        ]);
    });

    test("gives a failed run rather than throwing", async () => {
        stubPcoPacer();
        stubFetchRoutes({ [SERVICE_TYPES]: () => json({ errors: [] }, { status: 500 }) });

        await expect(syncPlanHistoryNow()).resolves.toEqual({
            run: expect.objectContaining({
                kind: "history",
                ok: false,
                message: expect.stringContaining("status: 500"),
            }),
        });
    });

    test("joins a run in progress rather than start another", async () => {
        stubPcoPacer();
        let answer!: () => void;
        const held = new Promise<void>((resolve) => {
            answer = resolve;
        });
        const fetchMock = stubFetchRoutes({
            [SERVICE_TYPES]: async () => {
                await held;
                return json(listPage([]));
            },
        });

        const first = syncPlanHistoryNow();
        const second = syncPlanHistoryNow();
        answer();
        const [a, b] = await Promise.all([first, second]);

        expect(a).toEqual(b);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    test("gives why, never an older run, when no run can be recorded", async () => {
        const id = startSyncRun(db, "history", new Date("2026-10-03T12:00:00.000Z"));
        finishSyncRun(db, id, { ok: true, message: "Synced 1 plan" }, new Date("2026-10-03T12:00:00.000Z"));
        db.exec(
            "CREATE TRIGGER full BEFORE INSERT ON sync_runs BEGIN SELECT RAISE(ABORT, 'database or disk is full'); END"
        );
        const fetchMock = stubFetchRoutes({});

        await expect(syncPlanHistoryNow()).resolves.toEqual({
            run: null,
            error: "database or disk is full",
        });
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
