import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
    openTestDb,
    seedBook,
    seedEntry,
    seedHymn,
    seedSetting,
    seedSong,
    seedTune,
    seedWriteLog,
} from "@/lib/db/testing";
import { recentWrites } from "@/lib/db/writeLog";
import { InvalidPcoIdError } from "@/lib/pco";
import {
    PCO_BASE,
    calledRequests,
    calledUrls,
    itemNoteCategoryResource,
    itemNoteResource,
    itemResource,
    json,
    listPage,
    noteLinks,
    serviceTypeResource,
    songResource,
    stubFetchRoutes,
    stubPcoCredentials,
    stubPcoPacer,
} from "@/lib/pco/testing";

const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/lib/db", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/db")>()),
    getDb,
}));

import {
    SYNC_IN_PROGRESS_MESSAGE,
    getHymnNoteCategories,
    previewHymnNotes,
    syncHymnNotes,
} from "./hymnNotes";

const ST = "1405391";
const EVENING = "1486055";
const PLAN = "81234567";
const HYMNAL = "503";

const urls = {
    serviceTypes: `${PCO_BASE}/service_types?per_page=100`,
    serviceType: (st = ST) => `${PCO_BASE}/service_types/${st}`,
    items: `${PCO_BASE}/service_types/${ST}/plans/${PLAN}/items?include=song,item_notes&per_page=100`,
    categories: (st = ST) => `${PCO_BASE}/service_types/${st}/item_note_categories?per_page=100`,
    notes: (item: string) => `${PCO_BASE}/service_types/${ST}/plans/${PLAN}/items/${item}/item_notes`,
    note: (item: string, note: string) =>
        `${PCO_BASE}/service_types/${ST}/plans/${PLAN}/items/${item}/item_notes/${note}`,
};

const songLink = (id: string) => ({ song: { data: { type: "Song" as const, id } } });

/** An included resource, as the tests below swap them. */
type Included = { type: string; id: string };

const hymnalNote = (id: string, content: string) =>
    itemNoteResource(id, { category_name: "Hymnal", content }, HYMNAL);

/**
 * The plan's items, one for each action:
 * 1. O God, Our Help (song 77, at R-396 and G-317), no note: create;
 * 2. Amazing Grace (song 88, at R-12), a stale note: update;
 * 3. a song that is not linked (99), with a note: delete;
 * 4. O God, Our Help again, its note and an extra: dedupe;
 * 5. Amazing Grace again, in step, with a Vocals note: unchanged;
 * 6. a header with a Hymnal note, which is never touched.
 */
function planItems() {
    return listPage(
        [
            itemResource("1", { title: "O God, Our Help", sequence: 1 }, songLink("77")),
            itemResource("2", { title: "Amazing Grace", sequence: 2 }, {
                ...songLink("88"),
                ...noteLinks("9002"),
            }),
            itemResource("3", { title: "A Song Not In The Hymnbooks", sequence: 3 }, {
                ...songLink("99"),
                ...noteLinks("9003"),
            }),
            itemResource("4", { title: "O God, Our Help (reprise)", sequence: 4 }, {
                ...songLink("77"),
                ...noteLinks("9004", "9005"),
            }),
            itemResource("5", { title: "Amazing Grace (reprise)", sequence: 5 }, {
                ...songLink("88"),
                ...noteLinks("9006", "9007"),
            }),
            itemResource("6", { title: "Welcome", item_type: "header", sequence: 6 }, noteLinks("9008")),
        ],
        {
            included: [
                songResource("77", { title: "O God, Our Help" }),
                songResource("88", { title: "Amazing Grace" }),
                songResource("99", { title: "A Song Not In The Hymnbooks" }),
                hymnalNote("9002", "R-99"),
                hymnalNote("9003", "R-5"),
                hymnalNote("9004", "R-396 / G-317"),
                hymnalNote("9005", "R-396"),
                hymnalNote("9006", "R-12"),
                itemNoteResource("9007", { category_name: "Vocals", content: "Women on verse 2" }, "502"),
                hymnalNote("9008", "R-1"),
            ],
        }
    );
}

function categories(...names: string[]) {
    return listPage(
        names.map((name, i) =>
            itemNoteCategoryResource(name === "Hymnal" ? HYMNAL : String(510 + i), { name })
        )
    );
}

/** Planning Center's reads, with the Hymnal category unless told otherwise. */
function readRoutes(categoryNames: string[] = ["Band", "Hymnal"]): Record<string, unknown> {
    return {
        [urls.serviceType()]: { data: serviceTypeResource({ name: "Sunday Morning" }, ST) },
        [urls.items]: planItems(),
        [urls.categories()]: categories(...categoryNames),
    };
}

/** Planning Center's answers to the writes the plan's notes need. */
function writeRoutes(): Record<string, unknown> {
    return {
        [`POST ${urls.notes("1")}`]: () =>
            json({ data: hymnalNote("9101", "R-396 / G-317") }, { status: 201 }),
        [`PATCH ${urls.note("2", "9002")}`]: () => json({ data: hymnalNote("9002", "R-12") }),
        [`DELETE ${urls.note("3", "9003")}`]: () => new Response(null, { status: 204 }),
        [`DELETE ${urls.note("4", "9005")}`]: () => new Response(null, { status: 204 }),
    };
}

/** The requests that were not GETs. */
function writesSent(fetchMock: ReturnType<typeof stubFetchRoutes>) {
    return calledRequests(fetchMock).filter(({ method }) => method !== "GET");
}

