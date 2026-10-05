import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { PcoError } from "./client";
import { InvalidPcoIdError } from "./ids";
import { fetchPlanItems, fetchPlanSongItems, getItemNoteCategories, getPlanItems } from "./planItems";
import {
    PCO_AUTH,
    PCO_BASE,
    calledUrls,
    itemNoteCategoryResource,
    itemNoteResource,
    itemResource,
    json,
    listPage,
    noteLinks,
    songResource,
    stubFetchRoutes,
    stubPcoCredentials,
    stubPcoPacer,
} from "./testing";

beforeEach(stubPcoCredentials);

afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

const ST = "1405391";
const PLAN = "81234567";
const itemsUrl = `${PCO_BASE}/service_types/${ST}/plans/${PLAN}/items?include=song,item_notes&per_page=100`;

const songLink = (id: string) => ({ song: { data: { type: "Song" as const, id } } });

describe("fetchPlanSongItems", () => {
    const songItemsUrl = `${PCO_BASE}/service_types/${ST}/plans/${PLAN}/items?include=song&per_page=100`;

    test("reads the plan's items with their songs, paced, and keeps the song items in sequence order", async () => {
        const acquire = vi.spyOn(stubPcoPacer(), "acquire");
        const fetchMock = stubFetchRoutes({
            [songItemsUrl]: listPage(
                [
                    itemResource("3", { title: "Holy, Holy, Holy", sequence: 3 }, songLink("88")),
                    itemResource("1", { title: "Welcome", item_type: "header", sequence: 1 }),
                    itemResource("2", { title: "Amazing Grace", sequence: 2 }, songLink("77")),
                    itemResource("4", { title: "Offering", item_type: "item", sequence: 4 }),
                    // A song item whose song was deleted, which Planning Center turns into a plain item.
                    itemResource("5", { title: "Gone", sequence: 5 }),
                    itemResource("6", { title: "A header with a song", item_type: "header", sequence: 6 }, songLink("99")),
                ],
                { included: [songResource("77"), songResource("88")] }
            ),
        });

        const items = await fetchPlanSongItems(ST, PLAN, { paced: true });

        expect(calledUrls(fetchMock)).toEqual([songItemsUrl]);
        expect(acquire).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][1]).toMatchObject({
            cache: "no-store",
            headers: { Authorization: PCO_AUTH },
        });
        expect(items.map((item) => [item.id, item.sequence, item.songId, item.title])).toEqual([
            ["2", 2, "77", "Amazing Grace"],
            ["3", 3, "88", "Holy, Holy, Holy"],
        ]);
    });

    test("is unpaced unless asked, and follows links.next", async () => {
        const acquire = vi.spyOn(stubPcoPacer(), "acquire");
        const second = `${PCO_BASE}/service_types/${ST}/plans/${PLAN}/items?include=song&offset=100&per_page=100`;
        const fetchMock = stubFetchRoutes({
            [songItemsUrl]: listPage([itemResource("1", { sequence: 1 }, songLink("77"))], { next: second, total: 2 }),
            [second]: listPage([itemResource("2", { sequence: 2 }, songLink("88"))], { total: 2 }),
        });

        const items = await fetchPlanSongItems(ST, PLAN);

        expect(items.map((item) => item.id)).toEqual(["1", "2"]);
        expect(calledUrls(fetchMock)).toEqual([songItemsUrl, second]);
        expect(acquire).not.toHaveBeenCalled();
    });

    test("is empty for a plan without songs", async () => {
        stubFetchRoutes({ [songItemsUrl]: listPage([]) });
        await expect(fetchPlanSongItems(ST, PLAN)).resolves.toEqual([]);
    });

    test("refuses an id that is not a Planning Center id before fetching", async () => {
        const fetchMock = stubFetchRoutes({});
        await expect(fetchPlanSongItems("../x", PLAN)).rejects.toBeInstanceOf(InvalidPcoIdError);
        await expect(fetchPlanSongItems(ST, "1/../2")).rejects.toBeInstanceOf(InvalidPcoIdError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    test("lets a missing plan's 404 through", async () => {
        stubFetchRoutes({ [songItemsUrl]: () => json({ errors: [] }, { status: 404 }) });
        await expect(fetchPlanSongItems(ST, PLAN)).rejects.toMatchObject({ name: "PcoError", status: 404 });
    });
});

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

        const nextUrl = `${PCO_BASE}/service_types/${ST}/plans/${PLAN}/items?include=song,item_notes&offset=100&per_page=100`;
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

    test("a song item renamed in the plan still gets its song, by PCO ID", async () => {
        stubFetchRoutes({
            [itemsUrl]: listPage(
                [itemResource("1", { title: "Amazing Grace (Acoustic)" }, songLink("77"))],
                { included: [songResource("77", { title: "Amazing Grace" })] }
            ),
        });
        const { items } = await getPlanItems(ST, PLAN);
        expect(items[0].title).toBe("Amazing Grace (Acoustic)");
        expect(items[0].song).toMatchObject({ id: "77", title: "Amazing Grace" });
    });

    test("asks for the items' notes with their songs, and sends the credentials", async () => {
        const fetchMock = stubFetchRoutes({ [itemsUrl]: listPage([]) });
        await getPlanItems(ST, PLAN);
        expect(calledUrls(fetchMock)).toEqual([itemsUrl]);
        expect(new URL(itemsUrl).searchParams.get("include")).toBe("song,item_notes");
        expect(fetchMock.mock.calls[0][1]).toMatchObject({
            headers: { Authorization: PCO_AUTH },
            cache: "no-store",
        });
    });

    test("gives each item its notes, from the included ItemNotes its item_notes relationship names", async () => {
        // The shapes the spike saw: an ItemNote has category_name, content
        // and an item_note_category relationship.
        stubFetchRoutes({
            [itemsUrl]: listPage(
                [
                    itemResource("1", { title: "Amazing Grace", sequence: 1 }, {
                        ...songLink("77"),
                        ...noteLinks("9001", "9002"),
                    }),
                    itemResource("2", { title: "Welcome", item_type: "header", sequence: 2 }, noteLinks("9003")),
                    itemResource("3", { title: "Holy, Holy, Holy", sequence: 3 }, songLink("88")),
                ],
                {
                    included: [
                        songResource("77"),
                        itemNoteResource("9001", { category_name: "Hymnal", content: "R-396 / G-317" }, "501"),
                        itemNoteResource("9002", { category_name: "Vocals", content: "Women on verse 2" }, "502"),
                        itemNoteResource("9003", { category_name: "Audio/Visual", content: "Lights up" }, "503"),
                        songResource("88"),
                    ],
                }
            ),
        });

        const { items } = await getPlanItems(ST, PLAN);

        expect(items.map((item) => [item.id, item.notes])).toEqual([
            [
                "1",
                [
                    { id: "9001", categoryId: "501", categoryName: "Hymnal", content: "R-396 / G-317" },
                    { id: "9002", categoryId: "502", categoryName: "Vocals", content: "Women on verse 2" },
                ],
            ],
            ["2", [{ id: "9003", categoryId: "503", categoryName: "Audio/Visual", content: "Lights up" }]],
            ["3", []],
        ]);
        // The songs are joined as before.
        expect(items.map((item) => item.song?.id ?? null)).toEqual(["77", null, "88"]);
    });

    test("finds notes included on another page, as it does songs", async () => {
        const nextUrl = `${PCO_BASE}/service_types/${ST}/plans/${PLAN}/items?include=song,item_notes&offset=100&per_page=100`;
        stubFetchRoutes({
            [itemsUrl]: listPage([itemResource("1", { sequence: 1 }, noteLinks("9001"))], {
                next: nextUrl,
                included: [itemNoteResource("9002", { content: "R-12" })],
                total: 2,
            }),
            [nextUrl]: listPage([itemResource("2", { sequence: 2 }, noteLinks("9002"))], {
                included: [itemNoteResource("9001", { content: "R-11" })],
                total: 2,
            }),
        });

        const { items } = await getPlanItems(ST, PLAN);

        expect(items.map((item) => item.notes.map(({ content }) => content))).toEqual([["R-11"], ["R-12"]]);
    });

    test("fetchPlanItems reads the same items the same way", async () => {
        const fetchMock = stubFetchRoutes({
            [itemsUrl]: listPage([itemResource("1", {}, noteLinks("9001"))], {
                included: [itemNoteResource("9001")],
            }),
        });
        const fresh = await fetchPlanItems(ST, PLAN);
        expect(fresh).toEqual(await getPlanItems(ST, PLAN));
        expect(calledUrls(fetchMock)).toEqual([itemsUrl, itemsUrl]);
        await expect(fetchPlanItems("x", PLAN)).rejects.toBeInstanceOf(InvalidPcoIdError);
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

describe("getItemNoteCategories", () => {
    const categoriesUrl = `${PCO_BASE}/service_types/${ST}/item_note_categories?per_page=100`;

    test("requests the service type's categories, 100 per page, and maps them in order", async () => {
        const fetchMock = stubFetchRoutes({
            [categoriesUrl]: listPage([
                itemNoteCategoryResource("501", { name: "Audio/Visual", sequence: 1 }),
                itemNoteCategoryResource("502", { name: "Band", sequence: 2 }),
                itemNoteCategoryResource("503", { name: "Hymnal", sequence: 3 }),
            ]),
        });

        await expect(getItemNoteCategories(ST)).resolves.toEqual([
            { id: "501", name: "Audio/Visual" },
            { id: "502", name: "Band" },
            { id: "503", name: "Hymnal" },
        ]);
        expect(calledUrls(fetchMock)).toEqual([categoriesUrl]);
        expect(fetchMock.mock.calls[0][1]).toMatchObject({
            headers: { Authorization: PCO_AUTH },
            cache: "no-store",
        });
    });

    test("leaves out a category Planning Center marks deleted", async () => {
        stubFetchRoutes({
            [categoriesUrl]: listPage([
                itemNoteCategoryResource("501", { name: "Hymnal", deleted_at: "2026-09-01T00:00:00Z" }),
                itemNoteCategoryResource("504", { name: "Hymnal" }),
            ]),
        });
        await expect(getItemNoteCategories(ST)).resolves.toEqual([{ id: "504", name: "Hymnal" }]);
    });

    test("follows links.next", async () => {
        const nextUrl = `${PCO_BASE}/service_types/${ST}/item_note_categories?offset=100&per_page=100`;
        stubFetchRoutes({
            [categoriesUrl]: listPage([itemNoteCategoryResource("501", { name: "Band" })], {
                next: nextUrl,
                total: 2,
            }),
            [nextUrl]: listPage([itemNoteCategoryResource("502", { name: "Hymnal" })], { total: 2 }),
        });
        await expect(getItemNoteCategories(ST)).resolves.toEqual([
            { id: "501", name: "Band" },
            { id: "502", name: "Hymnal" },
        ]);
    });

    test("lets a missing service type's PcoError through", async () => {
        stubFetchRoutes({ [categoriesUrl]: () => json({ errors: [] }, { status: 404 }) });
        await expect(getItemNoteCategories(ST)).rejects.toBeInstanceOf(PcoError);
    });

    test("rejects an invalid service type ID before any fetch", async () => {
        const fetchMock = stubFetchRoutes({});
        await expect(getItemNoteCategories("../1")).rejects.toBeInstanceOf(InvalidPcoIdError);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
