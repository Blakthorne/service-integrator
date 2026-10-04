import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
    openTestDb,
    seedBook,
    seedEntry,
    seedHymn,
    seedPcoSong,
    seedSong,
    seedTune,
} from "@/lib/db/testing";
import {
    PCO_BASE,
    calledUrls,
    itemResource,
    json,
    listPage,
    planResource,
    serviceTypeResource,
    songResource,
    stubFetchRoutes,
    stubPcoCredentials,
} from "@/lib/pco/testing";

// vi.hoisted: vi.mock factories run before the module's own declarations.
const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/lib/db", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/db")>()),
    getDb,
}));

/** A fresh copy of the module, so the plan-label cache starts empty. */
async function loadQueries() {
    vi.resetModules();
    return import("./plans");
}

const MORNING = "1405391";
const EVENING = "1486055";
const PLAN = "81234567";

const urls = {
    serviceTypes: `${PCO_BASE}/service_types?per_page=100`,
    plans: (st: string) =>
        `${PCO_BASE}/service_types/${st}/plans?order=-sort_date&per_page=100`,
    plan: `${PCO_BASE}/service_types/${MORNING}/plans/${PLAN}`,
    serviceType: `${PCO_BASE}/service_types/${MORNING}`,
    items: `${PCO_BASE}/service_types/${MORNING}/plans/${PLAN}/items?include=song,item_notes&per_page=100`,
};

const songLink = (id: string) => ({ song: { data: { type: "Song" as const, id } } });

/** The three PCO responses behind a plan's detail view. */
function planDetailRoutes(): Record<string, unknown> {
    return {
        [urls.plan]: { data: planResource({ id: PLAN }, { dates: "October 4, 2026" }) },
        [urls.serviceType]: {
            data: serviceTypeResource({ name: "Sunday Morning" }, MORNING),
        },
        [urls.items]: listPage(
            [
                itemResource("3", { title: "Abide with Me", sequence: 3 }, songLink("30")),
                itemResource("1", { title: "Amazing Grace", item_type: "header", sequence: 1 }),
                itemResource("2", { title: "Come, Thou Fount of Every Blessing", sequence: 2 }, songLink("20")),
                itemResource("4", { title: "A Song Not In The Hymnbooks", sequence: 4 }, songLink("40")),
            ],
            {
                included: [
                    songResource("20", { title: "Come, Thou Fount of Every Blessing" }),
                    songResource("30", { title: "Abide with Me" }),
                    songResource("40", { title: "A Song Not In The Hymnbooks" }),
                ],
            }
        ),
    };
}

let db: DatabaseSync;

beforeEach(() => {
    stubPcoCredentials();
    db = openTestDb();
    getDb.mockReturnValue(db);
});

