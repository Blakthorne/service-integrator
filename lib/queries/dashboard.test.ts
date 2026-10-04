import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { finishSyncRun, startSyncRun } from "@/lib/db/syncRuns";
import {
    openTestDb,
    seedBook,
    seedEntry,
    seedHymn,
    seedPcoSong,
    seedSetting,
    seedSong,
    seedTune,
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

const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/lib/db", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/db")>()),
    getDb,
}));

import { PCO_SONGS_SYNC_STALE_MS, getDashboard, type Dashboard, type DashboardServiceType } from "./dashboard";

const MORNING = "1405391";
const EVENING = "1486055";
const ARCHIVED = "1300000";
const AM_PLAN = "81234567";
const PM_PLAN = "81234568";
const HYMNAL = "503";

const NOW = new Date("2026-10-04T12:00:00.000Z");
const MINUTE_MS = 60 * 1000;

const urls = {
    serviceTypes: `${PCO_BASE}/service_types?per_page=100`,
    next: (st: string) => `${PCO_BASE}/service_types/${st}/plans?filter=future&order=sort_date&per_page=25`,
    items: (st: string, plan: string) =>
        `${PCO_BASE}/service_types/${st}/plans/${plan}/items?include=song,item_notes&per_page=100`,
    categories: (st: string) => `${PCO_BASE}/service_types/${st}/item_note_categories?per_page=100`,
};

const songLink = (id: string) => ({ song: { data: { type: "Song" as const, id } } });

/**
 * Sunday morning's next plan:
 * 1. O God, Our Help (song 77, at R-396 and G-317), its hymnal note in step;
 * 2. Amazing Grace (song 88, at R-12), with no note;
 * 3. and 4. a song not in the catalog (99), twice;
 * 5. a song set aside on Reconcile (66);
 * 6. a song item with no Planning Center song;
 * 7. a header, which is no song.
 */
function morningItems() {
    return listPage(
        [
            itemResource("1", { title: "O God, Our Help", sequence: 1 }, {
                ...songLink("77"),
                ...noteLinks("9001"),
            }),
            itemResource("2", { title: "Amazing Grace", sequence: 2 }, songLink("88")),
            itemResource("3", { title: "New Song", sequence: 3 }, songLink("99")),
            itemResource("4", { title: "New Song (reprise)", sequence: 4 }, songLink("99")),
            itemResource("5", { title: "Ignored Chorus", sequence: 5 }, songLink("66")),
            itemResource("6", { title: "Offering", sequence: 6 }),
            itemResource("7", { title: "Welcome", item_type: "header", sequence: 0 }),
        ],
        {
            included: [
                songResource("77", { title: "O God, Our Help" }),
                songResource("88", { title: "Amazing Grace" }),
                songResource("99", { title: "New Song" }),
                songResource("66", { title: "Ignored Chorus" }),
                itemNoteResource("9001", { category_name: "Hymnal", content: "R-396 / G-317" }, HYMNAL),
            ],
        }
    );
}

/** Sunday evening's next plan: Abide with Me, which is not in the catalog. */
function eveningItems() {
    return listPage([itemResource("11", { title: "Abide with Me", sequence: 1 }, songLink("30"))], {
        included: [songResource("30", { title: "Abide with Me" })],
    });
}

function categories(...names: string[]) {
    return listPage(
        names.map((name, i) =>
            itemNoteCategoryResource(name === "Hymnal" ? HYMNAL : String(510 + i), { name })
        )
    );
}

/** Two service types and an archived one; the evening has no Hymnal category. */
function routes(): Record<string, unknown> {
    return {
        [urls.serviceTypes]: listPage([
            serviceTypeResource({ name: "Sunday Morning" }, MORNING),
            serviceTypeResource({ name: "Sunday Evening", sequence: 2 }, EVENING),
            serviceTypeResource({ name: "Old Service", archived_at: "2024-01-01T00:00:00Z" }, ARCHIVED),
        ]),
        [urls.next(MORNING)]: listPage([
            planResource({ id: AM_PLAN }, { sort_date: "2026-10-04T08:00:00Z", dates: "October 4, 2026" }),
        ]),
        [urls.next(EVENING)]: listPage([
            planResource({ id: PM_PLAN }, { sort_date: "2026-10-04T18:00:00Z", dates: "October 4, 2026" }),
        ]),
        [urls.items(MORNING, AM_PLAN)]: morningItems(),
        [urls.items(EVENING, PM_PLAN)]: eveningItems(),
        [urls.categories(MORNING)]: categories("Band", "Hymnal"),
        [urls.categories(EVENING)]: categories("Band"),
    };
}

