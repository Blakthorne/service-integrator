import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
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
    items: `${PCO_BASE}/service_types/${MORNING}/plans/${PLAN}/items?include=song&per_page=100`,
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

beforeEach(stubPcoCredentials);

afterEach(() => {
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
    test("loads the plan, its service type and its items, and matches the songs to hymns", async () => {
        const fetchMock = stubFetchRoutes(planDetailRoutes());
        const { getPlanDetail } = await loadQueries();

        const { plan, serviceType, items, hymns } = await getPlanDetail(MORNING, PLAN);

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
        // Song items only (the "Amazing Grace" header is skipped), in sequence
        // order; titles missing from the hymnbooks are left out.
        expect(hymns.map((hymn) => hymn.song_title)).toEqual([
            "Come, Thou Fount of Every Blessing",
            "Abide with Me",
        ]);
        expect(hymns[0].versions.map((version) => version.tune_name)).toEqual([
            "NETTLETON",
            "WARRENTON",
        ]);
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

describe("getPlanLabels", () => {
    test("labels the plan with its service type and dates, and each item with its title", async () => {
        stubFetchRoutes(planDetailRoutes());
        const { getPlanLabels } = await loadQueries();

        await expect(getPlanLabels(MORNING, PLAN)).resolves.toEqual({
            plan: "Sunday Morning · October 4, 2026",
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
            plan: "Sunday Morning · October 4, 2026",
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