afterEach(() => {
    db.close();
    getDb.mockReset();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

describe("getPlansByDate", () => {
    test("groups every service type's plans by date, newest date first", async () => {
        stubFetchRoutes({
            [urls.serviceTypes]: listPage([
                serviceTypeResource({ name: "Sunday Morning" }, MORNING),
                serviceTypeResource({ name: "Sunday Evening" }, EVENING),
            ]),
            [urls.plans(MORNING)]: listPage([
                planResource({ id: "11" }, { sort_date: "2026-10-04T08:00:00Z" }),
                planResource({ id: "10" }, { sort_date: "2026-09-27T08:00:00Z" }),
            ]),
            [urls.plans(EVENING)]: listPage([
                planResource({ id: "21" }, { sort_date: "2026-10-04T18:00:00Z" }),
            ]),
        });
        const { getPlansByDate } = await loadQueries();

        const { dates, plansByDate, failedServiceTypeIds } = await getPlansByDate();

        expect(dates).toEqual(["2026-10-04", "2026-09-27"]);
        expect(
            Object.fromEntries(
                Object.entries(plansByDate).map(([date, plans]) => [
                    date,
                    plans.map((plan) => `${plan.serviceType.name} ${plan.id}`),
                ])
            )
        ).toEqual({
            // The evening service sorts first on its date (later sort_date).
            "2026-10-04": ["Sunday Evening 21", "Sunday Morning 11"],
            "2026-09-27": ["Sunday Morning 10"],
        });
        expect(failedServiceTypeIds).toEqual([]);
    });

    test("passes on the service types whose plans failed", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        stubFetchRoutes({
            [urls.serviceTypes]: listPage([
                serviceTypeResource({ name: "Sunday Morning" }, MORNING),
                serviceTypeResource({ name: "Sunday Evening" }, EVENING),
            ]),
            [urls.plans(MORNING)]: listPage([
                planResource({ id: "11" }, { sort_date: "2026-10-04T08:00:00Z" }),
            ]),
            [urls.plans(EVENING)]: () => json({}, { status: 500 }),
        });
        const { getPlansByDate } = await loadQueries();

        const result = await getPlansByDate();

        expect(result.failedServiceTypeIds).toEqual([EVENING]);
        expect(result.dates).toEqual(["2026-10-04"]);
    });
});

describe("getPlanDetail", () => {
    test("loads the plan, its service type and its items", async () => {
        const fetchMock = stubFetchRoutes(planDetailRoutes());
        const { getPlanDetail } = await loadQueries();

        const { plan, serviceType, items } = await getPlanDetail(MORNING, PLAN);

        expect(calledUrls(fetchMock).sort()).toEqual(
            [urls.plan, urls.serviceType, urls.items].sort()
        );
        expect(plan).toMatchObject({ id: PLAN, serviceTypeId: MORNING, dates: "October 4, 2026" });
        expect(serviceType).toMatchObject({ id: MORNING, name: "Sunday Morning" });
        expect(items.map((item) => [item.id, item.song?.id ?? null])).toEqual([
            ["1", null],
            ["2", "20"],
            ["3", "30"],
            ["4", "40"],
        ]);
    });

    test("finds no catalog links in an empty catalog, and nothing to suggest", async () => {
        stubFetchRoutes(planDetailRoutes());
        const { getPlanDetail } = await loadQueries();

        const { catalog, suggestions, catalogError } = await getPlanDetail(MORNING, PLAN);

        expect(catalog).toEqual({});
        expect(suggestions).toEqual({ "20": [], "30": [], "40": [] });
        expect(catalogError).toBeNull();
    });

    test("lets a missing plan's PcoError through, for orNotFound to handle", async () => {
        stubFetchRoutes({
            ...planDetailRoutes(),
            [urls.plan]: () => json({ errors: [] }, { status: 404 }),
        });
        const { getPlanDetail } = await loadQueries();

        await expect(getPlanDetail(MORNING, PLAN)).rejects.toMatchObject({
            name: "PcoError",
            status: 404,
        });
    });
});

describe("getPlanDetail's catalog links", () => {
    /** Plan routes whose items are these, with these songs included. */
    function routesWith(
        items: ReturnType<typeof itemResource>[],
        included: ReturnType<typeof songResource>[]
    ): Record<string, unknown> {
        return { ...planDetailRoutes(), [urls.items]: listPage(items, { included }) };
    }

    /**
     * Come, Thou Fount to two tunes, and Abide with Me linked to Planning
     * Center song 30, at R-517 and G-64.
     */
    function seedCatalog() {
        const rejoice = seedBook(db, { code: "R", name: "Rejoice Hymns" });
        const great = seedBook(db, { code: "G", name: "Great Hymns of the Faith" });
        const fount = seedHymn(db, { title: "Come, Thou Fount of Every Blessing" });
        const songs = {
            nettleton: seedSong(db, { hymnId: fount, tuneId: seedTune(db, { name: "NETTLETON" }) }),
            warrenton: seedSong(db, { hymnId: fount, tuneId: seedTune(db, { name: "WARRENTON" }) }),
            abide: seedSong(db, {
                hymnId: seedHymn(db, { title: "Abide with Me" }),
                tuneId: seedTune(db, { name: "EVENTIDE" }),
                pcoSongId: "30",
                linkedAt: "2026-10-01T12:00:00.000Z",
                linkedBy: "manual",
            }),
        };
        seedEntry(db, { bookId: great, songId: songs.abide, number: 64 });
        seedEntry(db, { bookId: rejoice, songId: songs.abide, number: 517 });
        seedEntry(db, { bookId: rejoice, songId: songs.nettleton, number: 553 });
        seedEntry(db, { bookId: great, songId: songs.nettleton, number: 17 });
        seedEntry(db, { bookId: rejoice, songId: songs.warrenton, number: 554 });
        seedPcoSong(db, { id: "30", title: "Abide with Me" });
        return songs;
    }

    test("gives each linked song its catalog song, and the others their best suggestions", async () => {
        const songs = seedCatalog();
        stubFetchRoutes(planDetailRoutes());
        const { getPlanDetail } = await loadQueries();

        const { catalog, suggestions } = await getPlanDetail(MORNING, PLAN);

        expect(catalog).toEqual({
            "30": {
                songId: songs.abide,
                title: "Abide with Me",
                tuneName: "EVENTIDE",
                entries: [
                    expect.objectContaining({ label: "R-517" }),
                    expect.objectContaining({ label: "G-64" }),
                ],
            },
        });
        expect(Object.keys(suggestions).sort()).toEqual(["20", "40"]);
        expect(
            suggestions["20"].map(({ songId, tuneName, reason, entries }) => [
                songId,
                tuneName,
                reason,
                entries.map(({ label }) => label),
            ])
        ).toEqual([
            [songs.nettleton, "NETTLETON", "exact", ["R-553", "G-17"]],
            [songs.warrenton, "WARRENTON", "exact", ["R-554"]],
        ]);
        expect(suggestions["40"]).toEqual([]);
    });

    test("follows the link and the song's title, not the item's", async () => {
        const songs = seedCatalog();
        stubFetchRoutes(
            routesWith(
                [
                    itemResource("2", { title: "Come Thou Fount (Key of D)", sequence: 1 }, songLink("20")),
                    itemResource("3", { title: "Abide with Me (Acoustic)", sequence: 2 }, songLink("30")),
                    itemResource("5", { title: "Abide with Me, Reprise", sequence: 3 }, songLink("30")),
                ],
                [
                    songResource("20", { title: "Come, Thou Fount of Every Blessing" }),
                    songResource("30", { title: "Abide with Me" }),
                ]
            )
        );
        const { getPlanDetail } = await loadQueries();

        const { catalog, suggestions } = await getPlanDetail(MORNING, PLAN);

        expect(Object.keys(catalog)).toEqual(["30"]);
        expect(catalog["30"].songId).toBe(songs.abide);
        expect(suggestions["20"].map(({ songId }) => songId)).toEqual([
            songs.nettleton,
            songs.warrenton,
        ]);
    });

    test("suggests by the mirror's title when Planning Center sent an item without its song", async () => {
        const songs = seedCatalog();
        seedPcoSong(db, { id: "20", title: "Come, Thou Fount of Every Blessing" });
        stubFetchRoutes(
            routesWith(
                [itemResource("2", { title: "Come Thou Fount (Key of D)" }, songLink("20"))],
                []
            )
        );
        const { getPlanDetail } = await loadQueries();

        const { suggestions } = await getPlanDetail(MORNING, PLAN);

        expect(suggestions["20"].map(({ songId }) => songId)).toEqual([
            songs.nettleton,
            songs.warrenton,
        ]);
    });

    test("suggests nothing for a song set aside as not hymnal material", async () => {
        seedCatalog();
        seedPcoSong(db, {
            id: "40",
            title: "A Song Not In The Hymnbooks",
            ignoredAt: "2026-10-02T12:00:00.000Z",
        });
        stubFetchRoutes(planDetailRoutes());
        const { getPlanDetail } = await loadQueries();

        const { suggestions } = await getPlanDetail(MORNING, PLAN);

        expect(Object.keys(suggestions)).toEqual(["20"]);
    });

    test("asks the database a fixed number of queries, however many songs the plan has", async () => {
        seedCatalog();
        const prepare = vi.spyOn(db, "prepare");
        const { getPlanDetail } = await loadQueries();
        const songItem = (id: string, songId: string, title: string) =>
            itemResource(id, { title, sequence: Number(id) }, songLink(songId));

        stubFetchRoutes(
            routesWith(
                [songItem("1", "20", "Come, Thou Fount of Every Blessing"), songItem("2", "30", "Abide with Me")],
                [songResource("20", { title: "Come, Thou Fount of Every Blessing" })]
            )
        );
        await getPlanDetail(MORNING, PLAN);
        const fewSongs = prepare.mock.calls.length;
        expect(fewSongs).toBe(7);

        prepare.mockClear();
        stubFetchRoutes(
            routesWith(
                Array.from({ length: 12 }, (_, i) =>
                    songItem(String(i + 1), String(100 + i), `Song ${i}`)
                ),
                []
            )
        );
        await getPlanDetail(MORNING, PLAN);
        expect(prepare.mock.calls.length).toBe(fewSongs);

        // Every song linked: no suggestions to find.
        prepare.mockClear();
        stubFetchRoutes(routesWith([songItem("1", "30", "Abide with Me")], []));
        await getPlanDetail(MORNING, PLAN);
        expect(prepare.mock.calls.length).toBe(2);

        // No song items: nothing to ask.
        prepare.mockClear();
        stubFetchRoutes(
            routesWith([itemResource("1", { title: "Welcome", item_type: "header" })], [])
        );
        await getPlanDetail(MORNING, PLAN);
        expect(prepare).not.toHaveBeenCalled();
    });

    // It used to fail the whole plan page, the Copyright tab included.
    test("keeps the plan when the database cannot be opened: no links, and why", async () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        const cause = new Error("Could not open the database at /srv/data/x: denied");
        getDb.mockImplementation(() => {
            throw cause;
        });
        stubFetchRoutes(planDetailRoutes());
        const { getPlanDetail } = await loadQueries();

        const detail = await getPlanDetail(MORNING, PLAN);

        expect(detail.plan).toMatchObject({ id: PLAN });
        expect(detail.items.map((item) => item.id)).toEqual(["1", "2", "3", "4"]);
        expect(detail.catalog).toEqual({});
        expect(detail.suggestions).toEqual({});
        expect(detail.catalogError).toBe("Could not open the database at /srv/data/x: denied");
        expect(consoleError).toHaveBeenCalledWith(
            `Failed to read the catalog links of plan ${MORNING}/${PLAN}:`,
            cause
        );
    });

    test("keeps the plan the same way when a query fails", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        const closed = openTestDb();
        closed.close();
        getDb.mockReturnValue(closed);
        stubFetchRoutes(planDetailRoutes());
        const { getPlanDetail } = await loadQueries();

        const { catalog, suggestions, catalogError } = await getPlanDetail(MORNING, PLAN);

        expect(catalog).toEqual({});
        expect(suggestions).toEqual({});
        expect(catalogError).toMatch(/not open/i);
    });

    test("does not open the database for a plan whose items schedule no Planning Center song", async () => {
        getDb.mockImplementation(() => {
            throw new Error("Could not open the database at /srv/data/x: denied");
        });
        stubFetchRoutes(
            routesWith(
                [
                    itemResource("1", { title: "Welcome", item_type: "header" }),
                    itemResource("2", { title: "A song with no song", sequence: 2 }),
                ],
                []
            )
        );
        const { getPlanDetail } = await loadQueries();

        const { catalog, suggestions, catalogError } = await getPlanDetail(MORNING, PLAN);

        expect(getDb).not.toHaveBeenCalled();
        expect(catalog).toEqual({});
        expect(suggestions).toEqual({});
        expect(catalogError).toBeNull();
    });
});