/** Record a song sync run that started `minutesAgo` before NOW and finished, as `ok` says, 5 seconds later. */
function syncRun(minutesAgo: number, ok: boolean | null, message: string | null = null): number {
    const started = new Date(NOW.getTime() - minutesAgo * MINUTE_MS);
    const id = startSyncRun(db, "pco-songs", started);
    if (ok !== null) {
        finishSyncRun(db, id, { ok, message }, new Date(started.getTime() + 5000));
    }
    return id;
}

/** The entry for a service type, which must have a plan. */
function planEntry(dashboard: Dashboard, serviceTypeId: string) {
    const entry = dashboard.serviceTypes.find((e) => e.serviceType.id === serviceTypeId);
    if (entry?.status !== "plan") {
        throw new Error(`No plan for ${serviceTypeId}: ${JSON.stringify(entry)}`);
    }
    return entry;
}

let db: DatabaseSync;

beforeEach(() => {
    stubPcoCredentials();
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
    seedSong(db, { hymnId: seedHymn(db, { title: "Abide with Me" }), tuneId: seedTune(db, { name: "EVENTIDE" }) });
    seedPcoSong(db, { id: "66", title: "Ignored Chorus", ignoredAt: "2026-10-01T12:00:00.000Z" });
    syncRun(30, true, "Synced 397 songs");
});