/** The notes an earlier sync wrote: item 3's (its song has since lost its link) and item 4's two. */
const APP_NOTES = ["9003", "9004", "9005"];

/** Record in the write log that the app created these notes, as a sync does. */
function seedAppNotes(...noteIds: string[]): void {
    for (const noteId of noteIds) {
        seedWriteLog(db, {
            target: `plan ${PLAN} item 1`,
            payload: {
                serviceTypeId: ST,
                planId: PLAN,
                itemId: "1",
                action: "create",
                categoryId: HYMNAL,
                content: "R-1",
            },
            result: { note: { id: noteId, categoryId: HYMNAL, categoryName: "Hymnal", content: "R-1" } },
        });
    }
}

/** Make every query whose SQL contains `sql` throw `error`, as a broken table would. */
function failQueries(sql: string, error: Error): void {
    const prepare = db.prepare.bind(db);
    vi.spyOn(db, "prepare").mockImplementation((text: string) => {
        if (text.includes(sql)) {
            throw error;
        }
        return prepare(text);
    });
}

/** The id of the write log's latest row, or 0. */
function lastWriteId(): number {
    return recentWrites(db, 1)[0]?.id ?? 0;
}

/** The write log's rows after row `mark`, oldest first. */
function writesAfter(mark: number) {
    return recentWrites(db, 1000)
        .filter(({ id }) => id > mark)
        .reverse();
}

let db: DatabaseSync;

beforeEach(() => {
    stubPcoCredentials();
    // A fresh registry of syncs in progress per test (undone by unstubAllGlobals).
    vi.stubGlobal(Symbol.for("service-integrator.hymnNoteSyncs.v1"), new Map());
    db = openTestDb();
    getDb.mockReturnValue(db);
    const rejoice = seedBook(db, { code: "R", name: "Rejoice Hymns" });
    const great = seedBook(db, { code: "G", name: "Great Hymns of the Faith" });
    const ourHelp = seedSong(db, {
        hymnId: seedHymn(db, { title: "O God, Our Help in Ages Past" }),
        tuneId: seedTune(db, { name: "ST. ANNE" }),
        pcoSongId: "77",
        linkedBy: "manual",
        linkedAt: "2026-10-01T12:00:00.000Z",
    });
    seedEntry(db, { bookId: rejoice, songId: ourHelp, number: 396 });
    seedEntry(db, { bookId: great, songId: ourHelp, number: 317 });
    const grace = seedSong(db, {
        hymnId: seedHymn(db, { title: "Amazing Grace" }),
        tuneId: seedTune(db, { name: "NEW BRITAIN" }),
        pcoSongId: "88",
        linkedBy: "manual",
        linkedAt: "2026-10-01T12:00:00.000Z",
    });
    seedEntry(db, { bookId: rejoice, songId: grace, number: 12 });
});

