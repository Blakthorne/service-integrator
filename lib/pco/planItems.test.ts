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
const itemsUrl = `${PCO_BASE}/service_types/${ST}/plans/${PLAN}/items?include=song&per_page=100`;

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

    test("returns all 120 items of a plan spread over two pages, complete and sorted", async () => {
        // PCO pages items 25 at a time by default; plans with more items used
        // to lose their closing songs. Page 1 holds sequences 120..21 (reverse
        // order), page 2 holds 20..1; every item is a song with its own Song.
        const item = (sequence: number) =>
            itemResource(
                `i${sequence}`,
                { title: `Song ${sequence}`, sequence },
                songLink(`s${sequence}`)
            );
        const song = (sequence: number) =>
            songResource(`s${sequence}`, { title: `Song ${sequence}` });
        const descending = (from: number, to: number) =>
            Array.from({ length: from - to + 1 }, (_, i) => from - i);
        const page1 = descending(120, 21);
        const page2 = descending(20, 1);

        const nextUrl = `${PCO_BASE}/service_types/${ST}/plans/${PLAN}/items?include=song&offset=100&per_page=100`;
        const fetchMock = stubFetchRoutes({
            [itemsUrl]: listPage(page1.map(item), {
                next: nextUrl,
                included: page1.map(song),
                total: 120,
            }),
            // PCO repeats an included song on every page that references it.
            [nextUrl]: listPage(page2.map(item), {
                included: [...page2.map(song), song(120)],
                total: 120,
            }),
        });

        const { items, totalCount } = await getPlanItems(ST, PLAN);

        expect(calledUrls(fetchMock)).toEqual([itemsUrl, nextUrl]);
        expect(totalCount).toBe(120);
        expect(items).toHaveLength(120);
        expect(items.map((it) => it.sequence)).toEqual(descending(120, 1).reverse());
        // Items on both pages are joined to their songs.
        for (const it of items) {
            expect(it.song?.id).toBe(`s${it.sequence}`);
        }
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
