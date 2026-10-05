import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
    openTestDb,
    seedBook,
    seedEntry,
    seedHistoryPlan,
    seedHymn,
    seedOccurrence,
    seedPcoSong,
    seedScheduleSelection,
    seedSetting,
    seedSong,
    seedTune,
    seedWriteLog,
} from "@/lib/db/testing";
import {
    PCO_BASE,
    calledUrls,
    itemNoteCategoryResource,
    itemNoteResource,
    itemResource,
    json,
    listPage,
    noteLinks,
    planResource,
    serviceTypeResource,
    songResource,
    stubFetchRoutes,
    stubPcoCredentials,
} from "@/lib/pco/testing";
import { mergeScheduleSelections } from "@/lib/scheduleSelections";
import { buildScheduleCopyText } from "@/lib/serviceSchedule";
import { DEFAULT_SETTINGS } from "@/lib/settings";

// vi.hoisted: vi.mock factories run before the module's own declarations.
const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/lib/db", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/db")>()),
    getDb,
}));

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
    items: `${PCO_BASE}/service_types/${MORNING}/plans/${PLAN}/items?include=song,item_notes&per_page=100`,
    categories: `${PCO_BASE}/service_types/${MORNING}/item_note_categories?per_page=100`,
};

const songLink = (id: string) => ({ song: { data: { type: "Song" as const, id } } });

