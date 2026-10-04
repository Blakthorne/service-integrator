import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { PcoError, PcoValidationError } from "./client";
import { InvalidPcoIdError } from "./ids";
import { toPcoLibrarySong } from "./mappers";
import {
    PCO_AUTH,
    PCO_BASE,
    calledRequests,
    itemNoteResource,
    itemResource,
    json,
    songResource,
    stubFetchRoutes,
    stubPcoCredentials,
    stubPcoPacer,
} from "./testing";
import {
    assignSongTags,
    createItemNote,
    createSong,
    createSongItem,
    deleteItemNote,
    updateItemNote,
    updateSong,
    type NewPcoSong,
} from "./writes";

const ST = "1405391";
const PLAN = "81234567";
const ITEM = "900";
const CATEGORY = "503";
const NOTE = "9001";

const notesUrl = `${PCO_BASE}/service_types/${ST}/plans/${PLAN}/items/${ITEM}/item_notes`;
const noteUrl = `${notesUrl}/${NOTE}`;

/** The 422 the spike saw for a note in a category that does not exist. */
const MISSING_CATEGORY = {
    errors: [
        {
            status: "422",
            title: "Validation Error",
            detail: "must exist",
            source: { parameter: "category" },
        },
    ],
};

beforeEach(() => {
    stubPcoCredentials();
    stubPcoPacer();
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

describe("createItemNote", () => {
    test("POSTs the content with the category id as a string, and returns the note created", async () => {
        const fetchMock = stubFetchRoutes({
            [`POST ${notesUrl}`]: () =>
                json(
                    { data: itemNoteResource(NOTE, { category_name: "Hymnal", content: "R-396 / G-317" }, CATEGORY) },
                    { status: 201 }
                ),
        });

        await expect(createItemNote(ST, PLAN, ITEM, CATEGORY, "R-396 / G-317")).resolves.toEqual({
            id: NOTE,
            categoryId: CATEGORY,
            categoryName: "Hymnal",
            content: "R-396 / G-317",
        });
        expect(calledRequests(fetchMock)).toEqual([
            {
                method: "POST",
                url: notesUrl,
                body: {
                    data: {
                        type: "ItemNote",
                        attributes: { content: "R-396 / G-317", item_note_category_id: CATEGORY },
                    },
                },
            },
        ]);
        expect(fetchMock.mock.calls[0][1]).toMatchObject({
            cache: "no-store",
            redirect: "error",
            headers: { Authorization: PCO_AUTH, "Content-Type": "application/json" },
        });
    });

    test("takes the category it sent when the response does not name one", async () => {
        stubFetchRoutes({
            [`POST ${notesUrl}`]: () => json({ data: itemNoteResource(NOTE, {}, null) }, { status: 201 }),
        });
        const note = await createItemNote(ST, PLAN, ITEM, CATEGORY, "R-396 / G-317");
        expect(note.categoryId).toBe(CATEGORY);
    });

    test("throws PcoValidationError with Planning Center's reasons when it refuses", async () => {
        stubFetchRoutes({ [`POST ${notesUrl}`]: () => json(MISSING_CATEGORY, { status: 422 }) });
        const error = await createItemNote(ST, PLAN, ITEM, CATEGORY, "R-1").catch((e: unknown) => e);
        expect(error).toBeInstanceOf(PcoValidationError);
        expect(error).toMatchObject({ status: 422, details: ["category: must exist"] });
    });

    test("throws when Planning Center sends no note back", async () => {
        stubFetchRoutes({ [`POST ${notesUrl}`]: () => new Response(null, { status: 204 }) });
        await expect(createItemNote(ST, PLAN, ITEM, CATEGORY, "R-1")).rejects.toThrow(
            `Planning Center sent no item note back (/service_types/${ST}/plans/${PLAN}/items/${ITEM}/item_notes)`
        );
    });
});

describe("updateItemNote", () => {
    test("PATCHes the content only, and returns the note as it is now", async () => {
        const fetchMock = stubFetchRoutes({
            [`PATCH ${noteUrl}`]: () => json({ data: itemNoteResource(NOTE, { content: "R-12" }, CATEGORY) }),
        });

        await expect(updateItemNote(ST, PLAN, ITEM, NOTE, "R-12")).resolves.toEqual({
            id: NOTE,
            categoryId: CATEGORY,
            categoryName: "Hymnal",
            content: "R-12",
        });
        expect(calledRequests(fetchMock)).toEqual([
            {
                method: "PATCH",
                url: noteUrl,
                body: { data: { type: "ItemNote", attributes: { content: "R-12" } } },
            },
        ]);
    });

    test("lets a note that is gone fail with its PcoError", async () => {
        stubFetchRoutes({ [`PATCH ${noteUrl}`]: () => json({ errors: [] }, { status: 404 }) });
        const error = await updateItemNote(ST, PLAN, ITEM, NOTE, "R-12").catch((e: unknown) => e);
        expect(error).toBeInstanceOf(PcoError);
        expect(error).not.toBeInstanceOf(PcoValidationError);
        expect(error).toMatchObject({ status: 404 });
    });
});

describe("deleteItemNote", () => {
    test("DELETEs the note with no body, and returns its id", async () => {
        const fetchMock = stubFetchRoutes({
            [`DELETE ${noteUrl}`]: () => new Response(null, { status: 204 }),
        });

        await expect(deleteItemNote(ST, PLAN, ITEM, NOTE)).resolves.toEqual({ id: NOTE });
        expect(calledRequests(fetchMock)).toEqual([{ method: "DELETE", url: noteUrl, body: undefined }]);
    });
});

const SONG = "1001";
const songsUrl = `${PCO_BASE}/songs`;
const songUrl = `${songsUrl}/${SONG}`;

describe("createSong", () => {
    test("POSTs the song's fields to /songs and returns the song Planning Center created", async () => {
        const created = songResource(SONG, {
            title: "O God, Our Help (ST. ANNE)",
            author: "Words: Isaac Watts; Music: William Croft",
            copyright: "Public Domain",
            ccli_number: null,
        });
        const fetchMock = stubFetchRoutes({ [`POST ${songsUrl}`]: () => json({ data: created }, { status: 201 }) });

        await expect(
            createSong({
                title: "O God, Our Help (ST. ANNE)",
                author: "Words: Isaac Watts; Music: William Croft",
                copyright: "Public Domain",
            })
        ).resolves.toEqual(toPcoLibrarySong(created));
        expect(calledRequests(fetchMock)).toEqual([
            {
                method: "POST",
                url: songsUrl,
                body: {
                    data: {
                        type: "Song",
                        attributes: {
                            title: "O God, Our Help (ST. ANNE)",
                            author: "Words: Isaac Watts; Music: William Croft",
                            copyright: "Public Domain",
                        },
                    },
                },
            },
        ]);
        expect(fetchMock.mock.calls[0][1]).toMatchObject({
            cache: "no-store",
            redirect: "error",
            headers: { Authorization: PCO_AUTH, "Content-Type": "application/json" },
        });
    });

    test("sends every field it takes, null ones included, under Planning Center's names", async () => {
        const fetchMock = stubFetchRoutes({
            [`POST ${songsUrl}`]: () => json({ data: songResource(SONG) }, { status: 201 }),
        });
        await createSong({
            title: "T",
            author: null,
            copyright: "2001 Y",
            admin: "Admin Co",
            themes: "Grace",
            hidden: false,
        });
        expect(calledRequests(fetchMock)[0].body).toEqual({
            data: {
                type: "Song",
                attributes: {
                    title: "T",
                    author: null,
                    copyright: "2001 Y",
                    admin: "Admin Co",
                    themes: "Grace",
                    hidden: false,
                },
            },
        });
    });

    test("never sends a CCLI number, whatever it is given", async () => {
        const fetchMock = stubFetchRoutes({
            [`POST ${songsUrl}`]: () => json({ data: songResource(SONG) }, { status: 201 }),
        });
        const withCcli = { title: "Amazing Grace", ccliNumber: 22025, ccli_number: 22025 } as NewPcoSong;
        await createSong(withCcli);
        expect(calledRequests(fetchMock)[0].body).toEqual({
            data: { type: "Song", attributes: { title: "Amazing Grace" } },
        });
    });

    test("throws PcoValidationError with Planning Center's reasons when it refuses", async () => {
        stubFetchRoutes({
            [`POST ${songsUrl}`]: () =>
                json(
                    { errors: [{ title: "Validation Error", detail: "can't be blank", source: { parameter: "title" } }] },
                    { status: 422 }
                ),
        });
        const error = await createSong({ title: "" }).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(PcoValidationError);
        expect(error).toMatchObject({ status: 422, details: ["title: can't be blank"] });
    });

    test("throws when Planning Center sends no song back", async () => {
        stubFetchRoutes({ [`POST ${songsUrl}`]: () => new Response(null, { status: 204 }) });
        await expect(createSong({ title: "T" })).rejects.toThrow(
            "Planning Center sent no song back (/songs)"
        );
    });
});

describe("updateSong", () => {
    test("PATCHes only the fields given, with no data.id, and returns the song as it is now", async () => {
        const updated = songResource(SONG, { author: "Words: John Newton" });
        const fetchMock = stubFetchRoutes({ [`PATCH ${songUrl}`]: () => json({ data: updated }) });

        await expect(updateSong(SONG, { author: "Words: John Newton" })).resolves.toEqual(
            toPcoLibrarySong(updated)
        );
        expect(calledRequests(fetchMock)).toEqual([
            {
                method: "PATCH",
                url: songUrl,
                body: { data: { type: "Song", attributes: { author: "Words: John Newton" } } },
            },
        ]);
    });

    test("sends a CCLI number as ccli_number, and a null as null", async () => {
        const fetchMock = stubFetchRoutes({ [`PATCH ${songUrl}`]: () => json({ data: songResource(SONG) }) });
        await updateSong(SONG, { ccliNumber: 22025, admin: null, title: "Amazing Grace", hidden: true });
        expect(calledRequests(fetchMock)[0].body).toEqual({
            data: {
                type: "Song",
                attributes: { title: "Amazing Grace", ccli_number: 22025, admin: null, hidden: true },
            },
        });
    });

    test("refuses, sending nothing, when there is nothing to change", async () => {
        const fetchMock = stubFetchRoutes({});
        await expect(updateSong(SONG, {})).rejects.toThrow(`Nothing to change of the song (/songs/${SONG})`);
        await expect(updateSong(SONG, { author: undefined })).rejects.toThrow("Nothing to change");
        expect(fetchMock).not.toHaveBeenCalled();
    });

    test("lets a song that is gone fail with its PcoError", async () => {
        stubFetchRoutes({ [`PATCH ${songUrl}`]: () => json({ errors: [] }, { status: 404 }) });
        await expect(updateSong(SONG, { title: "T" })).rejects.toMatchObject({ name: "PcoError", status: 404 });
    });
});

describe("createSongItem", () => {
    const itemsUrl = `${PCO_BASE}/service_types/${ST}/plans/${PLAN}/items`;

    test("POSTs the item's title, song and arrangement, and no sequence, so it is appended", async () => {
        const created = itemResource("950", { title: "O God, Our Help", sequence: 18 }, {
            song: { data: { type: "Song", id: SONG } },
        });
        const fetchMock = stubFetchRoutes({ [`POST ${itemsUrl}`]: () => json({ data: created }, { status: 201 }) });

        await expect(
            createSongItem(ST, PLAN, { songId: SONG, arrangementId: "5001", title: "O God, Our Help" })
        ).resolves.toMatchObject({ id: "950", title: "O God, Our Help", sequence: 18, songId: SONG });
        expect(calledRequests(fetchMock)).toEqual([
            {
                method: "POST",
                url: itemsUrl,
                body: {
                    data: {
                        type: "Item",
                        attributes: { title: "O God, Our Help", song_id: SONG, arrangement_id: "5001" },
                    },
                },
            },
        ]);
    });

    test("takes the song it sent when the response does not name one", async () => {
        stubFetchRoutes({ [`POST ${itemsUrl}`]: () => json({ data: itemResource("950") }, { status: 201 }) });
        const item = await createSongItem(ST, PLAN, { songId: SONG, arrangementId: "5001", title: "T" });
        expect(item.songId).toBe(SONG);
    });

    test("throws when Planning Center sends no item back", async () => {
        stubFetchRoutes({ [`POST ${itemsUrl}`]: () => new Response(null, { status: 204 }) });
        await expect(
            createSongItem(ST, PLAN, { songId: SONG, arrangementId: "5001", title: "T" })
        ).rejects.toThrow(`Planning Center sent no item back (/service_types/${ST}/plans/${PLAN}/items)`);
    });
});

describe("assignSongTags", () => {
    const assignUrl = `${songUrl}/assign_tags`;

    test("POSTs the whole set of tags, each once, as Tag relationships, and returns it", async () => {
        const fetchMock = stubFetchRoutes({ [`POST ${assignUrl}`]: () => new Response(null, { status: 204 }) });

        await expect(assignSongTags(SONG, ["71", "72", "71"])).resolves.toEqual({
            songId: SONG,
            tagIds: ["71", "72"],
        });
        expect(calledRequests(fetchMock)).toEqual([
            {
                method: "POST",
                url: assignUrl,
                body: {
                    data: {
                        type: "TagAssignment",
                        attributes: {},
                        relationships: {
                            tags: {
                                data: [
                                    { type: "Tag", id: "71" },
                                    { type: "Tag", id: "72" },
                                ],
                            },
                        },
                    },
                },
            },
        ]);
    });

    test("sends an empty set to clear the song's tags", async () => {
        const fetchMock = stubFetchRoutes({ [`POST ${assignUrl}`]: () => new Response(null, { status: 204 }) });
        await expect(assignSongTags(SONG, [])).resolves.toEqual({ songId: SONG, tagIds: [] });
        expect(calledRequests(fetchMock)[0].body).toEqual({
            data: { type: "TagAssignment", attributes: {}, relationships: { tags: { data: [] } } },
        });
    });

    test("checks every tag id before it sends anything", async () => {
        const fetchMock = stubFetchRoutes({});
        await expect(assignSongTags(SONG, ["71", "x"])).rejects.toBeInstanceOf(InvalidPcoIdError);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe("every write", () => {
    const writes = {
        create: (st: string, plan: string, item: string, other: string) =>
            createItemNote(st, plan, item, other, "R-1"),
        update: (st: string, plan: string, item: string, other: string) =>
            updateItemNote(st, plan, item, other, "R-1"),
        delete: (st: string, plan: string, item: string, other: string) =>
            deleteItemNote(st, plan, item, other),
    };

    test.each(Object.entries(writes))("%s checks every id before it sends anything", async (_name, write) => {
        const fetchMock = stubFetchRoutes({});
        const cases = [
            ["x", PLAN, ITEM, NOTE],
            [ST, "01", ITEM, NOTE],
            [ST, PLAN, "../1", NOTE],
            [ST, PLAN, ITEM, "1 "],
        ];
        for (const [st, plan, item, other] of cases) {
            await expect(write(st, plan, item, other)).rejects.toBeInstanceOf(InvalidPcoIdError);
        }
        expect(fetchMock).not.toHaveBeenCalled();
    });

    test("is not paced: someone is waiting", async () => {
        const pacer = stubPcoPacer();
        const acquire = vi.spyOn(pacer, "acquire");
        stubFetchRoutes({
            [`POST ${notesUrl}`]: () => json({ data: itemNoteResource(NOTE) }, { status: 201 }),
            [`PATCH ${noteUrl}`]: () => json({ data: itemNoteResource(NOTE) }),
            [`DELETE ${noteUrl}`]: () => new Response(null, { status: 204 }),
            [`POST ${songsUrl}`]: () => json({ data: songResource(SONG) }, { status: 201 }),
            [`PATCH ${songUrl}`]: () => json({ data: songResource(SONG) }),
            [`POST ${PCO_BASE}/service_types/${ST}/plans/${PLAN}/items`]: () =>
                json({ data: itemResource("950") }, { status: 201 }),
            [`POST ${songUrl}/assign_tags`]: () => new Response(null, { status: 204 }),
        });
        await createItemNote(ST, PLAN, ITEM, CATEGORY, "R-1");
        await updateItemNote(ST, PLAN, ITEM, NOTE, "R-1");
        await deleteItemNote(ST, PLAN, ITEM, NOTE);
        await createSong({ title: "T" });
        await updateSong(SONG, { title: "T" });
        await createSongItem(ST, PLAN, { songId: SONG, arrangementId: "5001", title: "T" });
        await assignSongTags(SONG, ["71"]);
        expect(acquire).not.toHaveBeenCalled();
    });

    test("the song, item and tag writes check every id before they send anything", async () => {
        const fetchMock = stubFetchRoutes({});
        const attempts = [
            () => updateSong("x", { title: "T" }),
            () => updateSong("01", { title: "T" }),
            () => createSongItem("x", PLAN, { songId: SONG, arrangementId: "5001", title: "T" }),
            () => createSongItem(ST, "../1", { songId: SONG, arrangementId: "5001", title: "T" }),
            () => createSongItem(ST, PLAN, { songId: "1 ", arrangementId: "5001", title: "T" }),
            () => createSongItem(ST, PLAN, { songId: SONG, arrangementId: "", title: "T" }),
            () => assignSongTags("-1", ["71"]),
        ];
        for (const attempt of attempts) {
            await expect(attempt()).rejects.toBeInstanceOf(InvalidPcoIdError);
        }
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
