import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { PcoError } from "./client";
import { InvalidPcoIdError } from "./ids";
import {
    fetchAllPlans,
    fetchUpcomingPlans,
    getAllPlans,
    getNextPlan,
    getPlan,
    getPlansForServiceType,
    getUpcomingPlans,
} from "./plans";
import {
    PCO_BASE,
    calledUrls,
    json,
    listPage,
    planResource,
    serviceTypeResource,
    stubFetchRoutes,
    stubPcoCredentials,
    stubPcoPacer,
} from "./testing";

beforeEach(stubPcoCredentials);

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

const MORNING = "1405391";
const EVENING = "1486055";
const plansUrl = (serviceTypeId: string) =>
    `${PCO_BASE}/service_types/${serviceTypeId}/plans?order=-sort_date&per_page=100`;

const morningPlan = planResource(
    { id: "101" },
    { sort_date: "2026-10-04T08:00:00Z", dates: "October 4, 2026" }
);
const olderMorningPlan = planResource(
    { id: "100" },
    { sort_date: "2026-09-27T08:00:00Z", dates: "September 27, 2026" }
);
const eveningPlan = planResource(
    { id: "201" },
    { sort_date: "2026-10-04T18:00:00Z", dates: "October 4, 2026" }
);

describe("fetchAllPlans", () => {
    const SERVICE_TYPES = `${PCO_BASE}/service_types?per_page=100`;
    const ARCHIVED = "999";

    function serviceTypes() {
        return listPage([
            serviceTypeResource({ name: "Sunday Morning" }, MORNING),
            serviceTypeResource({ name: "Sunday Evening", sequence: 2 }, EVENING),
            serviceTypeResource({ name: "Old Midweek", archived_at: "2023-01-01T00:00:00Z" }, ARCHIVED),
        ]);
    }

    test("lists the plans of every service type, archived ones too, each request paced", async () => {
        const acquire = vi.spyOn(stubPcoPacer(), "acquire");
        const fetchMock = stubFetchRoutes({
            [SERVICE_TYPES]: serviceTypes(),
            [plansUrl(MORNING)]: listPage([morningPlan, olderMorningPlan]),
            [plansUrl(EVENING)]: listPage([eveningPlan]),
            [plansUrl(ARCHIVED)]: listPage([]),
        });

        const plans = await fetchAllPlans({ paced: true });

        expect(calledUrls(fetchMock)).toEqual([
            SERVICE_TYPES,
            plansUrl(MORNING),
            plansUrl(EVENING),
            plansUrl(ARCHIVED),
        ]);
        expect(acquire).toHaveBeenCalledTimes(4);
        expect(plans.map((plan) => [plan.id, plan.serviceTypeId, plan.sortDate])).toEqual([
            ["101", MORNING, "2026-10-04T08:00:00Z"],
            ["100", MORNING, "2026-09-27T08:00:00Z"],
            ["201", EVENING, "2026-10-04T18:00:00Z"],
        ]);
        expect(plans[0].updatedAt).toBe("2026-10-02T15:00:00Z");
    });

    test("is unpaced unless asked, and follows links.next", async () => {
        const acquire = vi.spyOn(stubPcoPacer(), "acquire");
        const second = `${PCO_BASE}/service_types/${MORNING}/plans?offset=100&order=-sort_date&per_page=100`;
        const fetchMock = stubFetchRoutes({
            [SERVICE_TYPES]: listPage([serviceTypeResource({}, MORNING)]),
            [plansUrl(MORNING)]: listPage([morningPlan], { next: second, total: 2 }),
            [second]: listPage([olderMorningPlan], { total: 2 }),
        });

        const plans = await fetchAllPlans();

        expect(plans.map((plan) => plan.id)).toEqual(["101", "100"]);
        expect(calledUrls(fetchMock)).toEqual([SERVICE_TYPES, plansUrl(MORNING), second]);
        expect(acquire).not.toHaveBeenCalled();
    });

    test("gives a plan sent twice once", async () => {
        stubFetchRoutes({
            [SERVICE_TYPES]: listPage([serviceTypeResource({}, MORNING)]),
            [plansUrl(MORNING)]: listPage([morningPlan, olderMorningPlan, morningPlan], { total: 2 }),
        });
        expect((await fetchAllPlans()).map((plan) => plan.id)).toEqual(["101", "100"]);
    });

    test("throws rather than give part of a listing when a type sent fewer plans than it listed", async () => {
        stubFetchRoutes({
            [SERVICE_TYPES]: listPage([serviceTypeResource({}, MORNING)]),
            [plansUrl(MORNING)]: listPage([morningPlan], { total: 2 }),
        });
        await expect(fetchAllPlans()).rejects.toThrow(
            `Planning Center listed 2 plans for service type ${MORNING} but sent 1: the plans changed while they were read`
        );
    });

    test("throws when the service types cannot be read, or one type's plans cannot", async () => {
        stubFetchRoutes({ [SERVICE_TYPES]: () => json({ errors: [] }, { status: 500 }) });
        await expect(fetchAllPlans()).rejects.toBeInstanceOf(PcoError);

        stubFetchRoutes({
            [SERVICE_TYPES]: serviceTypes(),
            [plansUrl(MORNING)]: listPage([morningPlan]),
            [plansUrl(EVENING)]: () => json({ errors: [] }, { status: 403 }),
        });
        await expect(fetchAllPlans()).rejects.toMatchObject({ status: 403 });
    });
});