/** The four PCO responses behind a plan's detail view. */
function planDetailRoutes(): Record<string, unknown> {
    return {
        [urls.categories]: listPage([
            itemNoteCategoryResource("501", { name: "Band" }),
            itemNoteCategoryResource("503", { name: "Hymnal" }),
        ]),
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

let db: DatabaseSync;

beforeEach(() => {
    stubPcoCredentials();
    db = openTestDb();
    getDb.mockReturnValue(db);
});

afterEach(() => {
    db.close();
    getDb.mockReset();
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
    test("loads the plan, its service type, its items and the type's item note categories", async () => {
        const fetchMock = stubFetchRoutes(planDetailRoutes());
        const { getPlanDetail } = await loadQueries();

        const { plan, serviceType, items } = await getPlanDetail(MORNING, PLAN);

        // The categories, for the hymnal notes' status, are the fourth request.
        expect(calledUrls(fetchMock).sort()).toEqual(
            [urls.plan, urls.serviceType, urls.items, urls.categories].sort()
        );
        expect(plan).toMatchObject({ id: PLAN, serviceTypeId: MORNING, dates: "October 4, 2026" });
        expect(serviceType).toMatchObject({ id: MORNING, name: "Sunday Morning" });
        expect(items.map((item) => [item.id, item.song?.id ?? null])).toEqual([
            ["1", null],
            ["2", "20"],
            ["3", "30"],
            ["4", "40"],
        ]);
    });

    test("finds no catalog links in an empty catalog, and nothing to suggest", async () => {
        stubFetchRoutes(planDetailRoutes());
        const { getPlanDetail } = await loadQueries();

        const { catalog, suggestions, catalogError } = await getPlanDetail(MORNING, PLAN);

        expect(catalog).toEqual({});
        expect(suggestions).toEqual({ "20": [], "30": [], "40": [] });
        expect(catalogError).toBeNull();
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

describe("getPlanDetail's repeat warnings", () => {
    // Noon by the clock of the machine the tests run on, so the date is the same in every time zone.
    const TODAY = new Date(2026, 9, 4, 12, 0, 0);

    /** The plan's items: songs 20, 30 and 40 at items 2, 3 and 4, and a header. */
    const detailRoutes = () => planDetailRoutes();

    /** A past or upcoming plan of the history holding Planning Center songs `songs`. */
    function plan(planId: string, planDate: string, ...songs: string[]): void {
        seedHistoryPlan(db, { planId, planDate });
        for (const pcoSongId of songs) {
            seedOccurrence(db, { planId, pcoSongId });
        }
    }

    beforeEach(() => {
        // Only the date: the stubbed fetches and the loaded modules need real timers.
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(TODAY);
    });

    async function warnings() {
        stubFetchRoutes(detailRoutes());
        const { getPlanDetail } = await loadQueries();
        return (await getPlanDetail(MORNING, PLAN)).repeatWarnings;
    }

    test("warns on each song item whose song was last sung within 6 weeks, with the plan and how long ago", async () => {
        plan("501", "2026-09-27", "20");
        plan("502", "2026-09-20", "30", "20");
        plan("503", "2026-08-23", "40");

        expect(await warnings()).toEqual({
            // Song 20 was sung on the 27th and the 20th: the last counts.
            "2": { planId: "501", serviceTypeId: MORNING, planDate: "2026-09-27", daysAgo: 7 },
            "3": { planId: "502", serviceTypeId: MORNING, planDate: "2026-09-20", daysAgo: 14 },
            // Exactly 6 weeks ago is within the window.
            "4": { planId: "503", serviceTypeId: MORNING, planDate: "2026-08-23", daysAgo: 42 },
        });
    });

    test("leaves out a song not sung within the window, one only scheduled, and an item that is no song", async () => {
        plan("501", "2026-08-22", "20");
        plan("502", "2026-10-04", "30");
        plan("503", "2026-10-11", "40");
        plan("504", "2026-09-27", "99");
        expect(await warnings()).toEqual({});
    });

    test("leaves out this plan itself, and gives the plan before it", async () => {
        // The plan being looked at is in the history too, as a past plan.
        plan(PLAN, "2026-09-27", "20");
        plan("502", "2026-09-13", "20");
        const result = await warnings();
        expect(result["2"]).toMatchObject({ planId: "502", planDate: "2026-09-13", daysAgo: 21 });
    });

    test("gives nothing for a history never synced", async () => {
        expect(await warnings()).toEqual({});
    });

    test("follows the setting's weeks: a narrower window leaves out older plans, a wider one takes them in", async () => {
        plan("501", "2026-09-27", "20");
        plan("502", "2026-09-06", "30");
        plan("503", "2026-06-07", "40");

        seedSetting(db, "repeatWarningWeeks", 2);
        expect(Object.keys(await warnings())).toEqual(["2"]);

        db.prepare("UPDATE settings SET value = '4' WHERE key = 'repeatWarningWeeks'").run();
        expect(Object.keys(await warnings()).sort()).toEqual(["2", "3"]);

        db.prepare("UPDATE settings SET value = '52' WHERE key = 'repeatWarningWeeks'").run();
        expect(Object.keys(await warnings()).sort()).toEqual(["2", "3", "4"]);
    });

    test("is off at 0 weeks, and asks the database nothing", async () => {
        plan("501", "2026-09-27", "20", "30", "40");
        seedSetting(db, "repeatWarningWeeks", 0);
        stubFetchRoutes(detailRoutes());
        const { getPlanDetail } = await loadQueries();
        const prepare = vi.spyOn(db, "prepare");

        const detail = await getPlanDetail(MORNING, PLAN);

        expect(detail.repeatWarnings).toEqual({});
        // The catalog's own read mentions the history (each song's last sung date); the warnings' does not run.
        expect(
            prepare.mock.calls.some(([sql]) => String(sql).includes("plan_occurrences") && String(sql).includes("json_each"))
        ).toBe(false);
    });

    test("warns by default, as the setting's default is 6 weeks", async () => {
        plan("501", "2026-08-30", "20");
        expect(Object.keys(await warnings())).toEqual(["2"]);
        expect(DEFAULT_SETTINGS.repeatWarningWeeks).toBe(6);
    });

    test("keeps the plan when the history cannot be read: no warnings, and why in the log", async () => {
        plan("501", "2026-09-27", "20");
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        const prepare = db.prepare.bind(db);
        vi.spyOn(db, "prepare").mockImplementation((sql: string) => {
            if (sql.includes("json_each") && sql.includes("plan_occurrences")) {
                throw new Error("no such table: plan_occurrences");
            }
            return prepare(sql);
        });
        stubFetchRoutes(detailRoutes());
        const { getPlanDetail } = await loadQueries();

        const detail = await getPlanDetail(MORNING, PLAN);

        expect(detail.repeatWarnings).toEqual({});
        expect(detail.items).toHaveLength(4);
        expect(consoleError).toHaveBeenCalledWith(
            `Failed to read the repeat warnings of plan ${PLAN}:`,
            expect.objectContaining({ message: "no such table: plan_occurrences" })
        );
    });

    test("is as of the day it is read on", async () => {
        plan("501", "2026-09-27", "20");
        expect((await warnings())["2"]).toMatchObject({ daysAgo: 7 });
        vi.setSystemTime(new Date(2026, 10, 10, 12, 0, 0));
        // 44 days on: out of the window.
        expect(await warnings()).toEqual({});
    });
});

describe("getPlanDetail's catalog links", () => {
    /** Plan routes whose items are these, with these songs included. */
    function routesWith(
        items: ReturnType<typeof itemResource>[],
        included: ReturnType<typeof songResource>[]
    ): Record<string, unknown> {
        return { ...planDetailRoutes(), [urls.items]: listPage(items, { included }) };
    }

    /**
     * Come, Thou Fount to two tunes, and Abide with Me linked to Planning
     * Center song 30, at R-517 and G-64.
     */
    function seedCatalog() {
        const rejoice = seedBook(db, { code: "R", name: "Rejoice Hymns" });
        const great = seedBook(db, { code: "G", name: "Great Hymns of the Faith" });
        const fount = seedHymn(db, { title: "Come, Thou Fount of Every Blessing" });
        const songs = {
            nettleton: seedSong(db, { hymnId: fount, tuneId: seedTune(db, { name: "NETTLETON" }) }),
            warrenton: seedSong(db, { hymnId: fount, tuneId: seedTune(db, { name: "WARRENTON" }) }),
            abide: seedSong(db, {
                hymnId: seedHymn(db, { title: "Abide with Me" }),
                tuneId: seedTune(db, { name: "EVENTIDE" }),
                pcoSongId: "30",
                linkedAt: "2026-10-01T12:00:00.000Z",
                linkedBy: "manual",
            }),
        };
        seedEntry(db, { bookId: great, songId: songs.abide, number: 64 });
        seedEntry(db, { bookId: rejoice, songId: songs.abide, number: 517 });
        seedEntry(db, { bookId: rejoice, songId: songs.nettleton, number: 553 });
        seedEntry(db, { bookId: great, songId: songs.nettleton, number: 17 });
        seedEntry(db, { bookId: rejoice, songId: songs.warrenton, number: 554 });
        seedPcoSong(db, { id: "30", title: "Abide with Me" });
        return songs;
    }

    test("gives each linked song its catalog song, and the others their best suggestions", async () => {
        const songs = seedCatalog();
        stubFetchRoutes(planDetailRoutes());
        const { getPlanDetail } = await loadQueries();

        const { catalog, suggestions } = await getPlanDetail(MORNING, PLAN);

        expect(catalog).toEqual({
            "30": {
                songId: songs.abide,
                title: "Abide with Me",
                tuneName: "EVENTIDE",
                entries: [
                    expect.objectContaining({ label: "R-517" }),
                    expect.objectContaining({ label: "G-64" }),
                ],
            },
        });
        expect(Object.keys(suggestions).sort()).toEqual(["20", "40"]);
        expect(
            suggestions["20"].map(({ songId, tuneName, reason, entries }) => [
                songId,
                tuneName,
                reason,
                entries.map(({ label }) => label),
            ])
        ).toEqual([
            [songs.nettleton, "NETTLETON", "exact", ["R-553", "G-17"]],
            [songs.warrenton, "WARRENTON", "exact", ["R-554"]],
        ]);
        expect(suggestions["40"]).toEqual([]);
    });

    test("leaves a book not in use out of a linked song's numbers", async () => {
        const songs = seedCatalog();
        db.prepare("UPDATE books SET active = 0 WHERE code = 'G'").run();
        stubFetchRoutes(planDetailRoutes());
        const { getPlanDetail } = await loadQueries();

        const { catalog } = await getPlanDetail(MORNING, PLAN);

        expect(catalog["30"]).toMatchObject({
            songId: songs.abide,
            entries: [expect.objectContaining({ label: "R-517" })],
        });
        expect(catalog["30"].entries).toHaveLength(1);
    });

    test("leaves a book not in use out of the schedule text, and a song only in one has no numbers", async () => {
        const songs = seedCatalog();
        db.prepare("UPDATE books SET active = 0 WHERE code = 'R'").run();
        db.prepare("UPDATE songs SET pco_song_id = '20' WHERE id = ?").run(songs.warrenton);
        seedPcoSong(db, { id: "20", title: "Come, Thou Fount of Every Blessing" });
        stubFetchRoutes(planDetailRoutes());
        const { getPlanDetail } = await loadQueries();

        const { items, catalog, plan } = await getPlanDetail(MORNING, PLAN);
        const text = buildScheduleCopyText({
            items: mergeScheduleSelections(items, {}, catalog),
            catalog,
            serviceTypeName: "Sunday Morning",
            planDate: plan.sortDate.slice(0, 10),
        });

        // WARRENTON is only in Rejoice, which is not in use: the song keeps
        // its title, with no numbers.
        expect(text.split("\n")).toEqual([
            "Sunday AM 10/4/26",
            "",
            "Come, Thou Fount of Every Blessing",
            "Abide with Me (G-64)",
            "A Song Not In The Hymnbooks",
        ]);
    });

    test("follows the link and the song's title, not the item's", async () => {
        const songs = seedCatalog();
        stubFetchRoutes(
            routesWith(
                [
                    itemResource("2", { title: "Come Thou Fount (Key of D)", sequence: 1 }, songLink("20")),
                    itemResource("3", { title: "Abide with Me (Acoustic)", sequence: 2 }, songLink("30")),
                    itemResource("5", { title: "Abide with Me, Reprise", sequence: 3 }, songLink("30")),
                ],
                [
                    songResource("20", { title: "Come, Thou Fount of Every Blessing" }),
                    songResource("30", { title: "Abide with Me" }),
                ]
            )
        );
        const { getPlanDetail } = await loadQueries();

        const { catalog, suggestions } = await getPlanDetail(MORNING, PLAN);

        expect(Object.keys(catalog)).toEqual(["30"]);
        expect(catalog["30"].songId).toBe(songs.abide);
        expect(suggestions["20"].map(({ songId }) => songId)).toEqual([
            songs.nettleton,
            songs.warrenton,
        ]);
    });

    test("suggests by the mirror's title when Planning Center sent an item without its song", async () => {
        const songs = seedCatalog();
        seedPcoSong(db, { id: "20", title: "Come, Thou Fount of Every Blessing" });
        stubFetchRoutes(
            routesWith(
                [itemResource("2", { title: "Come Thou Fount (Key of D)" }, songLink("20"))],
                []
            )
        );
        const { getPlanDetail } = await loadQueries();

        const { suggestions } = await getPlanDetail(MORNING, PLAN);

        expect(suggestions["20"].map(({ songId }) => songId)).toEqual([
            songs.nettleton,
            songs.warrenton,
        ]);
    });

    test("suggests nothing for a song set aside as not hymnal material", async () => {
        seedCatalog();
        seedPcoSong(db, {
            id: "40",
            title: "A Song Not In The Hymnbooks",
            ignoredAt: "2026-10-02T12:00:00.000Z",
        });
        stubFetchRoutes(planDetailRoutes());
        const { getPlanDetail } = await loadQueries();

        const { suggestions } = await getPlanDetail(MORNING, PLAN);

        expect(Object.keys(suggestions)).toEqual(["20"]);
    });

    test("asks the database a fixed number of queries, however many songs the plan has", async () => {
        seedCatalog();
        const prepare = vi.spyOn(db, "prepare");
        const { getPlanDetail } = await loadQueries();
        const songItem = (id: string, songId: string, title: string) =>
            itemResource(id, { title, sequence: Number(id) }, songLink(songId));

        stubFetchRoutes(
            routesWith(
                [songItem("1", "20", "Come, Thou Fount of Every Blessing"), songItem("2", "30", "Abide with Me")],
                [songResource("20", { title: "Come, Thou Fount of Every Blessing" })]
            )
        );
        await getPlanDetail(MORNING, PLAN);
        const fewSongs = prepare.mock.calls.length;
        // Seven for the catalog links, one for the saved choices, one for the
        // settings, one for the songs sung lately.
        expect(fewSongs).toBe(10);

        prepare.mockClear();
        stubFetchRoutes(
            routesWith(
                Array.from({ length: 12 }, (_, i) =>
                    songItem(String(i + 1), String(100 + i), `Song ${i}`)
                ),
                []
            )
        );
        await getPlanDetail(MORNING, PLAN);
        expect(prepare.mock.calls.length).toBe(fewSongs);

        // Every song linked: no suggestions to find.
        prepare.mockClear();
        stubFetchRoutes(routesWith([songItem("1", "30", "Abide with Me")], []));
        await getPlanDetail(MORNING, PLAN);
        expect(prepare.mock.calls.length).toBe(5);

        // No song items: no catalog and no history to ask; the saved choices and the settings still are.
        prepare.mockClear();
        stubFetchRoutes(
            routesWith([itemResource("1", { title: "Welcome", item_type: "header" })], [])
        );
        await getPlanDetail(MORNING, PLAN);
        expect(prepare).toHaveBeenCalledTimes(2);
    });

    // It used to fail the whole plan page, the Copyright tab included.
    test("keeps the plan when the database cannot be opened: no links, and why", async () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        const cause = new Error("Could not open the database at /srv/data/x: denied");
        getDb.mockImplementation(() => {
            throw cause;
        });
        stubFetchRoutes(planDetailRoutes());
        const { getPlanDetail } = await loadQueries();

        const detail = await getPlanDetail(MORNING, PLAN);

        expect(detail.plan).toMatchObject({ id: PLAN });
        expect(detail.items.map((item) => item.id)).toEqual(["1", "2", "3", "4"]);
        expect(detail.catalog).toEqual({});
        expect(detail.suggestions).toEqual({});
        expect(detail.catalogError).toBe("Could not open the database at /srv/data/x: denied");
        expect(consoleError).toHaveBeenCalledWith(
            `Failed to read the catalog links of plan ${MORNING}/${PLAN}:`,
            cause
        );
    });

    test("keeps the plan the same way when a query fails", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        const closed = openTestDb();
        closed.close();
        getDb.mockReturnValue(closed);
        stubFetchRoutes(planDetailRoutes());
        const { getPlanDetail } = await loadQueries();

        const { catalog, suggestions, catalogError } = await getPlanDetail(MORNING, PLAN);

        expect(catalog).toEqual({});
        expect(suggestions).toEqual({});
        expect(catalogError).toMatch(/not open/i);
    });

    test("reads no catalog for a plan whose items schedule no Planning Center song", async () => {
        // The database is opened for the saved choices and the settings even
        // so; when it cannot be, the catalog is not what failed.
        vi.spyOn(console, "error").mockImplementation(() => {});
        getDb.mockImplementation(() => {
            throw new Error("Could not open the database at /srv/data/x: denied");
        });
        stubFetchRoutes(
            routesWith(
                [
                    itemResource("1", { title: "Welcome", item_type: "header" }),
                    itemResource("2", { title: "A song with no song", sequence: 2 }),
                ],
                []
            )
        );
        const { getPlanDetail } = await loadQueries();

        const detail = await getPlanDetail(MORNING, PLAN);

        expect(getDb).toHaveBeenCalledTimes(2);
        expect(detail.catalog).toEqual({});
        expect(detail.suggestions).toEqual({});
        expect(detail.catalogError).toBeNull();
        expect(detail.selectionsError).toMatch(/Could not open the database/);
        expect(detail.settingsError).toMatch(/Could not open the database/);
    });
});

describe("getPlanDetail's saved choices", () => {
    test("gives the plan's saved choices for its items, custom text kept as typed", async () => {
        seedScheduleSelection(db, { planId: PLAN, itemId: "2", option: "custom", customText: " vv. 1, 4" });
        seedScheduleSelection(db, { planId: PLAN, itemId: "3", option: "blank" });
        seedScheduleSelection(db, { planId: PLAN, itemId: "4", option: "numbers" });
        stubFetchRoutes(planDetailRoutes());
        const { getPlanDetail } = await loadQueries();

        const { selections, selectionsError } = await getPlanDetail(MORNING, PLAN);

        expect(selections).toEqual({
            "2": { option: "custom", customText: " vv. 1, 4" },
            "3": { option: "blank" },
            "4": { option: "numbers" },
        });
        expect(selectionsError).toBeNull();
    });

    test("leaves out a newer build's option, an item no longer in the plan and other plans', deleting none", async () => {
        seedScheduleSelection(db, { planId: PLAN, itemId: "2", option: "newer-option" });
        seedScheduleSelection(db, { planId: PLAN, itemId: "99", option: "blank" });
        seedScheduleSelection(db, { planId: "999", itemId: "3", option: "blank" });
        stubFetchRoutes(planDetailRoutes());
        const { getPlanDetail } = await loadQueries();

        const { selections } = await getPlanDetail(MORNING, PLAN);

        expect(selections).toEqual({});
        expect(db.prepare("SELECT count(*) AS n FROM schedule_selections").get()).toEqual({ n: 3 });
    });

    test("keeps Numbers for a song that is not linked; the Schedule tab shows its default", async () => {
        seedScheduleSelection(db, { planId: PLAN, itemId: "4", option: "numbers" });
        stubFetchRoutes(planDetailRoutes());
        const { getPlanDetail } = await loadQueries();

        const { items, selections, catalog } = await getPlanDetail(MORNING, PLAN);

        expect(selections).toEqual({ "4": { option: "numbers" } });
        const merged = mergeScheduleSelections(items, selections, catalog);
        expect(merged.find((item) => item.id === "4")?.option).toBe("blank");
    });

    test("without a database: no choices, and why", async () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        const cause = new Error("Could not open the database at /srv/data/x: denied");
        getDb.mockImplementation(() => {
            throw cause;
        });
        stubFetchRoutes(planDetailRoutes());
        const { getPlanDetail } = await loadQueries();

        const { selections, selectionsError } = await getPlanDetail(MORNING, PLAN);

        expect(selections).toEqual({});
        expect(selectionsError).toBe("Could not open the database at /srv/data/x: denied");
        expect(consoleError).toHaveBeenCalledWith(
            `Failed to read the saved choices of plan ${MORNING}/${PLAN}:`,
            cause
        );
    });
});

describe("getPlanDetail's settings", () => {
    test("by default: today's header for the service type, separator and CCLI number", async () => {
        stubFetchRoutes(planDetailRoutes());
        const { getPlanDetail } = await loadQueries();

        const { scheduleSettings, settingsError } = await getPlanDetail(MORNING, PLAN);

        expect(scheduleSettings).toEqual({
            headerLabel: "Sunday AM",
            numberSeparator: " / ",
            ccliLicenseNumber: "1564484",
            creditRoles: DEFAULT_SETTINGS.creditRoles,
            creditPhrases: DEFAULT_SETTINGS.creditPhrases,
        });
        expect(settingsError).toBeNull();
    });

    test("the saved credit roles and phrases", async () => {
        seedSetting(db, "creditRoles", ["Text", "Tune"]);
        seedSetting(db, "creditPhrases", { Text: "Text by", Tune: "Tune by" });
        stubFetchRoutes(planDetailRoutes());
        const { getPlanDetail } = await loadQueries();

        const { scheduleSettings } = await getPlanDetail(MORNING, PLAN);

        expect(scheduleSettings).toMatchObject({
            creditRoles: ["Text", "Tune"],
            creditPhrases: { Text: "Text by", Tune: "Tune by" },
        });
    });

    test("what is saved, with the header label of this plan's service type", async () => {
        seedSetting(db, "scheduleHeaderLabels", { [MORNING]: "Morning Worship", [EVENING]: "Evening" });
        seedSetting(db, "numberSeparator", ", ");
        seedSetting(db, "ccliLicenseNumber", "7654321");
        stubFetchRoutes(planDetailRoutes());
        const { getPlanDetail } = await loadQueries();

        const { scheduleSettings } = await getPlanDetail(MORNING, PLAN);

        expect(scheduleSettings).toEqual({
            headerLabel: "Morning Worship",
            numberSeparator: ", ",
            ccliLicenseNumber: "7654321",
            creditRoles: DEFAULT_SETTINGS.creditRoles,
            creditPhrases: DEFAULT_SETTINGS.creditPhrases,
        });
    });

    test("the defaults, and why, when the settings cannot be read", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        getDb.mockImplementation(() => {
            throw new Error("Could not open the database at /srv/data/x: denied");
        });
        stubFetchRoutes(planDetailRoutes());
        const { getPlanDetail } = await loadQueries();

        const { scheduleSettings, settingsError } = await getPlanDetail(MORNING, PLAN);

        expect(scheduleSettings).toEqual({
            headerLabel: "Sunday AM",
            numberSeparator: DEFAULT_SETTINGS.numberSeparator,
            ccliLicenseNumber: DEFAULT_SETTINGS.ccliLicenseNumber,
            creditRoles: DEFAULT_SETTINGS.creditRoles,
            creditPhrases: DEFAULT_SETTINGS.creditPhrases,
        });
        expect(settingsError).toBe("Could not open the database at /srv/data/x: denied");
    });
});

describe("getPlanDetail's hymnal notes", () => {
    /** Abide with Me linked to Planning Center song 30, at R-517 and G-64. */
    function seedAbide() {
        const rejoice = seedBook(db, { code: "R", name: "Rejoice Hymns" });
        const great = seedBook(db, { code: "G", name: "Great Hymns of the Faith" });
        const abide = seedSong(db, {
            hymnId: seedHymn(db, { title: "Abide with Me" }),
            tuneId: seedTune(db, { name: "EVENTIDE" }),
            pcoSongId: "30",
            linkedAt: "2026-10-01T12:00:00.000Z",
            linkedBy: "manual",
        });
        seedEntry(db, { bookId: rejoice, songId: abide, number: 517 });
        seedEntry(db, { bookId: great, songId: abide, number: 64 });
    }

    /** The plan's routes with its items' notes: a stale hymnal note on an unlinked song, a Vocals note on another. */
    function routesWithNotes(): Record<string, unknown> {
        return {
            ...planDetailRoutes(),
            [urls.items]: listPage(
                [
                    itemResource("2", { title: "Come, Thou Fount of Every Blessing", sequence: 2 }, {
                        song: { data: { type: "Song", id: "20" } },
                        ...noteLinks("9002"),
                    }),
                    itemResource("3", { title: "Abide with Me", sequence: 3 }, songLink("30")),
                    itemResource("4", { title: "A Song Not In The Hymnbooks", sequence: 4 }, {
                        song: { data: { type: "Song", id: "40" } },
                        ...noteLinks("9004"),
                    }),
                ],
                {
                    included: [
                        itemNoteResource("9002", { category_name: "Hymnal", content: "R-553" }, "503"),
                        itemNoteResource("9004", { category_name: "Vocals", content: "Solo" }, "502"),
                    ],
                }
            ),
        };
    }

    test("gives each song item's note against the category, from the catalog links", async () => {
        seedAbide();
        stubFetchRoutes(routesWithNotes());
        const { getPlanDetail } = await loadQueries();

        const { hymnNoteStatus, items } = await getPlanDetail(MORNING, PLAN);

        expect(hymnNoteStatus.kind === "ready" && hymnNoteStatus.category).toEqual({ id: "503", name: "Hymnal" });
        expect(
            hymnNoteStatus.kind === "ready" &&
                hymnNoteStatus.items.map(({ itemId, action, content, current }) => [itemId, action, content, current])
        ).toEqual([
            // The app did not write the note on the song that is not linked, so it stays.
            ["2", "keep", null, "R-553"],
            ["3", "create", "R-517 / G-64", null],
            ["4", "none", null, null],
        ]);
        // The items carry their notes for the pages too.
        expect(items.map((item) => item.notes.map(({ id }) => id))).toEqual([["9002"], [], ["9004"]]);
    });

    test("leaves a book not in use out of the notes", async () => {
        seedAbide();
        db.prepare("UPDATE books SET active = 0 WHERE code = 'R'").run();
        stubFetchRoutes(routesWithNotes());
        const { getPlanDetail } = await loadQueries();

        const { hymnNoteStatus } = await getPlanDetail(MORNING, PLAN);

        expect(
            hymnNoteStatus.kind === "ready" &&
                hymnNoteStatus.items.map(({ itemId, action, content }) => [itemId, action, content])
        ).toEqual([
            ["2", "keep", null],
            ["3", "create", "G-64"],
            ["4", "none", null],
        ]);
    });

    test("would delete a note the write log says the app created", async () => {
        seedAbide();
        seedWriteLog(db, {
            payload: { action: "create", content: "R-553" },
            result: { note: { id: "9002", categoryId: "503", categoryName: "Hymnal", content: "R-553" } },
        });
        stubFetchRoutes(routesWithNotes());
        const { getPlanDetail } = await loadQueries();

        const { hymnNoteStatus } = await getPlanDetail(MORNING, PLAN);

        expect(hymnNoteStatus.kind === "ready" && hymnNoteStatus.items[0]).toMatchObject({
            itemId: "2",
            action: "delete",
            changes: [{ kind: "delete", noteId: "9002", reason: "nothing-to-say" }],
            keep: [],
        });
    });

    test("shows every note as kept when the write log cannot be read", async () => {
        seedAbide();
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        const prepare = db.prepare.bind(db);
        vi.spyOn(db, "prepare").mockImplementation((sql: string) => {
            if (sql.includes("FROM write_log")) {
                throw new Error("no such table: write_log");
            }
            return prepare(sql);
        });
        stubFetchRoutes(routesWithNotes());
        const { getPlanDetail } = await loadQueries();

        const { hymnNoteStatus } = await getPlanDetail(MORNING, PLAN);

        expect(hymnNoteStatus.kind === "ready" && hymnNoteStatus.items[0].action).toBe("keep");
        expect(consoleError).toHaveBeenCalledWith(
            "Failed to read which item notes the app wrote:",
            expect.objectContaining({ message: "no such table: write_log" })
        );
    });

    test("follows the settings' separator and category name", async () => {
        seedAbide();
        seedSetting(db, "numberSeparator", ", ");
        seedSetting(db, "hymnNoteCategoryName", "band");
        stubFetchRoutes(routesWithNotes());
        const { getPlanDetail } = await loadQueries();

        const { hymnNoteStatus } = await getPlanDetail(MORNING, PLAN);

        expect(hymnNoteStatus).toMatchObject({ kind: "ready", category: { id: "501", name: "Band" } });
        expect(hymnNoteStatus.kind === "ready" && hymnNoteStatus.items[1].content).toBe("R-517, G-64");
    });

    test("asks for the category when the service type has none", async () => {
        stubFetchRoutes({
            ...planDetailRoutes(),
            [urls.categories]: listPage([itemNoteCategoryResource("501", { name: "Band" })]),
        });
        const { getPlanDetail } = await loadQueries();

        const { hymnNoteStatus } = await getPlanDetail(MORNING, PLAN);

        expect(hymnNoteStatus).toEqual({
            kind: "no-category",
            categoryName: "Hymnal",
            message: 'Create an item note category named "Hymnal" in Planning Center for Sunday Morning.',
        });
    });

    test("keeps the plan when the categories cannot be read, and says why", async () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        stubFetchRoutes({
            ...planDetailRoutes(),
            [urls.categories]: () => json({ errors: [] }, { status: 500 }),
        });
        const { getPlanDetail } = await loadQueries();

        const detail = await getPlanDetail(MORNING, PLAN);

        expect(detail.items).toHaveLength(4);
        expect(detail.hymnNoteStatus).toMatchObject({ kind: "unavailable", reason: "categories" });
        expect(consoleError).toHaveBeenCalledWith(
            `Failed to read the item note categories of service type ${MORNING}:`,
            expect.objectContaining({ name: "PcoError", status: 500 })
        );
    });

    /** Make every query whose SQL contains `sql` throw, as a broken table would. */
    function failQueries(sql: string) {
        const prepare = db.prepare.bind(db);
        vi.spyOn(db, "prepare").mockImplementation((text: string) => {
            if (text.includes(sql)) {
                throw new Error(`broken: ${sql}`);
            }
            return prepare(text);
        });
    }

    test("cannot compare the notes when the catalog cannot be read", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        failQueries("FROM entries");
        stubFetchRoutes(routesWithNotes());
        const { getPlanDetail } = await loadQueries();

        const { hymnNoteStatus } = await getPlanDetail(MORNING, PLAN);

        expect(hymnNoteStatus).toMatchObject({ kind: "unavailable", reason: "catalog" });
    });

    test("does not compare the notes by the defaults when the settings cannot be read", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        failQueries("FROM settings");
        stubFetchRoutes(routesWithNotes());
        const { getPlanDetail } = await loadQueries();

        const { hymnNoteStatus, settingsError } = await getPlanDetail(MORNING, PLAN);

        expect(settingsError).toBe("broken: FROM settings");
        expect(hymnNoteStatus).toMatchObject({ kind: "unavailable", reason: "settings" });
    });

    test("without a database at all, says the settings could not be read", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        getDb.mockImplementation(() => {
            throw new Error("Could not open the database at /srv/data/x: denied");
        });
        stubFetchRoutes(routesWithNotes());
        const { getPlanDetail } = await loadQueries();

        const { hymnNoteStatus } = await getPlanDetail(MORNING, PLAN);

        expect(hymnNoteStatus).toMatchObject({ kind: "unavailable", reason: "settings" });
    });
});

describe("getPlanLabels", () => {
    test("labels the plan with its dates and service type, and each item with its title", async () => {
        stubFetchRoutes(planDetailRoutes());
        const { getPlanLabels } = await loadQueries();

        await expect(getPlanLabels(MORNING, PLAN)).resolves.toEqual({
            plan: "October 4, 2026 · Sunday Morning",
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

    test("does not need the database", async () => {
        getDb.mockImplementation(() => {
            throw new Error("Could not open the database at /srv/data/x: denied");
        });
        stubFetchRoutes(planDetailRoutes());
        const { getPlanLabels } = await loadQueries();

        await expect(getPlanLabels(MORNING, PLAN)).resolves.toMatchObject({
            plan: "October 4, 2026 · Sunday Morning",
        });
        expect(getDb).not.toHaveBeenCalled();
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
            plan: "October 4, 2026 · Sunday Morning",
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