describe("getPlanLabels", () => {
    test("labels the plan with its dates and service type, and each item with its title", async () => {
        stubFetchRoutes(planDetailRoutes());
        const { getPlanLabels } = await loadQueries();

        await expect(getPlanLabels(MORNING, PLAN)).resolves.toEqual({
            plan: "October 4, 2026 · Sunday Morning",
            items: {
                "1": "Amazing Grace",
                "2": "Come, Thou Fount of Every Blessing",
                "3": "Abide with Me",
                "4": "A Song Not In The Hymnbooks",
            },
        });
    });

    test("serves repeat calls from a 5-minute cache", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date("2026-10-03T12:00:00Z"));
        const fetchMock = stubFetchRoutes(planDetailRoutes());
        const { getPlanLabels } = await loadQueries();

        const first = await getPlanLabels(MORNING, PLAN);
        expect(fetchMock).toHaveBeenCalledTimes(3);

        vi.setSystemTime(new Date("2026-10-03T12:04:59Z"));
        await expect(getPlanLabels(MORNING, PLAN)).resolves.toEqual(first);
        expect(fetchMock).toHaveBeenCalledTimes(3);

        vi.setSystemTime(new Date("2026-10-03T12:05:00Z"));
        await getPlanLabels(MORNING, PLAN);
        expect(fetchMock).toHaveBeenCalledTimes(6);
    });

    test("never throws: logs the error and returns a fallback label", async () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        stubFetchRoutes({
            ...planDetailRoutes(),
            [urls.items]: () => json({ errors: [] }, { status: 500 }),
        });
        const { getPlanLabels } = await loadQueries();

        await expect(getPlanLabels(MORNING, PLAN)).resolves.toEqual({
            plan: "Plan",
            items: {},
        });
        expect(consoleError).toHaveBeenCalledWith(
            expect.stringContaining(PLAN),
            expect.objectContaining({ name: "PcoError", status: 500 })
        );
    });

    test("does not need the database", async () => {
        getDb.mockImplementation(() => {
            throw new Error("Could not open the database at /srv/data/x: denied");
        });
        stubFetchRoutes(planDetailRoutes());
        const { getPlanLabels } = await loadQueries();

        await expect(getPlanLabels(MORNING, PLAN)).resolves.toMatchObject({
            plan: "October 4, 2026 · Sunday Morning",
        });
        expect(getDb).not.toHaveBeenCalled();
    });

    test("falls back on any error, even missing credentials", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        vi.stubEnv("PLANNING_CENTER_TOKEN", "");
        stubFetchRoutes(planDetailRoutes());
        const { getPlanLabels } = await loadQueries();

        await expect(getPlanLabels(MORNING, PLAN)).resolves.toEqual({
            plan: "Plan",
            items: {},
        });
    });

    test("does not cache a failure", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        let itemsStatus = 500;
        stubFetchRoutes({
            ...planDetailRoutes(),
            [urls.items]: () =>
                itemsStatus === 500
                    ? json({}, { status: 500 })
                    : json(listPage([itemResource("1", { title: "Welcome", item_type: "header" })])),
        });
        const { getPlanLabels } = await loadQueries();

        await expect(getPlanLabels(MORNING, PLAN)).resolves.toMatchObject({ plan: "Plan" });
        itemsStatus = 200;
        await expect(getPlanLabels(MORNING, PLAN)).resolves.toEqual({
            plan: "October 4, 2026 · Sunday Morning",
            items: { "1": "Welcome" },
        });
    });

    test.each([
        ["service type", "abc", PLAN],
        ["plan", MORNING, "../../people"],
    ])("returns the fallback for an invalid %s ID without calling PCO", async (_which, st, plan) => {
        const fetchMock = stubFetchRoutes({});
        const { getPlanLabels } = await loadQueries();

        await expect(getPlanLabels(st, plan)).resolves.toEqual({ plan: "Plan", items: {} });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    test("each call gets its own fallback object", async () => {
        const { getPlanLabels } = await loadQueries();
        const first = await getPlanLabels("x", "y");
        first.items.mutated = "oops";
        await expect(getPlanLabels("x", "y")).resolves.toEqual({ plan: "Plan", items: {} });
    });
});
