import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { InvalidPcoIdError } from "./ids";
import { getPlanItems } from "./planItems";
import {
    PCO_BASE,
    calledUrls,
    itemResource,
    listPage,
    songResource,
    stubFetchRoutes,
    stubPcoCredentials,
} from "./testing";

beforeEach(stubPcoCredentials);

afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

const ST = "1405391";
const PLAN = "81234567";
const itemsUrl = `${PCO_BASE}/service_types/${ST}/plans/${PLAN}/items?include=song`;

const songLink = (id: string) => ({ song: { data: { type: "Song" as const, id } } });

describe("getPlanItems", () => {
    test("requests the plan's items with their songs and returns them sorted by sequence", async () => {
        const fetchMock = stubFetchRoutes({
            [itemsUrl]: listPage(
                [
                    itemResource("3", { title: "Holy, Holy, Holy", sequence: 3 }, songLink("88")),
                    itemResource("1", { title: "Welcome", item_type: "header", sequence: 1 }),
                    itemResource("2", { title: "Amazing Grace", sequence: 2 }, songLink("77")),
                ],
                {
                    included: [
                        songResource("77", { title: "Amazing Grace" }),
                        songResource("88", { title: "Holy, Holy, Holy" }),
                    ],
                }
            ),
        });

        const { items, totalCount } = await getPlanItems(ST, PLAN);

        expect(calledUrls(fetchMock)).toEqual([itemsUrl]);
        expect(totalCount).toBe(3);
        expect(
            items.map((item) => [item.sequence, item.title, item.songId, item.song?.id ?? null])
        ).toEqual([
            [1, "Welcome", null, null],
            [2, "Amazing Grace", "77", "77"],
            [3, "Holy, Holy, Holy", "88", "88"],
        ]);
        expect(items[1].song).toEqual({
            id: "77",
            title: "Amazing Grace",
            author: "John Newton",
            admin: "Admin Co",
            ccliNumber: 22025,
            copyright: "Public Domain",
            notes: "Verse 3 optional",
            themes: "Grace",
        });
    });

    test("a song item with no included song has song: null", async () => {
        stubFetchRoutes({
            [itemsUrl]: listPage([itemResource("1", { title: "Not In Library" })]),
        });
        const { items } = await getPlanItems(ST, PLAN);
        expect(items[0].song).toBeNull();
    });

    test.each([
        ["service type", "x", PLAN],
        ["plan", ST, "01"],
    ])("rejects an invalid %s ID before any fetch", async (_which, st, plan) => {
        const fetchMock = stubFetchRoutes({});
        await expect(getPlanItems(st, plan)).rejects.toBeInstanceOf(InvalidPcoIdError);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