afterEach(() => {
    db.close();
    getDb.mockReset();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

describe("getDashboard", () => {
    test("loads each service type's next plan, its items and its categories in seven requests", async () => {
        const fetchMock = stubFetchRoutes(routes());

        const dashboard = await getDashboard(NOW);

        expect(calledUrls(fetchMock).sort()).toEqual(
            [
                urls.serviceTypes,
                urls.next(MORNING),
                urls.next(EVENING),
                urls.items(MORNING, AM_PLAN),
                urls.items(EVENING, PM_PLAN),
                urls.categories(MORNING),
                urls.categories(EVENING),
            ].sort()
        );
        expect(dashboard.serviceTypes.map(({ status, serviceType }) => [serviceType.name, status])).toEqual([
            ["Sunday Morning", "plan"],
            ["Sunday Evening", "plan"],
        ]);
        expect(planEntry(dashboard, MORNING).plan).toMatchObject({ id: AM_PLAN, serviceTypeId: MORNING });
        expect(dashboard.serviceTypesError).toBeNull();
        expect(dashboard.databaseError).toBeNull();
        expect(dashboard.lastSync).toMatchObject({ kind: "pco-songs", ok: true, message: "Synced 397 songs" });
    });

    test("gives each song item its link, numbers and note, in sequence order", async () => {
        stubFetchRoutes(routes());

        const morning = planEntry(await getDashboard(NOW), MORNING);

        expect(
            morning.songs.map(({ itemId, title, pcoSongId, link, numbers, note }) => [
                itemId,
                title,
                pcoSongId,
                link.kind,
                numbers,
                note?.action ?? null,
            ])
        ).toEqual([
            ["1", "O God, Our Help", "77", "linked", "R-396 / G-317", "unchanged"],
            ["2", "Amazing Grace", "88", "linked", "R-12", "create"],
            ["3", "New Song", "99", "unlinked", "", "none"],
            ["4", "New Song (reprise)", "99", "unlinked", "", "none"],
            ["5", "Ignored Chorus", "66", "ignored", "", "none"],
            ["6", "Offering", null, "no-song", "", "none"],
        ]);
        expect(morning.songs[0].link).toMatchObject({ kind: "linked", match: { title: "O God, Our Help in Ages Past", tuneName: "ST. ANNE" } });
        expect(morning.hymnNotes).toMatchObject({ kind: "ready", category: { id: HYMNAL } });
        expect(morning.notesToSync).toBe(1);
    });

    test("an unlinked song carries its suggestions, for a Link", async () => {
        stubFetchRoutes(routes());

        const evening = planEntry(await getDashboard(NOW), EVENING);

        expect(evening.songs[0].link).toMatchObject({
            kind: "unlinked",
            pcoSongId: "30",
            suggestions: [{ title: "Abide with Me", tuneName: "EVENTIDE", reason: "exact" }],
        });
    });

    test("follows the settings' separator for the numbers", async () => {
        seedSetting(db, "numberSeparator", ", ");
        stubFetchRoutes(routes());
        const morning = planEntry(await getDashboard(NOW), MORNING);
        expect(morning.songs[0].numbers).toBe("R-396, G-317");
        // The note in step said "R-396 / G-317": with the new separator it differs.
        expect(morning.songs[0].note?.action).toBe("update");
    });

    test("lists what needs doing: songs not in the catalog, notes to sync, a missing category", async () => {
        stubFetchRoutes(routes());

        const { todos } = await getDashboard(NOW);

        const am = { id: AM_PLAN, dates: "October 4, 2026", shortDates: "Oct 4" };
        const pm = { id: PM_PLAN, dates: "October 4, 2026", shortDates: "Oct 4" };
        expect(todos).toEqual([
            {
                kind: "songs-not-in-catalog",
                serviceType: { id: MORNING, name: "Sunday Morning" },
                plan: am,
                songs: [{ itemId: "3", title: "New Song", pcoSongId: "99" }],
            },
            {
                kind: "notes-out-of-date",
                serviceType: { id: MORNING, name: "Sunday Morning" },
                plan: am,
                count: 1,
            },
            {
                kind: "missing-category",
                serviceType: { id: EVENING, name: "Sunday Evening" },
                categoryName: "Hymnal",
                message: 'Create an item note category named "Hymnal" in Planning Center for Sunday Evening.',
            },
            {
                kind: "songs-not-in-catalog",
                serviceType: { id: EVENING, name: "Sunday Evening" },
                plan: pm,
                songs: [{ itemId: "11", title: "Abide with Me", pcoSongId: "30" }],
            },
        ]);
    });

    test("a service type with no next plan says so, in one request", async () => {
        const fetchMock = stubFetchRoutes({ ...routes(), [urls.next(EVENING)]: listPage([]) });

        const dashboard = await getDashboard(NOW);

        expect(dashboard.serviceTypes[1]).toEqual({
            status: "no-plan",
            serviceType: expect.objectContaining({ id: EVENING }),
        });
        expect(calledUrls(fetchMock)).not.toContain(urls.categories(EVENING));
        expect(calledUrls(fetchMock)).toHaveLength(5);
    });

    test("a service type that fails is a warning, never an exception", async () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        stubFetchRoutes({
            ...routes(),
            [urls.items(EVENING, PM_PLAN)]: () => json({ errors: [] }, { status: 500 }),
        });

        const dashboard = await getDashboard(NOW);

        expect(dashboard.serviceTypes[0].status).toBe("plan");
        expect(dashboard.serviceTypes[1]).toEqual({
            status: "failed",
            serviceType: expect.objectContaining({ id: EVENING }),
            error: expect.stringContaining("status: 500"),
        });
        expect(dashboard.todos.map(({ kind }) => kind)).toEqual(["songs-not-in-catalog", "notes-out-of-date"]);
        expect(consoleError).toHaveBeenCalledWith(
            `Failed to load the next plan of service type ${EVENING}:`,
            expect.objectContaining({ status: 500 })
        );
    });

    test("a next plan that fails to load is a warning too", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        stubFetchRoutes({ ...routes(), [urls.next(MORNING)]: () => json({}, { status: 503 }) });
        const dashboard = await getDashboard(NOW);
        expect(dashboard.serviceTypes.map(({ status }) => status)).toEqual(["failed", "plan"]);
    });

    test("categories that cannot be read leave the plan, without its notes", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        stubFetchRoutes({ ...routes(), [urls.categories(MORNING)]: () => json({}, { status: 500 }) });

        const dashboard = await getDashboard(NOW);
        const morning = planEntry(dashboard, MORNING);

        expect(morning.hymnNotes).toMatchObject({ kind: "unavailable", reason: "categories" });
        expect(morning.songs.map(({ note }) => note)).toEqual([null, null, null, null, null, null]);
        expect(morning.notesToSync).toBe(0);
        expect(dashboard.todos.map(({ kind }) => kind)).not.toContain("notes-out-of-date");
    });

    test("never throws when the service types cannot be read: says why, and keeps the database's to-dos", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        db.prepare("DELETE FROM entries").run();
        db.prepare("DELETE FROM songs").run();
        stubFetchRoutes({ [urls.serviceTypes]: () => json({}, { status: 500 }) });

        const dashboard = await getDashboard(NOW);

        expect(dashboard.serviceTypes).toEqual([]);
        expect(dashboard.serviceTypesError).toMatch(/status: 500/);
        expect(dashboard.todos).toEqual([{ kind: "empty-catalog" }]);
    });

    test("asks the database ten queries at most, however many plans and songs", async () => {
        stubFetchRoutes(routes());
        const prepare = vi.spyOn(db, "prepare");
        await getDashboard(NOW);
        // Seven for the links of both plans' songs (suggestions included),
        // and one each for the settings, the song sync and the catalog's size.
        expect(prepare).toHaveBeenCalledTimes(10);
    });
});

