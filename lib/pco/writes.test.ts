import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { PcoError, PcoValidationError } from "./client";
import { InvalidPcoIdError } from "./ids";
import {
    PCO_AUTH,
    PCO_BASE,
    calledRequests,
    itemNoteResource,
    json,
    stubFetchRoutes,
    stubPcoCredentials,
    stubPcoPacer,
} from "./testing";
import { createItemNote, deleteItemNote, updateItemNote } from "./writes";

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
        });
        await createItemNote(ST, PLAN, ITEM, CATEGORY, "R-1");
        await updateItemNote(ST, PLAN, ITEM, NOTE, "R-1");
        await deleteItemNote(ST, PLAN, ITEM, NOTE);
        expect(acquire).not.toHaveBeenCalled();
    });
});
