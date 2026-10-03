import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { PcoError } from "./client";
import { InvalidPcoIdError } from "./ids";
import { getAllPlans, getPlan, getPlansForServiceType } from "./plans";
import {
    PCO_BASE,
    calledUrls,
    json,
    listPage,
    planResource,
    serviceTypeResource,
    stubFetchRoutes,
    stubPcoCredentials,
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