describe("getPlansForServiceType", () => {
    test("requests the type's plans newest first, 100 per page, and maps them", async () => {
        const fetchMock = stubFetchRoutes({
            [plansUrl(MORNING)]: listPage([morningPlan, olderMorningPlan]),
        });

        const plans = await getPlansForServiceType(MORNING);

        expect(calledUrls(fetchMock)).toEqual([plansUrl(MORNING)]);
        expect(plans.map((plan) => [plan.id, plan.serviceTypeId, plan.dates])).toEqual([
            ["101", MORNING, "October 4, 2026"],
            ["100", MORNING, "September 27, 2026"],
        ]);
        expect(plans[0].planningCenterUrl).toBe(
            "https://services.planningcenteronline.com/plans/101"
        );
    });

    test("follows links.next to return all of a type's plans, not just the newest 100", async () => {
        // The spike found 121 Sunday Morning plans: 100 on page 1, 21 on page 2.
        const plan = (n: number) =>
            planResource({ id: String(1000 + n) }, { sort_date: `2026-01-01T08:00:${String(n % 60).padStart(2, "0")}Z` });
        const nextUrl = `${PCO_BASE}/service_types/${MORNING}/plans?offset=100&order=-sort_date&per_page=100`;
        const fetchMock = stubFetchRoutes({
            [plansUrl(MORNING)]: listPage(
                Array.from({ length: 100 }, (_, i) => plan(i)),
                { next: nextUrl, total: 121 }
            ),
            [nextUrl]: listPage(
                Array.from({ length: 21 }, (_, i) => plan(100 + i)),
                { total: 121 }
            ),
        });

        const plans = await getPlansForServiceType(MORNING);

        expect(calledUrls(fetchMock)).toEqual([plansUrl(MORNING), nextUrl]);
        expect(plans).toHaveLength(121);
        // API order (newest first) is kept across pages.
        expect(plans.map((p) => p.id)).toEqual(
            Array.from({ length: 121 }, (_, i) => String(1000 + i))
        );
    });

    test("gives up with an error after 20 pages rather than return a partial list", async () => {
        const fetchMock = vi.fn().mockImplementation(async (url: string) => {
            const offset = Number(new URL(url).searchParams.get("offset") ?? 0);
            return json(
                listPage([planResource({ id: String(offset + 1) })], {
                    next: `${PCO_BASE}/service_types/${MORNING}/plans?offset=${offset + 1}&order=-sort_date&per_page=100`,
                })
            );
        });
        vi.stubGlobal("fetch", fetchMock);

        await expect(getPlansForServiceType(MORNING)).rejects.toThrow(
            /more than 20 pages/
        );
        expect(fetchMock).toHaveBeenCalledTimes(20);
    });

    test("rejects an invalid service type ID before any fetch", async () => {
        const fetchMock = stubFetchRoutes({});
        await expect(
            getPlansForServiceType("../../../people/v2/people%3F")
        ).rejects.toBeInstanceOf(InvalidPcoIdError);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe("getAllPlans", () => {
    const serviceTypesUrl = `${PCO_BASE}/service_types?per_page=100`;
    const serviceTypes = listPage([
        serviceTypeResource({ name: "Sunday Morning" }, MORNING),
        serviceTypeResource({ name: "Sunday Evening" }, EVENING),
    ]);

    test("returns every type's plans in service-type order, each with its type's name", async () => {
        stubFetchRoutes({
            [serviceTypesUrl]: serviceTypes,
            [plansUrl(MORNING)]: listPage([morningPlan, olderMorningPlan]),
            [plansUrl(EVENING)]: listPage([eveningPlan]),
        });

        const { plans, failedServiceTypeIds } = await getAllPlans();

        expect(failedServiceTypeIds).toEqual([]);
        expect(
            plans.map((plan) => [plan.id, plan.serviceTypeId, plan.serviceType])
        ).toEqual([
            ["101", MORNING, { id: MORNING, name: "Sunday Morning" }],
            ["100", MORNING, { id: MORNING, name: "Sunday Morning" }],
            ["201", EVENING, { id: EVENING, name: "Sunday Evening" }],
        ]);
    });

    test("skips a service type whose plans fail and reports it", async () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        stubFetchRoutes({
            [serviceTypesUrl]: serviceTypes,
            [plansUrl(MORNING)]: () => json({ errors: [] }, { status: 500 }),
            [plansUrl(EVENING)]: listPage([eveningPlan]),
        });

        const { plans, failedServiceTypeIds } = await getAllPlans();

        expect(failedServiceTypeIds).toEqual([MORNING]);
        expect(plans.map((plan) => plan.id)).toEqual(["201"]);
        expect(consoleError).toHaveBeenCalledWith(
            expect.stringContaining(MORNING),
            expect.any(PcoError)
        );
    });

    test("reports every type when all of them fail", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        stubFetchRoutes({
            [serviceTypesUrl]: serviceTypes,
            [plansUrl(MORNING)]: () => json({}, { status: 503 }),
            [plansUrl(EVENING)]: () => json({}, { status: 503 }),
        });

        await expect(getAllPlans()).resolves.toEqual({
            plans: [],
            failedServiceTypeIds: [MORNING, EVENING],
        });
    });

    test("throws when the service types themselves cannot be fetched", async () => {
        stubFetchRoutes({
            [serviceTypesUrl]: () => json({}, { status: 401 }),
        });
        await expect(getAllPlans()).rejects.toMatchObject({ status: 401 });
    });
});

describe("getPlan", () => {
    test("requests the plan under its service type and maps it", async () => {
        const fetchMock = stubFetchRoutes({
            [`${PCO_BASE}/service_types/${MORNING}/plans/101`]: { data: morningPlan },
        });

        const plan = await getPlan(MORNING, "101");

        expect(calledUrls(fetchMock)).toEqual([
            `${PCO_BASE}/service_types/${MORNING}/plans/101`,
        ]);
        expect(plan).toMatchObject({
            id: "101",
            serviceTypeId: MORNING,
            dates: "October 4, 2026",
            sortDate: "2026-10-04T08:00:00Z",
        });
    });

    test.each([
        ["service type", "abc", "101"],
        ["plan", MORNING, "1.5"],
    ])("rejects an invalid %s ID before any fetch", async (_which, st, id) => {
        const fetchMock = stubFetchRoutes({});
        await expect(getPlan(st, id)).rejects.toBeInstanceOf(InvalidPcoIdError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    test("a missing plan is a PcoError with status 404", async () => {
        stubFetchRoutes({
            [`${PCO_BASE}/service_types/${MORNING}/plans/404`]: () =>
                json({ errors: [] }, { status: 404 }),
        });
        await expect(getPlan(MORNING, "404")).rejects.toMatchObject({
            name: "PcoError",
            status: 404,
        });
    });
});

describe("getNextPlan", () => {
    const nextUrl = (serviceTypeId: string) =>
        `${PCO_BASE}/service_types/${serviceTypeId}/plans?filter=future&order=sort_date&per_page=25`;

    test("asks for the type's future plans, earliest first, in one request", async () => {
        const fetchMock = stubFetchRoutes({
            [nextUrl(MORNING)]: listPage([morningPlan]),
        });

        const plan = await getNextPlan(MORNING);

        expect(calledUrls(fetchMock)).toEqual([nextUrl(MORNING)]);
        expect(plan).toMatchObject({ id: "101", serviceTypeId: MORNING, dates: "October 4, 2026" });
    });

    test("is the earliest by sort_date, whatever order the page comes in", async () => {
        const later = planResource({ id: "102" }, { sort_date: "2026-10-11T08:00:00Z" });
        const earliest = planResource({ id: "103" }, { sort_date: "2026-10-04T08:00:00Z" });
        stubFetchRoutes({ [nextUrl(MORNING)]: listPage([later, earliest, later]) });
        await expect(getNextPlan(MORNING)).resolves.toMatchObject({ id: "103" });
    });

    test("is null when the type has no future plan", async () => {
        stubFetchRoutes({ [nextUrl(EVENING)]: listPage([]) });
        await expect(getNextPlan(EVENING)).resolves.toBeNull();
    });

    test("lets a PcoError through", async () => {
        stubFetchRoutes({ [nextUrl(MORNING)]: () => json({ errors: [] }, { status: 500 }) });
        await expect(getNextPlan(MORNING)).rejects.toBeInstanceOf(PcoError);
    });

    test("rejects an invalid service type ID before any fetch", async () => {
        const fetchMock = stubFetchRoutes({});
        await expect(getNextPlan("1e3")).rejects.toBeInstanceOf(InvalidPcoIdError);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe("getUpcomingPlans", () => {
    const upcomingUrl = (serviceTypeId: string) =>
        `${PCO_BASE}/service_types/${serviceTypeId}/plans?filter=future&order=sort_date&per_page=100`;
    const nextPage = `${PCO_BASE}/service_types/${MORNING}/plans?filter=future&offset=100&order=sort_date&per_page=100`;

    test("reads every page of the type's future plans, earliest first", async () => {
        const later = planResource({ id: "103" }, { sort_date: "2026-10-11T08:00:00Z" });
        const fetchMock = stubFetchRoutes({
            [upcomingUrl(MORNING)]: listPage([later], { next: nextPage, total: 2 }),
            [nextPage]: listPage([morningPlan], { total: 2 }),
        });

        const plans = await getUpcomingPlans(MORNING);

        expect(calledUrls(fetchMock)).toEqual([upcomingUrl(MORNING), nextPage]);
        expect(plans.map(({ id, serviceTypeId }) => [id, serviceTypeId])).toEqual([
            ["101", MORNING],
            ["103", MORNING],
        ]);
    });

    test("is empty when nothing lies ahead", async () => {
        stubFetchRoutes({ [upcomingUrl(EVENING)]: listPage([]) });
        await expect(getUpcomingPlans(EVENING)).resolves.toEqual([]);
    });

    test("fetchUpcomingPlans reads the same, afresh every time", async () => {
        const fetchMock = stubFetchRoutes({ [upcomingUrl(MORNING)]: listPage([morningPlan]) });
        await expect(fetchUpcomingPlans(MORNING)).resolves.toMatchObject([{ id: "101" }]);
        await fetchUpcomingPlans(MORNING);
        expect(calledUrls(fetchMock)).toEqual([upcomingUrl(MORNING), upcomingUrl(MORNING)]);
        await expect(fetchUpcomingPlans("0")).rejects.toBeInstanceOf(InvalidPcoIdError);
    });

    test("refuses an id that is not a Planning Center id before fetching", async () => {
        const fetchMock = stubFetchRoutes({});
        await expect(getUpcomingPlans("x")).rejects.toBeInstanceOf(InvalidPcoIdError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    test("lets a failure through", async () => {
        stubFetchRoutes({ [upcomingUrl(MORNING)]: () => json({ errors: [] }, { status: 500 }) });
        await expect(getUpcomingPlans(MORNING)).rejects.toBeInstanceOf(PcoError);
    });
});