describe("getDashboard's to-dos for the catalog and the song sync", () => {
    /** Only the morning, so the plan's to-dos stay out of the way. */
    function quietRoutes(): Record<string, unknown> {
        return {
            ...routes(),
            [urls.serviceTypes]: listPage([serviceTypeResource({ name: "Sunday Morning" }, MORNING)]),
            [urls.next(MORNING)]: listPage([]),
        };
    }

    async function todoKinds(): Promise<string[]> {
        stubFetchRoutes(quietRoutes());
        return (await getDashboard(NOW)).todos.map(({ kind }) => kind);
    }

    test("none after a recent successful sync, with songs in the catalog", async () => {
        await expect(todoKinds()).resolves.toEqual([]);
    });

    test("an empty catalog, to import", async () => {
        db.prepare("DELETE FROM entries").run();
        db.prepare("DELETE FROM songs").run();
        await expect(todoKinds()).resolves.toEqual(["empty-catalog"]);
    });

    test("a failed sync, with its run", async () => {
        const id = syncRun(10, false, "Planning Center did not respond");
        stubFetchRoutes(quietRoutes());
        const { todos } = await getDashboard(NOW);
        expect(todos).toEqual([
            {
                kind: "sync-failed",
                run: expect.objectContaining({ id, ok: false, message: "Planning Center did not respond" }),
            },
        ]);
    });

    test("a stale sync: its latest success is older than the limit", async () => {
        db.prepare("DELETE FROM sync_runs").run();
        const staleMinutes = PCO_SONGS_SYNC_STALE_MS / MINUTE_MS + 1;
        const id = syncRun(staleMinutes, true);
        stubFetchRoutes(quietRoutes());
        const { todos } = await getDashboard(NOW);
        expect(todos).toEqual([{ kind: "sync-stale", run: expect.objectContaining({ id, ok: true }) }]);
    });

    test("a sync that never ran is stale", async () => {
        db.prepare("DELETE FROM sync_runs").run();
        stubFetchRoutes(quietRoutes());
        const dashboard = await getDashboard(NOW);
        expect(dashboard.todos).toEqual([{ kind: "sync-stale", run: null }]);
        expect(dashboard.lastSync).toBeNull();
    });

    test("nothing for a sync in progress", async () => {
        db.prepare("DELETE FROM sync_runs").run();
        syncRun(PCO_SONGS_SYNC_STALE_MS / MINUTE_MS + 60, null);
        await expect(todoKinds()).resolves.toEqual([]);
    });
});

describe("getDashboard without a database", () => {
    test("shows the plans without links, numbers or notes, says why, and still asks for the category", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        getDb.mockImplementation(() => {
            throw new Error("Could not open the database at /srv/data/x: denied");
        });
        stubFetchRoutes(routes());

        const dashboard = await getDashboard(NOW);

        const morning: DashboardServiceType = planEntry(dashboard, MORNING);
        expect(dashboard.databaseError).toBe("Could not open the database at /srv/data/x: denied");
        expect(morning.status === "plan" && morning.songs.map(({ link }) => link.kind)).toEqual([
            "unknown",
            "unknown",
            "unknown",
            "unknown",
            "unknown",
            "no-song",
        ]);
        expect(morning.status === "plan" && morning.hymnNotes).toMatchObject({
            kind: "unavailable",
            reason: "catalog",
        });
        expect(dashboard.lastSync).toBeNull();
        expect(dashboard.todos.map(({ kind }) => kind)).toEqual(["missing-category"]);
    });
});