afterEach(() => {
    db.close();
    getDb.mockReset();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

describe("previewHymnNotes", () => {
    test("gives the category and what each song item's note needs, writing nothing", async () => {
        seedAppNotes(...APP_NOTES);
        const mark = lastWriteId();
        const fetchMock = stubFetchRoutes(readRoutes());

        const status = await previewHymnNotes(ST, PLAN);

        expect(status.kind === "ready" && status.category).toEqual({ id: HYMNAL, name: "Hymnal" });
        expect(
            status.kind === "ready" &&
                status.items.map(({ itemId, action, content, current }) => [itemId, action, content, current])
        ).toEqual([
            ["1", "create", "R-396 / G-317", null],
            ["2", "update", "R-12", "R-99"],
            ["3", "delete", null, "R-5"],
            ["4", "dedupe", "R-396 / G-317", "R-396 / G-317"],
            ["5", "unchanged", "R-12", "R-12"],
        ]);
        expect(calledUrls(fetchMock).sort()).toEqual(
            [urls.serviceType(), urls.items, urls.categories()].sort()
        );
        expect(writesSent(fetchMock)).toEqual([]);
        expect(writesAfter(mark)).toEqual([]);
    });

    test("shows the hymnal notes it would leave alone, which the app did not write", async () => {
        stubFetchRoutes(readRoutes());

        const status = await previewHymnNotes(ST, PLAN);

        expect(
            status.kind === "ready" && status.items.map(({ itemId, action, changes, keep }) => [itemId, action, changes.length, keep])
        ).toEqual([
            ["1", "create", 1, []],
            ["2", "update", 1, []],
            ["3", "keep", 0, [{ kind: "keep", noteId: "9003", content: "R-5", reason: "nothing-to-say" }]],
            ["4", "unchanged", 0, [{ kind: "keep", noteId: "9005", content: "R-396", reason: "duplicate" }]],
            ["5", "unchanged", 0, []],
        ]);
    });

    test("follows the settings: the category's name and whether the note names the tune", async () => {
        seedSetting(db, "hymnNoteCategoryName", "Hymn Numbers");
        seedSetting(db, "hymnNoteIncludesTune", true);
        stubFetchRoutes({
            ...readRoutes(),
            [urls.categories()]: listPage([itemNoteCategoryResource("601", { name: "hymn numbers" })]),
        });

        const status = await previewHymnNotes(ST, PLAN);

        expect(status).toMatchObject({ kind: "ready", category: { id: "601" } });
        // No note is in "Hymn Numbers", so every song with numbers gets one.
        expect(
            status.kind === "ready" && status.items.map(({ action, content }) => [action, content])
        ).toEqual([
            ["create", "R-396 / G-317 · ST. ANNE"],
            ["create", "R-12 · NEW BRITAIN"],
            ["none", null],
            ["create", "R-396 / G-317 · ST. ANNE"],
            ["create", "R-12 · NEW BRITAIN"],
        ]);
    });

    test("says the category is missing, naming the service type", async () => {
        stubFetchRoutes(readRoutes(["Band", "Vocals"]));
        await expect(previewHymnNotes(ST, PLAN)).resolves.toEqual({
            kind: "no-category",
            categoryName: "Hymnal",
            message: 'Create an item note category named "Hymnal" in Planning Center for Sunday Morning.',
        });
    });

    test("refuses a service type with several categories of the name, writing nothing", async () => {
        const fetchMock = stubFetchRoutes(readRoutes(["Hymnal", "Band", "hymnal"]));
        await expect(previewHymnNotes(ST, PLAN)).resolves.toMatchObject({
            kind: "unavailable",
            reason: "ambiguous-category",
            categoryName: "Hymnal",
            categories: [
                { id: HYMNAL, name: "Hymnal" },
                { id: "512", name: "hymnal" },
            ],
        });
        expect(writesSent(fetchMock)).toEqual([]);
    });

    test("says why when the categories cannot be read", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        stubFetchRoutes({ ...readRoutes(), [urls.categories()]: () => json({}, { status: 500 }) });
        await expect(previewHymnNotes(ST, PLAN)).resolves.toMatchObject({
            kind: "unavailable",
            reason: "categories",
        });
    });

    test("says why when the catalog cannot be read", async () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        const cause = new Error("no such table: entries");
        failQueries("FROM entries", cause);
        stubFetchRoutes(readRoutes());
        await expect(previewHymnNotes(ST, PLAN)).resolves.toEqual({
            kind: "unavailable",
            reason: "catalog",
            message: "The catalog is unavailable: no such table: entries. Hymnal notes can't be compared.",
        });
        expect(consoleError).toHaveBeenCalledWith(
            `Failed to read the catalog links of plan ${ST}/${PLAN}:`,
            cause
        );
    });

    test("says the settings could not be read rather than compare by the defaults", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        failQueries("FROM settings", new Error("database disk image is malformed"));
        stubFetchRoutes(readRoutes());
        await expect(previewHymnNotes(ST, PLAN)).resolves.toEqual({
            kind: "unavailable",
            reason: "settings",
            message:
                "The settings could not be read: database disk image is malformed. Hymnal notes can't be compared without them, since the category and what a note says are settings.",
        });
    });

    test("lets a missing plan's PcoError through", async () => {
        stubFetchRoutes({ ...readRoutes(), [urls.items]: () => json({ errors: [] }, { status: 404 }) });
        await expect(previewHymnNotes(ST, PLAN)).rejects.toMatchObject({ name: "PcoError", status: 404 });
    });
});

