import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { countHistory, listHistoryPlans } from "@/lib/db/history";
import { openTestDb, seedHistoryPlan, seedOccurrence } from "@/lib/db/testing";
import {
    PCO_BASE,
    calledUrls,
    itemResource,
    json,
    listPage,
    planResource,
    serviceTypeResource,
    stubFetchRoutes,
    stubPcoCredentials,
    stubPcoPacer,
    planListingUrl,
} from "@/lib/pco/testing";
import { describePlanHistorySync, syncPlanHistory, type PlanHistorySyncCounts } from "./history";

let db: DatabaseSync;

beforeEach(() => {
    db = openTestDb();
    stubPcoCredentials();
});

afterEach(() => {
    db.close();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

const MORNING = "1405391";
const EVENING = "1486055";

const SERVICE_TYPES = `${PCO_BASE}/service_types?per_page=100`;
const plansUrl = planListingUrl;
const itemsUrl = (serviceTypeId: string, planId: string) =>
    `${PCO_BASE}/service_types/${serviceTypeId}/plans/${planId}/items?include=song&per_page=100`;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Noon on Sunday 2026-10-04 by the clock of the machine the tests run on, so that its date is that date in every time zone. */
const T0 = new Date(2026, 9, 4, 12, 0, 0);
const after = (ms: number) => new Date(T0.getTime() + ms);

/** An item of a fake plan: a song item when it has a song. */
interface FakeItem {
    id: string;
    sequence: number;
    song?: string;
    type?: string;
    title?: string;
}

interface FakePlan {
    id: string;
    serviceType: string;
    /** `YYYY-MM-DD`. */
    date: string;
    updatedAt?: string;
    items: FakeItem[];
}

const songLink = (id: string) => ({ song: { data: { type: "Song" as const, id } } });

function planOf({ id, date, updatedAt = "2026-01-01T00:00:00Z" }: FakePlan) {
    return planResource({ id }, { sort_date: `${date}T08:00:00Z`, updated_at: updatedAt });
}

function itemOf({ id, sequence, song, type, title = `Item ${id}` }: FakeItem) {
    return itemResource(
        id,
        { sequence, title, item_type: type ?? (song === undefined ? "item" : "song") },
        song === undefined ? undefined : songLink(song)
    );
}

/**
 * What Planning Center answers for these plans: the two service types, each
 * type's plans (newest first, as asked) and each plan's items. `overrides`
 * replace routes by URL.
 */
function routes(plans: FakePlan[], overrides: Record<string, unknown> = {}): Record<string, unknown> {
    const ofType = (serviceType: string) =>
        listPage(
            plans
                .filter((plan) => plan.serviceType === serviceType)
                .sort((a, b) => b.date.localeCompare(a.date))
                .map(planOf)
        );
    const table: Record<string, unknown> = {
        [SERVICE_TYPES]: listPage([
            serviceTypeResource({ name: "Sunday Morning" }, MORNING),
            serviceTypeResource({ name: "Sunday Evening", sequence: 2 }, EVENING),
        ]),
        [plansUrl(MORNING)]: ofType(MORNING),
        [plansUrl(EVENING)]: ofType(EVENING),
    };
    for (const plan of plans) {
        table[itemsUrl(plan.serviceType, plan.id)] = listPage(plan.items.map(itemOf));
    }
    return { ...table, ...overrides };
}

/** The plans whose items a fetch mock was asked for, in order. */
function itemRequests(fetchMock: ReturnType<typeof vi.fn>): string[] {
    return calledUrls(fetchMock).flatMap((url) => {
        const match = /\/plans\/([0-9]+)\/items\?/.exec(url);
        return match ? [match[1]] : [];
    });
}

/** The plans of the history, as [id, date, service type, items read at]. */
function storedPlans() {
    return listHistoryPlans(db)
        .map((plan) => [plan.planId, plan.planDate, plan.serviceTypeId, plan.itemsSyncedAt] as const)
        .sort((a, b) => Number(a[0]) - Number(b[0]));
}

/** A plan's stored song items, as [item id, song id, sequence]. */
function songsOf(planId: string) {
    return db
        .prepare("SELECT item_id, pco_song_id, sequence FROM plan_occurrences WHERE plan_id = ? ORDER BY sequence, item_id")
        .all(planId)
        .map((row) => [String(row.item_id), String(row.pco_song_id), Number(row.sequence)]);
}

/**
 * A church's plans on 2026-10-04 (a Sunday):
 * - 400, next Sunday's morning plan, and 399, today's, are upcoming;
 * - 398 and 397, last Sunday's morning and evening plans, are recent;
 * - 200 (March) and 100 (2025) are older than 8 weeks.
 */
function church(): FakePlan[] {
    return [
        { id: "400", serviceType: MORNING, date: "2026-10-11", items: [{ id: "1", sequence: 1, song: "5001" }] },
        {
            id: "399",
            serviceType: MORNING,
            date: "2026-10-04",
            items: [
                { id: "1", sequence: 1, song: "5001" },
                { id: "2", sequence: 2, song: "5002" },
            ],
        },
        {
            id: "398",
            serviceType: MORNING,
            date: "2026-09-27",
            items: [
                { id: "1", sequence: 1, title: "Welcome", type: "header" },
                { id: "2", sequence: 2, song: "5002" },
                { id: "3", sequence: 3, song: "5003" },
                { id: "4", sequence: 4, title: "Offering" },
                { id: "5", sequence: 5, song: "5003" },
                { id: "6", sequence: 6, title: "Gone", type: "song" },
            ],
        },
        { id: "397", serviceType: EVENING, date: "2026-09-27", items: [{ id: "1", sequence: 1, song: "5001" }] },
        { id: "200", serviceType: MORNING, date: "2026-03-01", items: [{ id: "1", sequence: 1, song: "5004" }] },
        { id: "100", serviceType: MORNING, date: "2025-05-04", items: [{ id: "1", sequence: 1, song: "5001" }] },
    ];
}

describe("syncPlanHistory", () => {
    test("lists every plan, then reads the songs of each, all paced, and stores them with their plan's date and service type", async () => {
        const acquire = vi.spyOn(stubPcoPacer(), "acquire");
        const fetchMock = stubFetchRoutes(routes(church()));

        await expect(syncPlanHistory(db, () => T0)).resolves.toEqual({
            plans: 6,
            added: 6,
            changed: 0,
            removed: 0,
            read: 6,
            weekly: 0,
            failed: 0,
            occurrences: 9,
            failures: [],
        });

        // The service types, each type's plans, then the items of each plan, the latest date first.
        expect(calledUrls(fetchMock)).toEqual([
            SERVICE_TYPES,
            plansUrl(MORNING),
            plansUrl(EVENING),
            itemsUrl(MORNING, "400"),
            itemsUrl(MORNING, "399"),
            itemsUrl(MORNING, "398"),
            itemsUrl(EVENING, "397"),
            itemsUrl(MORNING, "200"),
            itemsUrl(MORNING, "100"),
        ]);
        expect(acquire).toHaveBeenCalledTimes(9);
        for (const [, init] of fetchMock.mock.calls) {
            expect(init).toMatchObject({ cache: "no-store" });
        }
        expect(storedPlans()).toEqual([
            ["100", "2025-05-04", MORNING, T0.toISOString()],
            ["200", "2026-03-01", MORNING, T0.toISOString()],
            ["397", "2026-09-27", EVENING, T0.toISOString()],
            ["398", "2026-09-27", MORNING, T0.toISOString()],
            ["399", "2026-10-04", MORNING, T0.toISOString()],
            ["400", "2026-10-11", MORNING, T0.toISOString()],
        ]);
        expect(songsOf("399")).toEqual([
            ["1", "5001", 1],
            ["2", "5002", 2],
        ]);
        expect(
            db
                .prepare("SELECT plan_date, service_type_id FROM plan_occurrences WHERE plan_id = '397'")
                .all()
        ).toEqual([{ plan_date: "2026-09-27", service_type_id: EVENING }]);
    });

    test("keeps the song items only: headers, plain items and an item whose song is gone are left out, a song twice is twice", async () => {
        stubPcoPacer();
        stubFetchRoutes(routes(church()));

        await syncPlanHistory(db, () => T0);

        expect(songsOf("398")).toEqual([
            ["2", "5002", 2],
            ["3", "5003", 3],
            ["5", "5003", 5],
        ]);
    });

    test("reads again every plan that is upcoming or recent, and no other, on the next sync", async () => {
        stubPcoPacer();
        stubFetchRoutes(routes(church()));
        await syncPlanHistory(db, () => T0);

        const fetchMock = stubFetchRoutes(routes(church()));
        const counts = await syncPlanHistory(db, () => after(DAY_MS));

        expect(itemRequests(fetchMock)).toEqual(["400", "399", "398", "397"]);
        expect(counts).toEqual({
            plans: 6,
            added: 0,
            changed: 0,
            removed: 0,
            read: 4,
            weekly: 0,
            failed: 0,
            occurrences: 9,
            failures: [],
        });
        // The older plans keep when they were read.
        expect(storedPlans().map(([id, , , readAt]) => [id, readAt])).toEqual([
            ["100", T0.toISOString()],
            ["200", T0.toISOString()],
            ["397", after(DAY_MS).toISOString()],
            ["398", after(DAY_MS).toISOString()],
            ["399", after(DAY_MS).toISOString()],
            ["400", after(DAY_MS).toISOString()],
        ]);
    });

    test("picks up what changed in a recent plan without a new updated_at, as an edit through the API does", async () => {
        stubPcoPacer();
        stubFetchRoutes(routes(church()));
        await syncPlanHistory(db, () => T0);
        expect(songsOf("400")).toEqual([["1", "5001", 1]]);

        const next = church();
        next[0].items.push({ id: "2", sequence: 2, song: "5009" });
        stubFetchRoutes(routes(next));
        await syncPlanHistory(db, () => after(DAY_MS));

        expect(songsOf("400")).toEqual([
            ["1", "5001", 1],
            ["2", "5009", 2],
        ]);
    });

    test("replaces a plan's songs when its items change, however they changed", async () => {
        stubPcoPacer();
        stubFetchRoutes(routes(church()));
        await syncPlanHistory(db, () => T0);

        const next = church();
        // 5002 moved to the end and 5003's two items became one; item 2 of plan 399 was replaced by item 7.
        next[2].items = [
            { id: "3", sequence: 1, song: "5003" },
            { id: "2", sequence: 2, song: "5002" },
        ];
        next[1].items = [
            { id: "1", sequence: 1, song: "5001" },
            { id: "7", sequence: 2, song: "5002" },
        ];
        stubFetchRoutes(routes(next));
        await syncPlanHistory(db, () => after(DAY_MS));

        expect(songsOf("398")).toEqual([
            ["3", "5003", 1],
            ["2", "5002", 2],
        ]);
        expect(songsOf("399")).toEqual([
            ["1", "5001", 1],
            ["7", "5002", 2],
        ]);
    });

    describe("the 8-week window", () => {
        // 2026-10-04 less 56 days is 2026-08-09.
        function windowChurch(): FakePlan[] {
            return [
                { id: "10", serviceType: MORNING, date: "2026-08-09", items: [{ id: "1", sequence: 1, song: "5001" }] },
                { id: "11", serviceType: MORNING, date: "2026-08-08", items: [{ id: "1", sequence: 1, song: "5001" }] },
                { id: "12", serviceType: MORNING, date: "2027-06-06", items: [{ id: "1", sequence: 1, song: "5001" }] },
            ];
        }

        test("reads the plan 8 weeks back and every plan ahead, however far, but not the day before", async () => {
            stubPcoPacer();
            stubFetchRoutes(routes(windowChurch()));
            await syncPlanHistory(db, () => T0);

            const fetchMock = stubFetchRoutes(routes(windowChurch()));
            const counts = await syncPlanHistory(db, () => after(HOUR_MS));

            expect(itemRequests(fetchMock)).toEqual(["12", "10"]);
            expect(counts.read).toBe(2);
        });

        test("moves with the date: a plan read as recent is left alone once it is older than 8 weeks", async () => {
            stubPcoPacer();
            stubFetchRoutes(routes(windowChurch()));
            await syncPlanHistory(db, () => T0);

            // Two days later, 2026-08-09 is 58 days back.
            const fetchMock = stubFetchRoutes(routes(windowChurch()));
            await syncPlanHistory(db, () => after(2 * DAY_MS));

            expect(itemRequests(fetchMock)).toEqual(["12"]);
        });
    });

    describe("the weekly pass", () => {
        test("reads every plan again once a week has passed since its last reading, and not before", async () => {
            stubPcoPacer();
            stubFetchRoutes(routes(church()));
            await syncPlanHistory(db, () => T0);

            // Six days and 23 hours later: the older plans are not due.
            let fetchMock = stubFetchRoutes(routes(church()));
            await syncPlanHistory(db, () => after(7 * DAY_MS - HOUR_MS));
            expect(itemRequests(fetchMock)).not.toContain("200");
            expect(itemRequests(fetchMock)).not.toContain("100");

            // A week after their reading, they are.
            fetchMock = stubFetchRoutes(routes(church()));
            const counts = await syncPlanHistory(db, () => after(7 * DAY_MS));
            expect(itemRequests(fetchMock)).toEqual(["400", "399", "398", "397", "200", "100"]);
            expect(counts).toMatchObject({ read: 6, weekly: 2 });
        });

        test("catches a change made through the API to an old plan, which no updated_at shows", async () => {
            stubPcoPacer();
            stubFetchRoutes(routes(church()));
            await syncPlanHistory(db, () => T0);
            expect(songsOf("200")).toEqual([["1", "5004", 1]]);

            const next = church();
            next[4].items = [{ id: "1", sequence: 1, song: "5005" }];
            stubFetchRoutes(routes(next));
            await syncPlanHistory(db, () => after(DAY_MS));
            expect(songsOf("200")).toEqual([["1", "5004", 1]]);

            await syncPlanHistory(db, () => after(7 * DAY_MS));
            expect(songsOf("200")).toEqual([["1", "5005", 1]]);
        });

        test("spreads the pass: a plan read for another reason is not due until a week after that", async () => {
            stubPcoPacer();
            stubFetchRoutes(routes(church()));
            await syncPlanHistory(db, () => T0);

            // Plan 200 changes, so it is read on day 3; plan 100 is not.
            const changed = church();
            changed[4].updatedAt = "2026-10-06T00:00:00Z";
            stubFetchRoutes(routes(changed));
            await syncPlanHistory(db, () => after(3 * DAY_MS));

            const fetchMock = stubFetchRoutes(routes(changed));
            await syncPlanHistory(db, () => after(7 * DAY_MS));
            expect(itemRequests(fetchMock)).toContain("100");
            expect(itemRequests(fetchMock)).not.toContain("200");
        });
    });

    describe("plans that changed", () => {
        test("reads a plan the listing shows changed, whatever its age, and no other old plan", async () => {
            stubPcoPacer();
            stubFetchRoutes(routes(church()));
            await syncPlanHistory(db, () => T0);

            const next = church();
            next[4].updatedAt = "2026-10-05T09:00:00Z";
            next[4].items = [{ id: "1", sequence: 1, song: "5007" }];
            const fetchMock = stubFetchRoutes(routes(next));
            const counts = await syncPlanHistory(db, () => after(DAY_MS));

            expect(itemRequests(fetchMock)).toEqual(["400", "399", "398", "397", "200"]);
            expect(counts).toMatchObject({ added: 0, changed: 1, read: 5 });
            expect(songsOf("200")).toEqual([["1", "5007", 1]]);
            expect(listHistoryPlans(db).find((plan) => plan.planId === "200")).toMatchObject({
                updatedAt: "2026-10-05T09:00:00Z",
                itemsSyncedAt: after(DAY_MS).toISOString(),
            });
        });

        test("reads a plan whose date moved, and stores the new date with its songs", async () => {
            stubPcoPacer();
            stubFetchRoutes(routes(church()));
            await syncPlanHistory(db, () => T0);

            const next = church();
            next[4].date = "2026-03-08";
            stubFetchRoutes(routes(next));
            const counts = await syncPlanHistory(db, () => after(DAY_MS));

            expect(counts.changed).toBe(1);
            expect(db.prepare("SELECT plan_date FROM plan_occurrences WHERE plan_id = '200'").all()).toEqual([
                { plan_date: "2026-03-08" },
            ]);
        });

        test("reads a plan added since, and stores it with its songs", async () => {
            stubPcoPacer();
            stubFetchRoutes(routes(church()));
            await syncPlanHistory(db, () => T0);

            const next = church();
            next.push({
                id: "150",
                serviceType: EVENING,
                date: "2025-11-02",
                items: [{ id: "1", sequence: 1, song: "5008" }],
            });
            const fetchMock = stubFetchRoutes(routes(next));
            const counts = await syncPlanHistory(db, () => after(DAY_MS));

            expect(counts).toMatchObject({ plans: 7, added: 1, read: 5 });
            expect(itemRequests(fetchMock)).toContain("150");
            expect(songsOf("150")).toEqual([["1", "5008", 1]]);
        });
    });

    describe("a plan Planning Center no longer lists", () => {
        test("is dropped with its songs, and its items are not read", async () => {
            stubPcoPacer();
            stubFetchRoutes(routes(church()));
            await syncPlanHistory(db, () => T0);
            expect(songsOf("397")).toHaveLength(1);

            const remaining = church().filter((plan) => plan.id !== "397" && plan.id !== "100");
            const fetchMock = stubFetchRoutes(routes(remaining));
            const counts = await syncPlanHistory(db, () => after(DAY_MS));

            expect(counts).toMatchObject({ plans: 4, removed: 2, occurrences: 7 });
            expect(itemRequests(fetchMock)).toEqual(["400", "399", "398"]);
            expect(storedPlans().map(([id]) => id)).toEqual(["200", "398", "399", "400"]);
            expect(songsOf("397")).toEqual([]);
            expect(songsOf("100")).toEqual([]);
            expect(countHistory(db).occurrences).toBe(7);
        });

        test("is dropped when its items answer 404, though the listing still had it", async () => {
            stubPcoPacer();
            stubFetchRoutes(routes(church()));
            await syncPlanHistory(db, () => T0);

            const fetchMock = stubFetchRoutes(
                routes(church(), { [itemsUrl(MORNING, "398")]: () => json({ errors: [] }, { status: 404 }) })
            );
            const counts = await syncPlanHistory(db, () => after(DAY_MS));

            expect(counts).toMatchObject({ removed: 1, read: 3 });
            // The sync went on to the plans after it.
            expect(itemRequests(fetchMock)).toEqual(["400", "399", "398", "397"]);
            expect(storedPlans().map(([id]) => id)).not.toContain("398");
            expect(songsOf("398")).toEqual([]);
        });
    });

    describe("a sync that fails", () => {
        test("writes nothing when the listing cannot be read", async () => {
            stubPcoPacer();
            seedHistoryPlan(db, { planId: "100", planDate: "2025-05-04" });
            seedOccurrence(db, { planId: "100", pcoSongId: "5001" });
            const fetchMock = stubFetchRoutes(
                routes(church(), { [plansUrl(EVENING)]: () => json({ errors: [] }, { status: 500 }) })
            );

            await expect(syncPlanHistory(db, () => T0)).rejects.toMatchObject({ status: 500 });

            expect(itemRequests(fetchMock)).toEqual([]);
            expect(storedPlans().map(([id]) => id)).toEqual(["100"]);
            expect(countHistory(db).occurrences).toBe(1);
        });

        test("writes nothing when a listing that sent fewer plans than it counted could be mistaken for plans deleted", async () => {
            stubPcoPacer();
            seedHistoryPlan(db, { planId: "100", planDate: "2025-05-04" });
            stubFetchRoutes(
                routes(church(), {
                    [plansUrl(MORNING)]: listPage([planOf(church()[0])], { total: 5 }),
                })
            );

            await expect(syncPlanHistory(db, () => T0)).rejects.toThrow(/but sent 1/);
            expect(storedPlans().map(([id]) => id)).toEqual(["100"]);
        });

        test("writes nothing when the listing has no plans at all while the history has some", async () => {
            stubPcoPacer();
            seedHistoryPlan(db, { planId: "100", planDate: "2025-05-04" });
            seedOccurrence(db, { planId: "100", pcoSongId: "5001" });
            const fetchMock = stubFetchRoutes(routes([]));

            await expect(syncPlanHistory(db, () => T0)).rejects.toThrow(
                "Planning Center listed no plans, though the history has some; nothing was changed"
            );

            expect(itemRequests(fetchMock)).toEqual([]);
            expect(storedPlans().map(([id]) => id)).toEqual(["100"]);
            expect(countHistory(db).occurrences).toBe(1);
        });

        test("syncs an empty history with no plans, as a new organization's", async () => {
            stubPcoPacer();
            stubFetchRoutes(routes([]));
            await expect(syncPlanHistory(db, () => T0)).resolves.toEqual({
                plans: 0,
                added: 0,
                changed: 0,
                removed: 0,
                read: 0,
                weekly: 0,
                failed: 0,
                occurrences: 0,
                failures: [],
            });
        });

        /** Routes on which Planning Center answers 500 to the items of `plans`. */
        const failItems = (plans: FakePlan[]) =>
            Object.fromEntries(
                plans.map(({ serviceType, id }) => [
                    itemsUrl(serviceType, id),
                    () => json({ errors: [] }, { status: 500 }),
                ])
            );

        test("goes on past a plan whose read failed, leaves it unread and names it, and the next sync reads it again", async () => {
            stubPcoPacer();
            const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
            const plans = church();
            const failing = stubFetchRoutes(routes(plans, failItems(plans.filter(({ id }) => id === "200"))));

            const result = await syncPlanHistory(db, () => T0);

            // 200 failed, and 100, older than it, was read all the same.
            expect(itemRequests(failing)).toEqual(["400", "399", "398", "397", "200", "100"]);
            expect(result).toEqual({
                plans: 6,
                added: 6,
                changed: 0,
                removed: 0,
                read: 5,
                weekly: 0,
                failed: 1,
                occurrences: 8,
                failures: [{ planId: "200", message: expect.stringContaining("status: 500") }],
            });
            expect(consoleError).toHaveBeenCalledTimes(1);
            expect(storedPlans().map(([id, , , readAt]) => [id, readAt])).toEqual([
                ["100", T0.toISOString()],
                ["200", null],
                ["397", T0.toISOString()],
                ["398", T0.toISOString()],
                ["399", T0.toISOString()],
                ["400", T0.toISOString()],
            ]);
            expect(songsOf("200")).toEqual([]);

            // Unread, it is read again, with the recent plans; 100, read an hour ago, is not.
            const fetchMock = stubFetchRoutes(routes(plans));
            const next = await syncPlanHistory(db, () => after(HOUR_MS));

            expect(itemRequests(fetchMock)).toEqual(["400", "399", "398", "397", "200"]);
            expect(next).toMatchObject({ read: 5, failed: 0, failures: [], occurrences: 9 });
            expect(songsOf("200")).toHaveLength(1);
        });

        test("keeps what an earlier sync read of a plan whose read fails now", async () => {
            stubPcoPacer();
            vi.spyOn(console, "error").mockImplementation(() => {});
            const plans = church();
            stubFetchRoutes(routes(plans));
            await syncPlanHistory(db, () => T0);

            // 398 is recent, so it is read again, and fails.
            stubFetchRoutes(routes(plans, failItems(plans.filter(({ id }) => id === "398"))));
            const result = await syncPlanHistory(db, () => after(HOUR_MS));

            expect(result).toMatchObject({ read: 3, failed: 1, occurrences: 9 });
            expect(songsOf("398")).toHaveLength(3);
            expect(storedPlans().find(([id]) => id === "398")?.[3]).toBe(T0.toISOString());
        });

        test("fails when every plan it chose failed, after trying them all, and keeps what the listing found", async () => {
            stubPcoPacer();
            const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
            const plans = church();
            const fetchMock = stubFetchRoutes(routes(plans, failItems(plans)));

            await expect(syncPlanHistory(db, () => T0)).rejects.toThrow(
                /^Could not read the 6 plans that needed reading \(first: plan 400: .*status: 500/
            );

            expect(itemRequests(fetchMock)).toEqual(["400", "399", "398", "397", "200", "100"]);
            expect(consoleError).toHaveBeenCalledTimes(6);
            expect(storedPlans().map(([id, , , readAt]) => [id, readAt])).toEqual([
                ["100", null],
                ["200", null],
                ["397", null],
                ["398", null],
                ["399", null],
                ["400", null],
            ]);
            expect(countHistory(db).occurrences).toBe(0);
        });

        test("fails when the only plan it chose failed", async () => {
            stubPcoPacer();
            vi.spyOn(console, "error").mockImplementation(() => {});
            const plans = church().slice(0, 1);
            stubFetchRoutes(routes(plans, failItems(plans)));

            await expect(syncPlanHistory(db, () => T0)).rejects.toThrow(
                /^Could not read the 1 plan that needed reading \(plan 400: .*status: 500/
            );
        });

        test("does not count a plan found deleted as failed, so the sync does not fail when the only other plan it chose did", async () => {
            stubPcoPacer();
            vi.spyOn(console, "error").mockImplementation(() => {});
            const plans = church().slice(0, 2);
            stubFetchRoutes(
                routes(plans, {
                    ...failItems(plans.filter(({ id }) => id === "399")),
                    [itemsUrl(MORNING, "400")]: () => json({ errors: [] }, { status: 404 }),
                })
            );

            await expect(syncPlanHistory(db, () => T0)).resolves.toMatchObject({
                read: 0,
                removed: 1,
                failed: 1,
                failures: [{ planId: "399" }],
            });
            expect(storedPlans().map(([id]) => id)).toEqual(["399"]);
        });

        test("stops at a 429 the pacer gave up on, since the plans after it would be refused too, keeping what it read before", async () => {
            stubPcoPacer();
            vi.spyOn(console, "error").mockImplementation(() => {});
            const fetchMock = stubFetchRoutes(
                routes(church(), {
                    // Longer than a paced request waits, so the client gives up on it at once.
                    [itemsUrl(MORNING, "398")]: () =>
                        json({ errors: [] }, { status: 429, headers: { "Retry-After": "120" } }),
                })
            );

            await expect(syncPlanHistory(db, () => T0)).rejects.toMatchObject({ status: 429 });

            expect(itemRequests(fetchMock)).toEqual(["400", "399", "398"]);
            expect(storedPlans().map(([id, , , readAt]) => [id, readAt])).toEqual([
                ["100", null],
                ["200", null],
                ["397", null],
                ["398", null],
                ["399", T0.toISOString()],
                ["400", T0.toISOString()],
            ]);
        });

        test("stops at a failed write to the database, which is not a plan's failure", async () => {
            stubPcoPacer();
            const fetchMock = stubFetchRoutes(routes(church()));
            db.exec("CREATE TRIGGER no_songs BEFORE INSERT ON plan_occurrences BEGIN SELECT RAISE(ABORT, 'disk is full'); END");

            await expect(syncPlanHistory(db, () => T0)).rejects.toThrow("disk is full");

            expect(itemRequests(fetchMock)).toEqual(["400"]);
        });
    });

    describe("plans without a date", () => {
        test("have no history: they are not stored, and their items are not read", async () => {
            stubPcoPacer();
            const plans = church();
            const fetchMock = stubFetchRoutes({
                ...routes(plans),
                [plansUrl(MORNING)]: listPage([
                    ...plans.filter((plan) => plan.serviceType === MORNING).map(planOf),
                    planResource({ id: "999" }, { sort_date: null as unknown as string }),
                ]),
            });

            const counts = await syncPlanHistory(db, () => T0);

            expect(counts.plans).toBe(6);
            expect(storedPlans().map(([id]) => id)).not.toContain("999");
            expect(calledUrls(fetchMock).some((url) => url.includes("/999/"))).toBe(false);
        });
    });
});

describe("describePlanHistorySync", () => {
    const counts: PlanHistorySyncCounts = {
        plans: 216,
        added: 0,
        changed: 0,
        removed: 0,
        read: 21,
        weekly: 0,
        failed: 0,
        occurrences: 1386,
    };

    test("says how many plans and song items there are and how many plans it read", () => {
        expect(describePlanHistorySync(counts)).toBe("Synced 216 plans (1386 song items): read 21 plans");
    });

    test("adds what was added, changed and removed, and how many plans the weekly pass read", () => {
        expect(
            describePlanHistorySync({ ...counts, added: 2, changed: 1, removed: 3, weekly: 4 })
        ).toBe(
            "Synced 216 plans (1386 song items): read 21 plans (4 in the weekly pass), 2 added, 1 changed, 3 removed"
        );
    });

    test("uses the singular, and says when nothing needed reading", () => {
        expect(describePlanHistorySync({ ...counts, plans: 1, read: 1, occurrences: 1 })).toBe(
            "Synced 1 plan (1 song item): read 1 plan"
        );
        expect(describePlanHistorySync({ ...counts, plans: 0, read: 0, occurrences: 0 })).toBe(
            "Synced 0 plans (0 song items): nothing needed reading"
        );
    });

    test("says how many plans failed, last, and names the first with its message", () => {
        const failure = { planId: "398", message: "Planning Center API responded with status: 500" };
        expect(describePlanHistorySync({ ...counts, removed: 1, failed: 1 }, [failure])).toBe(
            "Synced 216 plans (1386 song items): read 21 plans, 1 removed, 1 failed (plan 398: Planning Center API responded with status: 500)"
        );
        expect(
            describePlanHistorySync({ ...counts, failed: 2 }, [failure, { planId: "397", message: "timed out" }])
        ).toBe(
            "Synced 216 plans (1386 song items): read 21 plans, 2 failed (first: plan 398: Planning Center API responded with status: 500)"
        );
        expect(describePlanHistorySync({ ...counts, failed: 2 })).toBe(
            "Synced 216 plans (1386 song items): read 21 plans, 2 failed"
        );
    });

    test("does not say that nothing needed reading when the plans that did all failed or were deleted", () => {
        expect(describePlanHistorySync({ ...counts, read: 0, removed: 1, failed: 1 })).toBe(
            "Synced 216 plans (1386 song items): read 0 plans, 1 removed, 1 failed"
        );
    });
});
