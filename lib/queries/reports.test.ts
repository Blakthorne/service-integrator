import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { finishSyncRun, latestSyncRun, startSyncRun } from "@/lib/db/syncRuns";
import {
    openTestDb,
    seedBook,
    seedEntry,
    seedHistoryPlan,
    seedHymn,
    seedOccurrence,
    seedPcoSong,
    seedSong,
    seedTune,
} from "@/lib/db/testing";
import {
    PCO_BASE,
    calledUrls,
    itemResource,
    json,
    listPage,
    planResource,
    serviceTypeResource,
    stubFetchRoutes,
    stubPcoCredentials,
    stubPcoPacer,
} from "@/lib/pco/testing";

// vi.hoisted: vi.mock factories run before the module's own declarations.
const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/lib/db", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/db")>()),
    getDb,
}));

import { getReports, getSongHistory, syncPlanHistoryNow } from "./reports";

let db: DatabaseSync;

beforeEach(() => {
    db = openTestDb();
    getDb.mockReturnValue(db);
    stubPcoCredentials();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
    db.close();
    getDb.mockReset();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

const SERVICE_TYPES = `${PCO_BASE}/service_types?per_page=100`;
const PLANS = `${PCO_BASE}/service_types/1405391/plans?order=-sort_date&per_page=100`;
const ITEMS = `${PCO_BASE}/service_types/1405391/plans/501/items?include=song&per_page=100`;

describe("syncPlanHistoryNow", () => {
    test("runs the history sync as a job and gives its run", async () => {
        stubPcoPacer();
        stubFetchRoutes({
            [SERVICE_TYPES]: listPage([serviceTypeResource({}, "1405391")]),
            [PLANS]: listPage([planResource({ id: "501" }, { sort_date: "2026-09-27T08:00:00Z" })]),
            [ITEMS]: listPage([
                itemResource("1", { sequence: 1 }, { song: { data: { type: "Song", id: "77" } } }),
            ]),
        });

        const result = await syncPlanHistoryNow();

        expect(result).toEqual({ run: latestSyncRun(db, "history") });
        expect(result.run).toMatchObject({
            kind: "history",
            ok: true,
            counts: { plans: 1, added: 1, read: 1, occurrences: 1 },
        });
        expect(db.prepare("SELECT plan_id, pco_song_id FROM plan_occurrences").all()).toEqual([
            { plan_id: "501", pco_song_id: "77" },
        ]);
    });

    test("gives a failed run rather than throwing", async () => {
        stubPcoPacer();
        stubFetchRoutes({ [SERVICE_TYPES]: () => json({ errors: [] }, { status: 500 }) });

        await expect(syncPlanHistoryNow()).resolves.toEqual({
            run: expect.objectContaining({
                kind: "history",
                ok: false,
                message: expect.stringContaining("status: 500"),
            }),
        });
    });

    test("joins a run in progress rather than start another", async () => {
        stubPcoPacer();
        let answer!: () => void;
        const held = new Promise<void>((resolve) => {
            answer = resolve;
        });
        const fetchMock = stubFetchRoutes({
            [SERVICE_TYPES]: async () => {
                await held;
                return json(listPage([]));
            },
        });

        const first = syncPlanHistoryNow();
        const second = syncPlanHistoryNow();
        answer();
        const [a, b] = await Promise.all([first, second]);

        expect(a).toEqual(b);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    test("gives why, never an older run, when no run can be recorded", async () => {
        const id = startSyncRun(db, "history", new Date("2026-10-03T12:00:00.000Z"));
        finishSyncRun(db, id, { ok: true, message: "Synced 1 plan" }, new Date("2026-10-03T12:00:00.000Z"));
        db.exec(
            "CREATE TRIGGER full BEFORE INSERT ON sync_runs BEGIN SELECT RAISE(ABORT, 'database or disk is full'); END"
        );
        const fetchMock = stubFetchRoutes({});

        await expect(syncPlanHistoryNow()).resolves.toEqual({
            run: null,
            error: "database or disk is full",
        });
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

const NOW = new Date("2026-10-04T12:00:00.000Z");
const MORNING = "1405391";
const EVENING = "1486055";

/**
 * A catalog of five songs and a history, as of Sunday 2026-10-04:
 * - Amazing Grace (R-12), linked to Planning Center song 1001: sung on
 *   2026-09-27 and 2026-09-20, and scheduled for 2026-10-11;
 * - O God, Our Help (R-396, G-317), linked to 1002: sung on 2026-09-27 and
 *   2025-01-05;
 * - Never Sung, linked to 1003, in the plan dated today (which is upcoming);
 * - Sung Long Ago, linked to 1006: sung on 2024-05-05;
 * - A hymn that is not linked;
 * and Planning Center song 1005, Shout to the Lord, which is in no catalog
 * song, sung on 2026-09-27.
 */
function seedChurch() {
    const rejoice = seedBook(db, { code: "R", name: "Rejoice Hymns" });
    const great = seedBook(db, { code: "G", name: "Great Hymns of the Faith" });
    const song = (title: string, pcoSongId: string | null, tune: string | null = null) =>
        seedSong(db, {
            hymnId: seedHymn(db, { title }),
            tuneId: tune === null ? null : seedTune(db, { name: tune }),
            pcoSongId,
            linkedBy: pcoSongId === null ? null : "manual",
            linkedAt: pcoSongId === null ? null : "2026-10-01T12:00:00.000Z",
        });
    const grace = song("Amazing Grace", "1001", "NEW BRITAIN");
    const help = song("O God, Our Help in Ages Past", "1002", "ST. ANNE");
    const never = song("Never Sung", "1003");
    const longAgo = song("Sung Long Ago", "1006");
    const unlinked = song("A Hymn Not In Planning Center", null);
    seedEntry(db, { bookId: rejoice, songId: grace, number: 12 });
    seedEntry(db, { bookId: rejoice, songId: help, number: 396 });
    seedEntry(db, { bookId: great, songId: help, number: 317 });
    for (const [id, title] of [
        ["1001", "Amazing Grace"],
        ["1002", "O God, Our Help in Ages Past"],
        ["1003", "Never Sung"],
        ["1005", "Shout to the Lord"],
        ["1006", "Sung Long Ago"],
    ]) {
        seedPcoSong(db, { id, title });
    }
    const plan = (planId: string, planDate: string, songs: string[], serviceTypeId = MORNING) => {
        seedHistoryPlan(db, { planId, planDate, serviceTypeId });
        for (const pcoSongId of songs) {
            seedOccurrence(db, { planId, pcoSongId });
        }
    };
    plan("501", "2026-09-27", ["1001", "1002", "1005"]);
    plan("502", "2026-09-20", ["1001"], EVENING);
    plan("503", "2025-01-05", ["1002"]);
    plan("504", "2024-05-05", ["1006"]);
    plan("505", "2026-10-04", ["1003"]);
    plan("506", "2026-10-11", ["1001"]);
    return { grace, help, never, longAgo, unlinked };
}

describe("getReports", () => {
    test("is empty, with the history empty, before the first sync", () => {
        expect(getReports({}, NOW)).toEqual({
            today: "2026-10-04",
            history: { plans: 0, plansRead: 0, occurrences: 0, firstPlanDate: null, lastPlanDate: null },
            lastRun: null,
            mostSung: { "last-12-months": [], "this-year": [], "all-time": [] },
            lastSung: [],
            notSince: "2025-10-04",
            notSungSince: [],
        });
    });

    test("counts the songs sung in each period, most sung first, in the catalog or not", () => {
        seedChurch();
        const { mostSung } = getReports({}, NOW);

        const summary = (period: keyof typeof mostSung) =>
            mostSung[period].map(({ pcoSongId, title, times, lastSungOn }) => [pcoSongId, title, times, lastSungOn]);
        expect(summary("last-12-months")).toEqual([
            ["1001", "Amazing Grace", 2, "2026-09-27"],
            ["1002", "O God, Our Help in Ages Past", 1, "2026-09-27"],
            ["1005", "Shout to the Lord", 1, "2026-09-27"],
        ]);
        expect(summary("this-year")).toEqual(summary("last-12-months"));
        expect(summary("all-time")).toEqual([
            ["1001", "Amazing Grace", 2, "2026-09-27"],
            ["1002", "O God, Our Help in Ages Past", 2, "2026-09-27"],
            ["1005", "Shout to the Lord", 1, "2026-09-27"],
            ["1006", "Sung Long Ago", 1, "2024-05-05"],
        ]);
    });

    test("gives each song of the report its catalog song with its numbers, or null for a song not in the catalog", () => {
        seedChurch();
        const [grace, help, shout] = getReports({}, NOW).mostSung["last-12-months"];
        expect(grace.song).toMatchObject({ title: "Amazing Grace", tuneName: "NEW BRITAIN" });
        expect(grace.song?.entries.map(({ label }) => label)).toEqual(["R-12"]);
        expect(help.song?.entries.map(({ label }) => label)).toEqual(["R-396", "G-317"]);
        expect(shout.song).toBeNull();
    });

    test("lists every linked song by title with its last past date, times and next scheduled date", () => {
        seedChurch();
        expect(
            getReports({}, NOW).lastSung.map(({ song, times, lastSungOn, nextScheduledOn }) => [
                song.title,
                times,
                lastSungOn,
                nextScheduledOn,
            ])
        ).toEqual([
            ["Amazing Grace", 2, "2026-09-27", "2026-10-11"],
            ["Never Sung", 0, null, "2026-10-04"],
            ["O God, Our Help in Ages Past", 2, "2026-09-27", null],
            ["Sung Long Ago", 1, "2024-05-05", null],
        ]);
    });

    test("lists the songs not sung since a year ago, never sung first, when no date is asked for", () => {
        seedChurch();
        const reports = getReports({}, NOW);
        expect(reports.notSince).toBe("2025-10-04");
        expect(reports.notSungSince.map(({ song }) => song.title)).toEqual(["Never Sung", "Sung Long Ago"]);
    });

    test("lists the songs not sung since the date asked for", () => {
        seedChurch();
        const since = (notSince: string) =>
            getReports({ notSince }, NOW).notSungSince.map(({ song }) => song.title);
        expect(since("2026-09-27")).toEqual(["Never Sung", "Sung Long Ago"]);
        expect(since("2026-09-28")).toEqual([
            "Never Sung",
            "Sung Long Ago",
            "Amazing Grace",
            "O God, Our Help in Ages Past",
        ]);
        expect(getReports({ notSince: "2026-09-28" }, NOW).notSince).toBe("2026-09-28");
        expect(since("2024-01-01")).toEqual(["Never Sung"]);
    });

    test("is as of the date it is asked at: the plan dated today is sung a day later", () => {
        seedChurch();
        const tomorrow = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
        const reports = getReports({}, tomorrow);
        expect(reports.today).toBe("2026-10-05");
        expect(reports.lastSung.find(({ song }) => song.title === "Never Sung")).toMatchObject({
            times: 1,
            lastSungOn: "2026-10-04",
        });
    });

    test("says what the history holds and its latest sync run", () => {
        seedChurch();
        const id = startSyncRun(db, "history", NOW);
        finishSyncRun(db, id, { ok: true, message: "Synced 6 plans" }, NOW);
        const { history, lastRun } = getReports({}, NOW);
        expect(history).toEqual({
            plans: 6,
            plansRead: 6,
            occurrences: 8,
            firstPlanDate: "2024-05-05",
            lastPlanDate: "2026-10-11",
        });
        expect(lastRun).toMatchObject({ id, kind: "history", ok: true, message: "Synced 6 plans" });
    });
});

describe("getSongHistory", () => {
    test("lists every plan the song is in, newest first, upcoming ones marked", () => {
        seedChurch();
        const history = getSongHistory("1001", NOW);
        expect(
            history.entries.map(({ planId, planDate, serviceTypeId, upcoming }) => [planId, planDate, serviceTypeId, upcoming])
        ).toEqual([
            ["506", "2026-10-11", MORNING, true],
            ["501", "2026-09-27", MORNING, false],
            ["502", "2026-09-20", EVENING, false],
        ]);
        expect(history).toMatchObject({ times: 2, lastSungOn: "2026-09-27", nextScheduledOn: "2026-10-11" });
    });

    test("is empty for a song in no plan, a song that is not linked, and a history never synced", () => {
        seedChurch();
        const empty = { entries: [], times: 0, lastSungOn: null, nextScheduledOn: null };
        expect(getSongHistory("9999", NOW)).toEqual(empty);
        expect(getSongHistory(null, NOW)).toEqual(empty);
        db.exec("DELETE FROM history_plans");
        expect(getSongHistory("1001", NOW)).toEqual(empty);
    });

    test("is as of the date it is asked at", () => {
        seedChurch();
        expect(getSongHistory("1003", NOW)).toMatchObject({ times: 0, nextScheduledOn: "2026-10-04" });
        const tomorrow = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
        expect(getSongHistory("1003", tomorrow)).toMatchObject({ times: 1, lastSungOn: "2026-10-04" });
    });
});

describe("getServiceTypeNames", () => {
    const SERVICE_TYPES_URL = `${PCO_BASE}/service_types?per_page=100`;

    /** The module with a cache of its own, so no test sees another's names. */
    async function fresh() {
        vi.resetModules();
        return (await import("./reports")).getServiceTypeNames;
    }

    test("gives each service type's name by its id, and reads Planning Center once for 5 minutes", async () => {
        const names = await fresh();
        const fetchMock = stubFetchRoutes({
            [SERVICE_TYPES_URL]: listPage([
                serviceTypeResource({ name: "Sunday Morning" }, MORNING),
                serviceTypeResource({ name: "Sunday Evening", sequence: 2 }, EVENING),
            ]),
        });

        await expect(names()).resolves.toEqual({ [MORNING]: "Sunday Morning", [EVENING]: "Sunday Evening" });
        await expect(names()).resolves.toEqual({ [MORNING]: "Sunday Morning", [EVENING]: "Sunday Evening" });
        expect(calledUrls(fetchMock)).toEqual([SERVICE_TYPES_URL]);
    });

    test("gives none, and logs, when Planning Center cannot be read, and tries again next time", async () => {
        const names = await fresh();
        stubFetchRoutes({ [SERVICE_TYPES_URL]: () => json({ errors: [] }, { status: 500 }) });
        await expect(names()).resolves.toEqual({});
        expect(console.error).toHaveBeenCalledOnce();

        stubFetchRoutes({
            [SERVICE_TYPES_URL]: listPage([serviceTypeResource({ name: "Sunday Morning" }, MORNING)]),
        });
        await expect(names()).resolves.toEqual({ [MORNING]: "Sunday Morning" });
    });
});