describe("syncHymnNotes", () => {
    test("makes each item's changes in order, one at a time, unpaced", async () => {
        seedAppNotes(...APP_NOTES);
        const pacer = stubPcoPacer();
        const acquire = vi.spyOn(pacer, "acquire");
        const fetchMock = stubFetchRoutes({ ...readRoutes(), ...writeRoutes() });

        const result = await syncHymnNotes(ST, PLAN);

        expect(writesSent(fetchMock)).toEqual([
            {
                method: "POST",
                url: urls.notes("1"),
                body: {
                    data: {
                        type: "ItemNote",
                        attributes: { content: "R-396 / G-317", item_note_category_id: HYMNAL },
                    },
                },
            },
            {
                method: "PATCH",
                url: urls.note("2", "9002"),
                body: { data: { type: "ItemNote", attributes: { content: "R-12" } } },
            },
            { method: "DELETE", url: urls.note("3", "9003"), body: undefined },
            { method: "DELETE", url: urls.note("4", "9005"), body: undefined },
        ]);
        expect(acquire).not.toHaveBeenCalled();
        expect(result).toMatchObject({
            ok: true,
            category: { id: HYMNAL, name: "Hymnal" },
            counts: { created: 1, updated: 1, deleted: 2, unchanged: 1, kept: 0, failed: 0 },
        });
        expect(
            result.ok && result.items.map(({ itemId, action, outcome, made, error }) => [itemId, action, outcome, made.length, error])
        ).toEqual([
            ["1", "create", "done", 1, null],
            ["2", "update", "done", 1, null],
            ["3", "delete", "done", 1, null],
            ["4", "dedupe", "done", 1, null],
            ["5", "unchanged", "nothing-to-do", 0, null],
        ]);
    });

    test("records a write_log row for each change, with what it asked for and what came of it", async () => {
        seedAppNotes(...APP_NOTES);
        const mark = lastWriteId();
        stubFetchRoutes({ ...readRoutes(), ...writeRoutes() });

        await syncHymnNotes(ST, PLAN);

        const ids = { serviceTypeId: ST, planId: PLAN };
        expect(
            writesAfter(mark).map(({ kind, target, ok, payload, result }) => ({ kind, target, ok, payload, result }))
        ).toEqual([
            {
                kind: "item-note",
                target: `plan ${PLAN} item 1`,
                ok: true,
                payload: { ...ids, itemId: "1", action: "create", categoryId: HYMNAL, content: "R-396 / G-317" },
                result: {
                    note: { id: "9101", categoryId: HYMNAL, categoryName: "Hymnal", content: "R-396 / G-317" },
                },
            },
            {
                kind: "item-note",
                target: `plan ${PLAN} item 2`,
                ok: true,
                payload: { ...ids, itemId: "2", action: "update", noteId: "9002", previous: "R-99", content: "R-12" },
                result: { note: { id: "9002", categoryId: HYMNAL, categoryName: "Hymnal", content: "R-12" } },
            },
            {
                kind: "item-note",
                target: `plan ${PLAN} item 3`,
                ok: true,
                payload: {
                    ...ids,
                    itemId: "3",
                    action: "delete",
                    noteId: "9003",
                    previous: "R-5",
                    reason: "nothing-to-say",
                },
                result: { deleted: "9003" },
            },
            {
                kind: "item-note",
                target: `plan ${PLAN} item 4`,
                ok: true,
                payload: {
                    ...ids,
                    itemId: "4",
                    action: "delete",
                    noteId: "9005",
                    previous: "R-396",
                    reason: "duplicate",
                },
                result: { deleted: "9005" },
            },
        ]);
    });

    test("reads the items afresh and writes what is needed then, not what a preview showed", async () => {
        seedAppNotes(...APP_NOTES);
        let reads = 0;
        const fetchMock = stubFetchRoutes({
            ...readRoutes(),
            ...writeRoutes(),
            [urls.items]: () => {
                reads += 1;
                // By the second read, someone has fixed item 2's note and
                // deleted item 3's in Planning Center.
                const page = planItems();
                if (reads > 1) {
                    page.included = (page.included as Included[]).map((resource) =>
                        resource.id === "9002" ? hymnalNote("9002", "R-12") : resource
                    );
                    page.data[2] = itemResource("3", { title: "A Song Not In The Hymnbooks", sequence: 3 }, songLink("99"));
                }
                return json(page);
            },
        });

        const preview = await previewHymnNotes(ST, PLAN);
        expect(preview.kind === "ready" && preview.items.map(({ action }) => action)).toEqual([
            "create",
            "update",
            "delete",
            "dedupe",
            "unchanged",
        ]);
        const result = await syncHymnNotes(ST, PLAN);

        expect(reads).toBe(2);
        expect(writesSent(fetchMock).map(({ method, url }) => `${method} ${url}`)).toEqual([
            `POST ${urls.notes("1")}`,
            `DELETE ${urls.note("4", "9005")}`,
        ]);
        expect(result.ok && result.items.map(({ action }) => action)).toEqual([
            "create",
            "unchanged",
            "none",
            "dedupe",
            "unchanged",
        ]);
    });

    test("goes on past an item whose change fails, and logs Planning Center's reasons", async () => {
        seedAppNotes(...APP_NOTES);
        const mark = lastWriteId();
        vi.spyOn(console, "error").mockImplementation(() => {});
        const fetchMock = stubFetchRoutes({
            ...readRoutes(),
            ...writeRoutes(),
            [`POST ${urls.notes("1")}`]: () =>
                json(
                    {
                        errors: [
                            {
                                status: "422",
                                title: "Validation Error",
                                detail: "must exist",
                                source: { parameter: "category" },
                            },
                        ],
                    },
                    { status: 422 }
                ),
        });

        const result = await syncHymnNotes(ST, PLAN);

        expect(writesSent(fetchMock)).toHaveLength(4);
        expect(result).toMatchObject({
            ok: true,
            counts: { created: 0, updated: 1, deleted: 2, unchanged: 1, kept: 0, failed: 1 },
        });
        expect(result.ok && result.items[0]).toMatchObject({
            itemId: "1",
            outcome: "failed",
            made: [],
            error: "category: must exist",
        });
        expect(writesAfter(mark)[0]).toMatchObject({
            target: `plan ${PLAN} item 1`,
            ok: false,
            payload: { action: "create", content: "R-396 / G-317" },
            result: { error: "category: must exist", status: 422, details: ["category: must exist"] },
        });
    });

    test("stops at Planning Center's first 429, and tries none of the later items' writes", async () => {
        seedAppNotes(...APP_NOTES);
        stubPcoPacer();
        vi.spyOn(console, "error").mockImplementation(() => {});
        const mark = lastWriteId();
        // No Retry-After, so the client does not retry it.
        const fetchMock = stubFetchRoutes({
            ...readRoutes(),
            ...writeRoutes(),
            [`PATCH ${urls.note("2", "9002")}`]: () => json({ errors: [] }, { status: 429 }),
        });

        const result = await syncHymnNotes(ST, PLAN);

        expect(writesSent(fetchMock).map(({ method, url }) => `${method} ${url}`)).toEqual([
            `POST ${urls.notes("1")}`,
            `PATCH ${urls.note("2", "9002")}`,
        ]);
        expect(result.ok && result.items.map(({ itemId, outcome, made }) => [itemId, outcome, made.length])).toEqual([
            ["1", "done", 1],
            ["2", "failed", 0],
            ["3", "not-attempted", 0],
            ["4", "not-attempted", 0],
            ["5", "nothing-to-do", 0],
        ]);
        expect(result.ok && result.items[1].error).toMatch(/status: 429/);
        expect(result).toMatchObject({
            ok: true,
            counts: { created: 1, updated: 0, deleted: 0, unchanged: 1, failed: 1, notAttempted: 2 },
        });
        // Only the writes sent are logged.
        expect(
            writesAfter(mark).map(({ ok, result: logged }) => [ok, (logged as { status?: number }).status ?? null])
        ).toEqual([
            [true, null],
            [false, 429],
        ]);
    });

    test("stops an item at its first failed change, and tries none of its others", async () => {
        seedAppNotes(...APP_NOTES);
        vi.spyOn(console, "error").mockImplementation(() => {});
        const page = planItems();
        // Item 4's first note is stale too: update it, then delete the extra.
        page.included = (page.included as Included[]).map((resource) =>
            resource.id === "9004" ? hymnalNote("9004", "R-1") : resource
        );
        const fetchMock = stubFetchRoutes({
            ...readRoutes(),
            ...writeRoutes(),
            [urls.items]: page,
            [`PATCH ${urls.note("4", "9004")}`]: () => json({ errors: [] }, { status: 404 }),
        });

        const result = await syncHymnNotes(ST, PLAN);

        expect(writesSent(fetchMock).map(({ url }) => url)).not.toContain(urls.note("4", "9005"));
        expect(result.ok && result.items[3]).toMatchObject({
            itemId: "4",
            action: "update",
            outcome: "failed",
            made: [],
            error: expect.stringContaining("status: 404"),
        });
        expect(recentWrites(db)[0]).toMatchObject({ ok: false, result: { status: 404 } });
    });

    test("keeps going when a write cannot be recorded, and logs that", async () => {
        seedAppNotes(...APP_NOTES);
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        const prepare = db.prepare.bind(db);
        vi.spyOn(db, "prepare").mockImplementation((sql: string) => {
            if (sql.startsWith("INSERT INTO write_log")) {
                throw new Error("disk I/O error");
            }
            return prepare(sql);
        });
        const fetchMock = stubFetchRoutes({ ...readRoutes(), ...writeRoutes() });

        const result = await syncHymnNotes(ST, PLAN);

        expect(writesSent(fetchMock)).toHaveLength(4);
        expect(result).toMatchObject({ ok: true, counts: { failed: 0 } });
        expect(consoleError).toHaveBeenCalledWith(
            `Failed to record a write to Planning Center (plan ${PLAN} item 1):`,
            expect.objectContaining({ message: "disk I/O error" })
        );
    });

    test("leaves alone the hymnal notes the app did not write: on a song with nothing to say, and as an extra", async () => {
        // The write log has no record of the notes on items 3 and 4: typed
        // by hand, or written before a restore lost the log's history.
        const mark = lastWriteId();
        const fetchMock = stubFetchRoutes({ ...readRoutes(), ...writeRoutes() });

        const result = await syncHymnNotes(ST, PLAN);

        expect(writesSent(fetchMock).map(({ method, url }) => `${method} ${url}`)).toEqual([
            `POST ${urls.notes("1")}`,
            `PATCH ${urls.note("2", "9002")}`,
        ]);
        expect(result).toMatchObject({
            ok: true,
            counts: { created: 1, updated: 1, deleted: 0, unchanged: 3, kept: 2, failed: 0 },
        });
        expect(
            result.ok &&
                result.items.slice(2).map(({ itemId, action, outcome, keep }) => [itemId, action, outcome, keep])
        ).toEqual([
            ["3", "keep", "nothing-to-do", [{ kind: "keep", noteId: "9003", content: "R-5", reason: "nothing-to-say" }]],
            ["4", "unchanged", "nothing-to-do", [{ kind: "keep", noteId: "9005", content: "R-396", reason: "duplicate" }]],
            ["5", "unchanged", "nothing-to-do", []],
        ]);
        // Nothing is logged for a note left alone.
        expect(writesAfter(mark).map(({ payload }) => (payload as { action: string }).action)).toEqual([
            "create",
            "update",
        ]);
    });

    test("deletes a note it created in an earlier sync once its song has nothing to say", async () => {
        stubFetchRoutes({ ...readRoutes(), ...writeRoutes() });
        await syncHymnNotes(ST, PLAN);
        // Song 77 loses its link; Planning Center now has the note the first
        // sync created on item 1 (9101) and the update it made to item 2's.
        db.prepare("UPDATE songs SET pco_song_id = NULL WHERE pco_song_id = '77'").run();
        const page = planItems();
        page.data[0] = itemResource("1", { title: "O God, Our Help", sequence: 1 }, {
            ...songLink("77"),
            ...noteLinks("9101"),
        });
        page.included = (page.included as Included[])
            .map((resource) => (resource.id === "9002" ? hymnalNote("9002", "R-12") : resource))
            .concat([hymnalNote("9101", "R-396 / G-317")]);
        const fetchMock = stubFetchRoutes({
            ...readRoutes(),
            [urls.items]: page,
            [`DELETE ${urls.note("1", "9101")}`]: () => new Response(null, { status: 204 }),
        });

        const result = await syncHymnNotes(ST, PLAN);

        // Its own note goes; item 4's two, which it did not write, stay.
        expect(writesSent(fetchMock)).toEqual([
            { method: "DELETE", url: urls.note("1", "9101"), body: undefined },
        ]);
        expect(result.ok && result.items.map(({ action }) => action)).toEqual([
            "delete",
            "unchanged",
            "keep",
            "keep",
            "unchanged",
        ]);
    });

    describe("with the plan the preview showed", () => {
        /** The preview's items, as the dialog would pass them back. */
        async function previewItems() {
            const status = await previewHymnNotes(ST, PLAN);
            if (status.kind !== "ready") {
                throw new Error(`The preview is ${status.kind}`);
            }
            return JSON.parse(JSON.stringify(status.items));
        }

        test("writes what the preview showed when nothing changed since", async () => {
            seedAppNotes(...APP_NOTES);
            const fetchMock = stubFetchRoutes({ ...readRoutes(), ...writeRoutes() });
            const previewed = await previewItems();

            const result = await syncHymnNotes(ST, PLAN, previewed);

            expect(writesSent(fetchMock).map(({ method, url }) => `${method} ${url}`)).toEqual([
                `POST ${urls.notes("1")}`,
                `PATCH ${urls.note("2", "9002")}`,
                `DELETE ${urls.note("3", "9003")}`,
                `DELETE ${urls.note("4", "9005")}`,
            ]);
            expect(result).toMatchObject({ ok: true, counts: { changed: 0, failed: 0 } });
        });

        test("writes only the items still as previewed, and reports the others as changed", async () => {
            seedAppNotes(...APP_NOTES);
            let reads = 0;
            const fetchMock = stubFetchRoutes({
                ...readRoutes(),
                ...writeRoutes(),
                [urls.items]: () => {
                    reads += 1;
                    const page = planItems();
                    if (reads > 1) {
                        // Since the preview: someone retyped item 2's note, and
                        // deleted item 3's.
                        page.included = (page.included as Included[]).map((resource) =>
                            resource.id === "9002" ? hymnalNote("9002", "R-77") : resource
                        );
                        page.data[2] = itemResource("3", { title: "A Song Not In The Hymnbooks", sequence: 3 }, songLink("99"));
                    }
                    return json(page);
                },
            });
            const previewed = await previewItems();

            const result = await syncHymnNotes(ST, PLAN, previewed);

            // Item 2 would now change "R-77", not the "R-99" the preview
            // showed; item 3 has no note left to delete.
            expect(writesSent(fetchMock).map(({ method, url }) => `${method} ${url}`)).toEqual([
                `POST ${urls.notes("1")}`,
                `DELETE ${urls.note("4", "9005")}`,
            ]);
            expect(
                result.ok && result.items.map(({ itemId, action, outcome, made }) => [itemId, action, outcome, made.length])
            ).toEqual([
                ["1", "create", "done", 1],
                ["2", "update", "changed", 0],
                ["3", "none", "changed", 0],
                ["4", "dedupe", "done", 1],
                ["5", "unchanged", "nothing-to-do", 0],
            ]);
            expect(result).toMatchObject({
                ok: true,
                counts: { created: 1, updated: 0, deleted: 1, unchanged: 1, failed: 0, changed: 2 },
            });
        });

        test("does not write an item the preview did not have", async () => {
            const fetchMock = stubFetchRoutes({ ...readRoutes(), ...writeRoutes() });
            const previewed = (await previewItems()).filter(({ itemId }: { itemId: string }) => itemId !== "1");

            const result = await syncHymnNotes(ST, PLAN, previewed);

            expect(writesSent(fetchMock).map(({ url }) => url)).not.toContain(urls.notes("1"));
            expect(result.ok && result.items[0]).toMatchObject({ itemId: "1", outcome: "changed", made: [] });
        });

        test("writes nothing for a previewed plan that is not one", async () => {
            seedAppNotes(...APP_NOTES);
            for (const previewed of [
                "all of them",
                [{ itemId: "1", action: "create", changes: "all" }],
                [null],
                [],
            ]) {
                const fetchMock = stubFetchRoutes({ ...readRoutes(), ...writeRoutes() });

                const result = await syncHymnNotes(ST, PLAN, previewed as never);

                expect(writesSent(fetchMock)).toEqual([]);
                expect(result.ok && result.items.map(({ outcome }) => outcome)).toEqual([
                    "changed",
                    "changed",
                    "changed",
                    "changed",
                    "changed",
                ]);
            }
        });
    });

    test("refuses when the category is missing, and writes nothing", async () => {
        const fetchMock = stubFetchRoutes({ ...readRoutes(["Band"]), ...writeRoutes() });

        await expect(syncHymnNotes(ST, PLAN)).resolves.toEqual({
            ok: false,
            kind: "no-category",
            message: 'Create an item note category named "Hymnal" in Planning Center for Sunday Morning.',
        });
        expect(writesSent(fetchMock)).toEqual([]);
        expect(recentWrites(db)).toEqual([]);
    });

    test("refuses a service type with several categories of the name, and writes nothing", async () => {
        seedAppNotes(...APP_NOTES);
        const fetchMock = stubFetchRoutes({ ...readRoutes(["Hymnal", "hymnal"]), ...writeRoutes() });

        await expect(syncHymnNotes(ST, PLAN)).resolves.toEqual({
            ok: false,
            kind: "unavailable",
            message:
                'Sunday Morning has 2 item note categories named "Hymnal" ("Hymnal" and "hymnal"), so the hymnal notes have no one place to go. Rename or delete all but one in Planning Center.',
        });
        expect(writesSent(fetchMock)).toEqual([]);
    });

    test("never writes to a note of another category with the name, such as a deleted one's", async () => {
        // Item 1's note is in a deleted "Hymnal" category (999), which
        // getItemNoteCategories leaves out; its note keeps the name. The app
        // wrote it, and it is stale, yet it is not the live category's note.
        seedAppNotes("9009");
        const page = planItems();
        page.data[0] = itemResource("1", { title: "O God, Our Help", sequence: 1 }, {
            ...songLink("77"),
            ...noteLinks("9009"),
        });
        page.included = (page.included as Included[]).concat([
            itemNoteResource("9009", { category_name: "Hymnal", content: "R-1" }, "999"),
        ]);
        const fetchMock = stubFetchRoutes({ ...readRoutes(), ...writeRoutes(), [urls.items]: page });

        const result = await syncHymnNotes(ST, PLAN);

        const sent = writesSent(fetchMock);
        expect(sent[0]).toEqual({
            method: "POST",
            url: urls.notes("1"),
            body: {
                data: {
                    type: "ItemNote",
                    attributes: { content: "R-396 / G-317", item_note_category_id: HYMNAL },
                },
            },
        });
        expect(sent.map(({ url }) => url)).not.toContain(urls.note("1", "9009"));
        expect(result.ok && result.items[0]).toMatchObject({ itemId: "1", action: "create", keep: [] });
    });

    test("refuses when the categories cannot be read, and writes nothing", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        const fetchMock = stubFetchRoutes({
            ...readRoutes(),
            ...writeRoutes(),
            [urls.categories()]: () => json({}, { status: 503 }),
        });

        await expect(syncHymnNotes(ST, PLAN)).resolves.toMatchObject({ ok: false, kind: "unavailable" });
        expect(writesSent(fetchMock)).toEqual([]);
    });

    test("refuses, writing nothing, when the settings cannot be read", async () => {
        // With the tune setting saved, the defaults would rewrite every note
        // without it; a custom category name would fall back to "Hymnal".
        vi.spyOn(console, "error").mockImplementation(() => {});
        seedSetting(db, "hymnNoteIncludesTune", true);
        seedAppNotes(...APP_NOTES);
        failQueries("FROM settings", new Error("database disk image is malformed"));
        const fetchMock = stubFetchRoutes({ ...readRoutes(), ...writeRoutes() });

        await expect(syncHymnNotes(ST, PLAN)).resolves.toEqual({
            ok: false,
            kind: "unavailable",
            message:
                "The settings could not be read: database disk image is malformed. Hymnal notes can't be compared without them, since the category and what a note says are settings.",
        });
        expect(writesSent(fetchMock)).toEqual([]);
    });

    test("refuses the same way when the database cannot be opened at all", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        getDb.mockImplementation(() => {
            throw new Error("Could not open the database at /srv/data/x: denied");
        });
        const fetchMock = stubFetchRoutes({ ...readRoutes(), ...writeRoutes() });

        await expect(syncHymnNotes(ST, PLAN)).resolves.toMatchObject({ ok: false, kind: "unavailable" });
        expect(writesSent(fetchMock)).toEqual([]);
    });

    test("throws before writing anything when the catalog cannot be read", async () => {
        const cause = new Error("no such table: entries");
        failQueries("FROM entries", cause);
        const fetchMock = stubFetchRoutes({ ...readRoutes(), ...writeRoutes() });

        await expect(syncHymnNotes(ST, PLAN)).rejects.toBe(cause);
        expect(writesSent(fetchMock)).toEqual([]);
    });

    test("a second sync finds every note in step and writes nothing", async () => {
        const page = planItems();
        page.included = (page.included as Included[])
            .map((resource) => (resource.id === "9002" ? hymnalNote("9002", "R-12") : resource))
            .filter((resource) => !["9003", "9005"].includes(resource.id))
            .concat([hymnalNote("9101", "R-396 / G-317")]);
        page.data[0] = itemResource("1", { title: "O God, Our Help", sequence: 1 }, {
            ...songLink("77"),
            ...noteLinks("9101"),
        });
        page.data[2] = itemResource("3", { title: "A Song Not In The Hymnbooks", sequence: 3 }, songLink("99"));
        page.data[3] = itemResource("4", { title: "O God, Our Help (reprise)", sequence: 4 }, {
            ...songLink("77"),
            ...noteLinks("9004"),
        });
        const fetchMock = stubFetchRoutes({ ...readRoutes(), [urls.items]: page });

        const result = await syncHymnNotes(ST, PLAN);

        expect(writesSent(fetchMock)).toEqual([]);
        expect(result).toMatchObject({
            ok: true,
            counts: { created: 0, updated: 0, deleted: 0, unchanged: 5, kept: 0, failed: 0 },
        });
    });

    test("checks the ids before it reads anything", async () => {
        const fetchMock = stubFetchRoutes({});
        await expect(syncHymnNotes("x", PLAN)).rejects.toBeInstanceOf(InvalidPcoIdError);
        await expect(syncHymnNotes(ST, "01")).rejects.toBeInstanceOf(InvalidPcoIdError);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe("syncHymnNotes, one sync per plan at a time", () => {
    /** A promise the test opens when it likes: a read that waits on it holds a sync mid-flight. */
    function gate(): { opened: Promise<void>; open: () => void } {
        let open = () => {};
        const opened = new Promise<void>((resolve) => {
            open = resolve;
        });
        return { opened, open };
    }

    /** The plan's reads and writes, with its items read held until `opened`. */
    function heldRoutes(opened: Promise<void>): Record<string, unknown> {
        return {
            ...readRoutes(),
            ...writeRoutes(),
            [urls.items]: () => opened.then(() => json(planItems())),
        };
    }

    test("refuses a second sync of a plan while its first runs, and writes nothing for it", async () => {
        const { opened, open } = gate();
        const fetchMock = stubFetchRoutes(heldRoutes(opened));

        const first = syncHymnNotes(ST, PLAN);
        const second = await syncHymnNotes(ST, PLAN);

        expect(second).toEqual({ ok: false, kind: "busy", message: SYNC_IN_PROGRESS_MESSAGE });
        open();
        await expect(first).resolves.toMatchObject({ ok: true, counts: { created: 1 } });
        // Item 1's note was created once.
        expect(writesSent(fetchMock).filter(({ method }) => method === "POST")).toHaveLength(1);
        // Once it is done, the plan can be synced again.
        await expect(syncHymnNotes(ST, PLAN)).resolves.toMatchObject({ ok: true });
    });

    test("keeps the syncs in progress on globalThis, so another copy of the module sees them", async () => {
        const { opened, open } = gate();
        stubFetchRoutes(heldRoutes(opened));
        vi.resetModules();
        const copy = await import("./hymnNotes");

        const first = syncHymnNotes(ST, PLAN);

        await expect(copy.syncHymnNotes(ST, PLAN)).resolves.toMatchObject({ ok: false, kind: "busy" });
        open();
        await first;
    });

    test("lets syncs of different plans run together", async () => {
        const other = "81234599";
        const { opened, open } = gate();
        stubFetchRoutes({
            ...heldRoutes(opened),
            [`${PCO_BASE}/service_types/${ST}/plans/${other}/items?include=song,item_notes&per_page=100`]:
                listPage([]),
        });

        const first = syncHymnNotes(ST, PLAN);

        await expect(syncHymnNotes(ST, other)).resolves.toMatchObject({ ok: true, items: [] });
        open();
        await expect(first).resolves.toMatchObject({ ok: true });
    });

    test("frees the plan when its sync fails", async () => {
        let status = 500;
        stubFetchRoutes({
            ...readRoutes(),
            ...writeRoutes(),
            [urls.items]: () => (status === 500 ? json({ errors: [] }, { status }) : json(planItems())),
        });

        await expect(syncHymnNotes(ST, PLAN)).rejects.toMatchObject({ name: "PcoError", status: 500 });
        status = 200;
        await expect(syncHymnNotes(ST, PLAN)).resolves.toMatchObject({ ok: true });
    });
});

describe("getHymnNoteCategories", () => {
    function serviceTypes() {
        return listPage([
            serviceTypeResource({ name: "Sunday Morning" }, ST),
            serviceTypeResource({ name: "Sunday Evening", sequence: 2 }, EVENING),
            serviceTypeResource({ name: "Old Service", archived_at: "2024-01-01T00:00:00Z" }, "1300000"),
        ]);
    }

    test("says, for each service type not archived, whether it has the category", async () => {
        const fetchMock = stubFetchRoutes({
            [urls.serviceTypes]: serviceTypes(),
            [urls.categories(ST)]: categories("Band", "Hymnal"),
            [urls.categories(EVENING)]: categories("Band"),
        });

        const result = await getHymnNoteCategories();

        expect(result.ok && result.categoryName).toBe("Hymnal");
        expect(
            result.ok && result.serviceTypes.map(({ serviceType, category }) => [serviceType.name, category])
        ).toEqual([
            ["Sunday Morning", { status: "found", category: { id: HYMNAL, name: "Hymnal" } }],
            [
                "Sunday Evening",
                {
                    status: "missing",
                    message: 'Create an item note category named "Hymnal" in Planning Center for Sunday Evening.',
                },
            ],
        ]);
        expect(calledUrls(fetchMock)).toHaveLength(3);
    });

    test("finds the category the settings name", async () => {
        seedSetting(db, "hymnNoteCategoryName", "Band");
        stubFetchRoutes({
            [urls.serviceTypes]: serviceTypes(),
            [urls.categories(ST)]: categories("Band", "Hymnal"),
            [urls.categories(EVENING)]: categories("Band"),
        });
        const result = await getHymnNoteCategories();
        expect(result.ok && result.serviceTypes.map(({ category }) => category.status)).toEqual([
            "found",
            "found",
        ]);
    });

    test("says when a service type has several categories of the name", async () => {
        stubFetchRoutes({
            [urls.serviceTypes]: serviceTypes(),
            [urls.categories(ST)]: categories("Hymnal", "hymnal"),
            [urls.categories(EVENING)]: categories("Hymnal"),
        });
        const result = await getHymnNoteCategories();
        expect(result.ok && result.serviceTypes.map(({ category }) => category)).toEqual([
            {
                status: "ambiguous",
                categories: [
                    { id: HYMNAL, name: "Hymnal" },
                    { id: "511", name: "hymnal" },
                ],
                message:
                    'Sunday Morning has 2 item note categories named "Hymnal" ("Hymnal" and "hymnal"), so the hymnal notes have no one place to go. Rename or delete all but one in Planning Center.',
            },
            { status: "found", category: { id: HYMNAL, name: "Hymnal" } },
        ]);
    });

    test("says why for a service type whose categories cannot be read", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        stubFetchRoutes({
            [urls.serviceTypes]: serviceTypes(),
            [urls.categories(ST)]: categories("Hymnal"),
            [urls.categories(EVENING)]: () => json({}, { status: 500 }),
        });
        const result = await getHymnNoteCategories();
        expect(result.ok && result.serviceTypes[1].category).toEqual({
            status: "unavailable",
            error: expect.stringContaining("status: 500"),
        });
    });

    test("never throws: says why when the service types cannot be read", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        stubFetchRoutes({ [urls.serviceTypes]: () => json({}, { status: 500 }) });
        await expect(getHymnNoteCategories()).resolves.toEqual({
            ok: false,
            error: expect.stringContaining("status: 500"),
        });
    });
});
