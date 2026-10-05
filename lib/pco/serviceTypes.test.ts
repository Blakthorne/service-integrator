import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { PcoError } from "./client";
import { InvalidPcoIdError } from "./ids";
import { fetchServiceTypes, getServiceType, getServiceTypes } from "./serviceTypes";
import {
    PCO_AUTH,
    PCO_BASE,
    calledUrls,
    listPage,
    serviceTypeResource,
    stubFetchRoutes,
    stubPcoCredentials,
    stubPcoPacer,
} from "./testing";

beforeEach(stubPcoCredentials);

afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

const morning = serviceTypeResource({ name: "Sunday Morning", sequence: 1 }, "1405391");
const evening = serviceTypeResource({ name: "Sunday Evening", sequence: 2 }, "1486055");
const archived = serviceTypeResource(
    { name: "Old Midweek", sequence: 3, archived_at: "2023-01-01T00:00:00Z" },
    "999"
);

describe("fetchServiceTypes", () => {
    const FIRST_PAGE = `${PCO_BASE}/service_types?per_page=100`;

    test("reads every service type afresh, archived ones too, unpaced by default", async () => {
        const acquire = vi.spyOn(stubPcoPacer(), "acquire");
        const fetchMock = stubFetchRoutes({ [FIRST_PAGE]: listPage([morning, archived]) });

        const serviceTypes = await fetchServiceTypes();

        expect(serviceTypes.map(({ id, archived }) => [id, archived])).toEqual([
            ["1405391", false],
            ["999", true],
        ]);
        expect(calledUrls(fetchMock)).toEqual([FIRST_PAGE]);
        expect(acquire).not.toHaveBeenCalled();
    });

    test("waits for its turn at the pacer for every page when paced", async () => {
        const acquire = vi.spyOn(stubPcoPacer(), "acquire");
        const second = `${PCO_BASE}/service_types?offset=1&per_page=100`;
        stubFetchRoutes({
            [FIRST_PAGE]: listPage([morning], { next: second, total: 2 }),
            [second]: listPage([evening], { total: 2 }),
        });

        const serviceTypes = await fetchServiceTypes({ paced: true });

        expect(serviceTypes.map(({ id }) => id)).toEqual(["1405391", "1486055"]);
        expect(acquire).toHaveBeenCalledTimes(2);
    });
});

describe("getServiceTypes", () => {
    test("requests 100 per page with auth and no-store, and maps every type", async () => {
        const fetchMock = stubFetchRoutes({
            [`${PCO_BASE}/service_types?per_page=100`]: listPage([morning, evening]),
        });

        const serviceTypes = await getServiceTypes();

        expect(fetchMock).toHaveBeenCalledWith(
            `${PCO_BASE}/service_types?per_page=100`,
            expect.objectContaining({
                cache: "no-store",
                headers: expect.objectContaining({ Authorization: PCO_AUTH }),
            })
        );
        expect(serviceTypes).toEqual([
            { id: "1405391", name: "Sunday Morning", frequency: "Weekly", sequence: 1, archived: false },
            { id: "1486055", name: "Sunday Evening", frequency: "Weekly", sequence: 2, archived: false },
        ]);
    });

    test("follows links.next and keeps archived types, in API order", async () => {
        const fetchMock = stubFetchRoutes({
            [`${PCO_BASE}/service_types?per_page=100`]: listPage([morning, archived], {
                next: `${PCO_BASE}/service_types?offset=100&per_page=100`,
            }),
            [`${PCO_BASE}/service_types?offset=100&per_page=100`]: listPage([evening]),
        });

        const serviceTypes = await getServiceTypes();

        expect(calledUrls(fetchMock)).toHaveLength(2);
        expect(serviceTypes.map((st) => [st.id, st.archived])).toEqual([
            ["1405391", false],
            ["999", true],
            ["1486055", false],
        ]);
    });
});

describe("getServiceType", () => {
    test("requests the service type by ID and maps it", async () => {
        const fetchMock = stubFetchRoutes({
            [`${PCO_BASE}/service_types/1486055`]: { data: evening },
        });

        await expect(getServiceType("1486055")).resolves.toEqual({
            id: "1486055",
            name: "Sunday Evening",
            frequency: "Weekly",
            sequence: 2,
            archived: false,
        });
        expect(calledUrls(fetchMock)).toEqual([`${PCO_BASE}/service_types/1486055`]);
    });

    test.each(["abc", "0", "../people"])(
        "rejects the ID %j before any fetch",
        async (id) => {
            const fetchMock = stubFetchRoutes({});
            await expect(getServiceType(id)).rejects.toBeInstanceOf(InvalidPcoIdError);
            expect(fetchMock).not.toHaveBeenCalled();
        }
    );

    test("a 404 from PCO is a PcoError with status 404", async () => {
        stubFetchRoutes({
            [`${PCO_BASE}/service_types/123`]: () =>
                new Response("{}", { status: 404 }),
        });
        const error = await getServiceType("123").catch((e: unknown) => e);
        expect(error).toBeInstanceOf(PcoError);
        expect(error).toMatchObject({ status: 404 });
    });
});
