import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { backupFileName } from "@/lib/db/backup";
import {
    finishInterruptedRuns,
    finishSyncRun,
    latestSyncRun,
    recentSyncRuns,
    startSyncRun,
} from "@/lib/db/syncRuns";
import { openTestDb, seedHymn, seedPcoSong, seedSong } from "@/lib/db/testing";
import {
    PCO_BASE,
    calledUrls,
    itemResource,
    json,
    listPage,
    planResource,
    serviceTypeResource,
    songResource,
    stubFetchRoutes,
    stubPcoCredentials,
    stubPcoPacer,
    tagGroupResource,
    tagResource,
} from "@/lib/pco/testing";
import {
    BOOT_DELAY_MS,
    JOBS,
    backupJob,
    historyJob,
    pcoSongsJob,
    runIfDue,
    runJob,
    startJobs,
    tagsJob,
    type Job,
} from "./jobs";

const HOUR_MS = 60 * 60 * 1000;
const T0 = new Date("2026-10-03T12:00:00.000Z");
const hoursAfterT0 = (hours: number) => new Date(T0.getTime() + hours * HOUR_MS);

/** The globalThis keys jobs.ts keeps its state under. */
const JOB_GLOBALS = [
    "service-integrator.jobs.started.v1",
    "service-integrator.jobs.running.v2",
];

let db: DatabaseSync;
let dir: string;
const openDb = () => db;

beforeEach(() => {
    db = openTestDb();
    dir = mkdtempSync(path.join(tmpdir(), "si-jobs-"));
    vi.stubEnv("DATABASE_BACKUP_DIR", dir);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
    vi.useRealTimers();
    const scope = globalThis as unknown as Record<symbol, unknown>;
    for (const key of JOB_GLOBALS) {
        delete scope[Symbol.for(key)];
    }
    db.close();
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

/** A test job of kind "tags", checked hourly. */
function testJob(run: Job["run"], options: Partial<Job> = {}): Job {
    return { kind: "tags", everyMs: HOUR_MS, run, ...options };
}

describe("runJob", () => {
    test("records a successful run with its message and counts, and gives it", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(T0);
        const result = await runJob(
            testJob(() => ({ message: "Synced 3 tags", counts: { tags: 3 } })),
            openDb
        );
        expect(latestSyncRun(db, "tags")).toMatchObject({
            startedAt: T0.toISOString(),
            finishedAt: T0.toISOString(),
            ok: true,
            message: "Synced 3 tags",
            counts: { tags: 3 },
        });
        expect(result).toEqual({ run: latestSyncRun(db, "tags") });
        expect(console.log).toHaveBeenCalledWith("Job tags finished: Synced 3 tags");
    });

    test("waits for an async job, and records one that returns nothing", async () => {
        await runJob(testJob(async () => {}), openDb);
        expect(latestSyncRun(db, "tags")).toMatchObject({
            ok: true,
            message: null,
            counts: null,
        });
    });

    test.each<[string, Job["run"], string]>([
        [
            "throws",
            () => {
                throw new Error("boom");
            },
            "boom",
        ],
        ["rejects", () => Promise.reject(new Error("boom")), "boom"],
        ["rejects with a non-Error", () => Promise.reject("plain"), "plain"],
    ])(
        "records a failed run when the job %s, and resolves to it",
        async (_case, run, message) => {
            const result = await runJob(testJob(run), openDb);
            expect(latestSyncRun(db, "tags")).toMatchObject({
                ok: false,
                message,
            });
            expect(result).toEqual({ run: latestSyncRun(db, "tags") });
            expect(console.error).toHaveBeenCalledWith(
                "Job tags failed:",
                expect.anything()
            );
        }
    );

    test("gives why, and logs it, when the database cannot be opened", async () => {
        const run = vi.fn();
        const broken = () => {
            throw new Error("Could not open the database");
        };
        await expect(runJob(testJob(run), broken)).resolves.toEqual({
            run: null,
            error: "Could not open the database",
        });
        expect(run).not.toHaveBeenCalled();
        expect(console.error).toHaveBeenCalledWith(
            "Job tags could not start:",
            expect.any(Error)
        );
    });

    test("gives why, never an older run, when the run cannot be recorded", async () => {
        const older = await runJob(testJob(() => ({ message: "Synced 3 tags" })), openDb);
        expect(older.run?.ok).toBe(true);
        db.exec(
            "CREATE TRIGGER full BEFORE INSERT ON sync_runs BEGIN SELECT RAISE(ABORT, 'database or disk is full'); END"
        );
        const run = vi.fn();

        await expect(runJob(testJob(run), openDb)).resolves.toEqual({
            run: null,
            error: "database or disk is full",
        });
        expect(run).not.toHaveBeenCalled();
        expect(console.error).toHaveBeenCalledWith(
            "Job tags could not start:",
            expect.any(Error)
        );
    });

    test("gives why when the end of the run cannot be recorded", async () => {
        db.exec(
            "CREATE TRIGGER full BEFORE UPDATE ON sync_runs BEGIN SELECT RAISE(ABORT, 'database or disk is full'); END"
        );
        await expect(
            runJob(testJob(() => ({ message: "Synced 3 tags" })), openDb)
        ).resolves.toEqual({ run: null, error: "database or disk is full" });
        expect(console.error).toHaveBeenCalledWith(
            "Job tags: could not record the failure:",
            expect.any(Error)
        );
    });

    test("joins a run of the same kind that is in progress", async () => {
        let finish = () => {};
        const run = vi.fn(
            () =>
                new Promise<void>((resolve) => {
                    finish = resolve;
                })
        );
        const job = testJob(run);
        const first = runJob(job, openDb);
        const joined = runJob(job, openDb);
        expect(joined).toBe(first);
        finish();
        expect(await joined).toEqual({ run: latestSyncRun(db, "tags") });
        expect(run).toHaveBeenCalledOnce();
        expect(recentSyncRuns(db)).toHaveLength(1);

        // Once it is done, the next call starts a new run.
        await runJob(testJob(() => {}), openDb);
        expect(recentSyncRuns(db)).toHaveLength(2);
    });
});

describe("runIfDue", () => {
    test("runs a job that has no isDue", async () => {
        const run = vi.fn();
        await runIfDue(testJob(run), openDb);
        expect(run).toHaveBeenCalledWith(db);
    });

    test("runs a job that is due", async () => {
        const run = vi.fn();
        const isDue = vi.fn(() => true);
        await runIfDue(testJob(run, { isDue }), openDb, () => T0);
        expect(isDue).toHaveBeenCalledWith(db, T0);
        expect(run).toHaveBeenCalledOnce();
    });

    test("skips a job that is not due, recording nothing", async () => {
        const run = vi.fn();
        await runIfDue(testJob(run, { isDue: () => false }), openDb);
        expect(run).not.toHaveBeenCalled();
        expect(recentSyncRuns(db)).toEqual([]);
    });

    test("logs and skips when it cannot tell whether the job is due", async () => {
        const run = vi.fn();
        const isDue = () => {
            throw new Error("no folder");
        };
        await expect(
            runIfDue(testJob(run, { isDue }), openDb)
        ).resolves.toBeUndefined();
        expect(run).not.toHaveBeenCalled();
        expect(console.error).toHaveBeenCalledWith(
            "Job tags: could not tell whether it is due:",
            expect.any(Error)
        );
    });
});

describe("backupJob", () => {
    test("is scheduled: checked hourly and soon after boot", () => {
        expect(JOBS).toContain(backupJob);
        expect(backupJob).toMatchObject({
            kind: "backup",
            everyMs: HOUR_MS,
            atBoot: true,
        });
    });

    test("writes a backup to DATABASE_BACKUP_DIR and records it", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(T0);
        await runJob(backupJob, openDb);
        expect(readdirSync(dir)).toEqual([backupFileName(T0)]);
        expect(latestSyncRun(db, "backup")).toMatchObject({
            ok: true,
            message: `Wrote ${backupFileName(T0)}`,
            counts: { pruned: 0 },
        });
    });

    test("is due when there is no backup, then not again for a day", async () => {
        expect(backupJob.isDue?.(db, T0)).toBe(true);
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(T0);
        await runJob(backupJob, openDb);
        expect(backupJob.isDue?.(db, hoursAfterT0(23))).toBe(false);
        expect(backupJob.isDue?.(db, hoursAfterT0(24))).toBe(true);
    });

    test("is due again when the last backup run was interrupted, despite a fresh file", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(T0);
        await runJob(backupJob, openDb);
        // A run that wrote its file, but whose server stopped before it finished.
        startSyncRun(db, "backup", hoursAfterT0(1));
        expect(backupJob.isDue?.(db, hoursAfterT0(2))).toBe(false);
        finishInterruptedRuns(db, hoursAfterT0(2));
        expect(backupJob.isDue?.(db, hoursAfterT0(2))).toBe(true);
    });

    test("is due again when the last backup run failed", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(T0);
        await runJob(backupJob, openDb);
        const id = startSyncRun(db, "backup", hoursAfterT0(1));
        finishSyncRun(db, id, { ok: false, message: "could not prune" }, hoursAfterT0(1));
        expect(backupJob.isDue?.(db, hoursAfterT0(2))).toBe(true);
    });
});

describe("pcoSongsJob", () => {
    const LIBRARY = `${PCO_BASE}/songs?per_page=100`;

    test("is scheduled: run every hour and soon after boot", () => {
        expect(JOBS).toContain(pcoSongsJob);
        expect(pcoSongsJob).toMatchObject({
            kind: "pco-songs",
            everyMs: HOUR_MS,
            atBoot: true,
        });
        expect(pcoSongsJob.isDue).toBeUndefined();
    });

    test("syncs the Planning Center songs and records what it did", async () => {
        stubPcoCredentials();
        stubPcoPacer();
        stubFetchRoutes({
            [LIBRARY]: listPage([songResource("1001", { title: "Amazing Grace" })]),
        });
        seedSong(db, { hymnId: seedHymn(db, { title: "Amazing Grace" }) });

        await runJob(pcoSongsJob, openDb);
        expect(latestSyncRun(db, "pco-songs")).toMatchObject({
            ok: true,
            message: "Synced 1 song: 1 added, 1 auto-linked",
            counts: { fetched: 1, added: 1, updated: 0, removed: 0, autoLinked: 1 },
        });
    });

    test("records a sync that failed", async () => {
        stubPcoCredentials();
        stubPcoPacer();
        stubFetchRoutes({ [LIBRARY]: () => json({ errors: [] }, { status: 500 }) });

        await runJob(pcoSongsJob, openDb);
        expect(latestSyncRun(db, "pco-songs")).toMatchObject({
            ok: false,
            message: expect.stringContaining("status: 500"),
        });
    });
});

describe("tagsJob", () => {
    const LIBRARY = `${PCO_BASE}/songs?per_page=100`;
    const TAG_GROUPS = `${PCO_BASE}/tag_groups?include=tags&per_page=100`;
    const HYMNS = `${PCO_BASE}/songs?where[song_tag_ids]=101&per_page=100`;

    /** The (song, tag) rows stored, in order. */
    function songTagRows(): [string, string][] {
        return db
            .prepare("SELECT pco_song_id, tag_id FROM pco_song_tags ORDER BY pco_song_id, tag_id")
            .all()
            .map((row) => [String(row.pco_song_id), String(row.tag_id)]);
    }

    /**
     * A library of two songs, which the mirror does not have yet, both
     * tagged Hymn; `library` answers the listing (by default at once).
     */
    function stubPlanningCenter(library: unknown = listPage([songResource("1001"), songResource("1002")])) {
        stubPcoCredentials();
        stubPcoPacer();
        return stubFetchRoutes({
            [LIBRARY]: library,
            [TAG_GROUPS]: listPage([tagGroupResource("10", { name: "Type" }, ["101"])], {
                included: [tagResource("101", { name: "Hymn" })],
            }),
            [HYMNS]: listPage([songResource("1001"), songResource("1002")]),
        });
    }

    test("is scheduled: run every hour and soon after boot, checked after the song sync", () => {
        expect(tagsJob).toMatchObject({ kind: "tags", everyMs: HOUR_MS, atBoot: true });
        expect(tagsJob.isDue).toBeUndefined();
        expect(JOBS.indexOf(tagsJob)).toBeGreaterThan(JOBS.indexOf(pcoSongsJob));
    });

    test("syncs the songs first, so the songs it adds get their tags, and records what it did", async () => {
        const fetchMock = stubPlanningCenter();

        await runJob(tagsJob, openDb);
        expect(calledUrls(fetchMock)).toEqual([LIBRARY, TAG_GROUPS, HYMNS]);
        expect(latestSyncRun(db, "pco-songs")).toMatchObject({ ok: true });
        expect(latestSyncRun(db, "tags")).toMatchObject({
            ok: true,
            message: "Synced 1 tag in 1 group: 2 song tags",
            counts: { groups: 1, tags: 1, songTags: 2, skipped: 0 },
        });
        expect(songTagRows()).toEqual([
            ["1001", "101"],
            ["1002", "101"],
        ]);
    });

    /**
     * Planning Center as `stubPlanningCenter` stubs it, except that the
     * library listing waits until `answerListing()`: a song sync stays in
     * progress, as one does while its requests are on the network.
     */
    function stubWithListingHeld() {
        let answerListing = () => {};
        const fetchMock = stubPlanningCenter(
            () =>
                new Promise<Response>((resolve) => {
                    answerListing = () =>
                        resolve(json(listPage([songResource("1001"), songResource("1002")])));
                })
        );
        return { fetchMock, answerListing: () => answerListing() };
    }

    test("joins a song sync in progress rather than start another", async () => {
        const { fetchMock, answerListing } = stubWithListingHeld();

        const songs = runJob(pcoSongsJob, openDb);
        const tags = runJob(tagsJob, openDb);
        await vi.waitFor(() => expect(calledUrls(fetchMock)).toEqual([LIBRARY]));
        answerListing();
        await Promise.all([songs, tags]);

        expect(calledUrls(fetchMock)).toEqual([LIBRARY, TAG_GROUPS, HYMNS]);
        expect(recentSyncRuns(db).map(({ kind, ok }) => [kind, ok])).toEqual([
            ["tags", true],
            ["pco-songs", true],
        ]);
        expect(songTagRows()).toHaveLength(2);
    });

    test("still syncs the tags when the song sync fails, skipping the songs the mirror lacks", async () => {
        stubPlanningCenter(() => json({ errors: [] }, { status: 500 }));
        seedPcoSong(db, { id: "1001" });

        await runJob(tagsJob, openDb);
        expect(latestSyncRun(db, "pco-songs")).toMatchObject({ ok: false });
        expect(latestSyncRun(db, "tags")).toMatchObject({
            ok: true,
            message: "Synced 1 tag in 1 group: 1 song tag, 1 skipped (songs not mirrored yet)",
        });
        expect(songTagRows()).toEqual([["1001", "101"]]);
    });

    test("records a tags sync that failed", async () => {
        stubPlanningCenter();
        stubFetchRoutes({
            [LIBRARY]: listPage([]),
            [TAG_GROUPS]: () => json({ errors: [] }, { status: 500 }),
        });

        await runJob(tagsJob, openDb);
        expect(latestSyncRun(db, "tags")).toMatchObject({
            ok: false,
            message: expect.stringContaining("status: 500"),
        });
    });

    test("at boot, the scheduler starts the song sync, and the tags sync waits for it", async () => {
        vi.useFakeTimers();
        const { fetchMock, answerListing } = stubWithListingHeld();

        startJobs({ jobs: [pcoSongsJob, tagsJob], openDb });
        await vi.advanceTimersByTimeAsync(BOOT_DELAY_MS);
        // Both checks have run: one song sync is in progress, and the tags sync waits.
        expect(calledUrls(fetchMock)).toEqual([LIBRARY]);
        expect(recentSyncRuns(db).map(({ kind, ok }) => [kind, ok])).toEqual([
            ["tags", null],
            ["pco-songs", null],
        ]);

        answerListing();
        await vi.waitFor(() => expect(latestSyncRun(db, "tags")?.ok).toBe(true));
        expect(calledUrls(fetchMock)).toEqual([LIBRARY, TAG_GROUPS, HYMNS]);
        expect(recentSyncRuns(db).map(({ kind, ok }) => [kind, ok])).toEqual([
            ["tags", true],
            ["pco-songs", true],
        ]);
        expect(songTagRows()).toHaveLength(2);
    });
});

describe("historyJob", () => {
    const SERVICE_TYPES = `${PCO_BASE}/service_types?per_page=100`;
    const PLANS = `${PCO_BASE}/service_types/1405391/plans?order=-sort_date&per_page=100`;
    const ITEMS = `${PCO_BASE}/service_types/1405391/plans/501/items?include=song&per_page=100`;

    function stubPlanning() {
        stubPcoCredentials();
        stubPcoPacer();
        return stubFetchRoutes({
            [SERVICE_TYPES]: listPage([serviceTypeResource({}, "1405391")]),
            [PLANS]: listPage([planResource({ id: "501" }, { sort_date: "2026-09-27T08:00:00Z" })]),
            [ITEMS]: listPage([
                itemResource("1", { title: "Amazing Grace", sequence: 1 }, { song: { data: { type: "Song", id: "77" } } }),
                itemResource("2", { title: "Offering", item_type: "item", sequence: 2 }),
            ]),
        });
    }

    test("is scheduled: checked every hour and soon after boot, and run when due", () => {
        expect(JOBS).toContain(historyJob);
        expect(historyJob).toMatchObject({ kind: "history", everyMs: HOUR_MS, atBoot: true });
        expect(historyJob.isDue).toBeTypeOf("function");
    });

    test("is due when it never ran (so at boot), not for a day after a success, and then due daily", () => {
        expect(historyJob.isDue?.(db, T0)).toBe(true);
        const id = startSyncRun(db, "history", T0);
        finishSyncRun(db, id, { ok: true, message: "Synced 216 plans" }, T0);
        expect(historyJob.isDue?.(db, hoursAfterT0(1))).toBe(false);
        expect(historyJob.isDue?.(db, hoursAfterT0(23))).toBe(false);
        expect(historyJob.isDue?.(db, hoursAfterT0(24))).toBe(true);
    });

    test("is due again when its last run failed or was interrupted by a restart", () => {
        const failed = startSyncRun(db, "history", T0);
        finishSyncRun(db, failed, { ok: false, message: "status: 500" }, T0);
        expect(historyJob.isDue?.(db, hoursAfterT0(1))).toBe(true);

        const interrupted = startSyncRun(db, "history", hoursAfterT0(2));
        expect(historyJob.isDue?.(db, hoursAfterT0(3))).toBe(false);
        finishInterruptedRuns(db, hoursAfterT0(3));
        expect(latestSyncRun(db, "history")).toMatchObject({ id: interrupted, ok: false });
        expect(historyJob.isDue?.(db, hoursAfterT0(4))).toBe(true);
    });

    test("syncs the plan history and records what it did", async () => {
        stubPlanning();

        await runJob(historyJob, openDb);

        expect(latestSyncRun(db, "history")).toMatchObject({
            ok: true,
            message: "Synced 1 plan (1 song item): read 1 plan, 1 added",
            counts: { plans: 1, added: 1, changed: 0, removed: 0, read: 1, weekly: 0, occurrences: 1 },
        });
        expect(db.prepare("SELECT pco_song_id FROM plan_occurrences").all()).toEqual([{ pco_song_id: "77" }]);
    });

    test("records a plan it could not read without failing the run, and names it", async () => {
        stubPcoCredentials();
        stubPcoPacer();
        vi.spyOn(console, "error").mockImplementation(() => {});
        stubFetchRoutes({
            [SERVICE_TYPES]: listPage([serviceTypeResource({}, "1405391")]),
            [PLANS]: listPage([
                planResource({ id: "501" }, { sort_date: "2026-09-27T08:00:00Z" }),
                planResource({ id: "502" }, { sort_date: "2026-09-20T08:00:00Z" }),
            ]),
            [ITEMS]: () => json({ errors: [] }, { status: 500 }),
            [`${PCO_BASE}/service_types/1405391/plans/502/items?include=song&per_page=100`]: listPage([
                itemResource("1", { title: "Amazing Grace", sequence: 1 }, { song: { data: { type: "Song", id: "77" } } }),
            ]),
        });

        await runJob(historyJob, openDb);

        const run = latestSyncRun(db, "history");
        expect(run).toMatchObject({
            ok: true,
            message: expect.stringMatching(
                /^Synced 2 plans \(1 song item\): read 1 plan, 2 added, 1 failed \(plan 501: .*status: 500/
            ),
            counts: { plans: 2, added: 2, read: 1, failed: 1, occurrences: 1 },
        });
        // The counts are numbers only: which plans failed is in the message.
        expect(Object.values(run?.counts ?? {}).every((count) => typeof count === "number")).toBe(true);
    });

    test("runs at boot only when it never ran, then is checked hourly", async () => {
        vi.useFakeTimers();
        const fetchMock = stubPlanning();
        startJobs({ jobs: [historyJob], openDb });

        await vi.advanceTimersByTimeAsync(BOOT_DELAY_MS);
        await vi.waitFor(() => expect(latestSyncRun(db, "history")?.ok).toBe(true));
        const requests = calledUrls(fetchMock).length;
        expect(requests).toBeGreaterThan(0);

        // The hourly checks find it not due.
        await vi.advanceTimersByTimeAsync(3 * HOUR_MS);
        expect(calledUrls(fetchMock)).toHaveLength(requests);
        expect(recentSyncRuns(db).filter(({ kind }) => kind === "history")).toHaveLength(1);
    });

    test("records a sync that failed", async () => {
        stubPcoCredentials();
        stubPcoPacer();
        stubFetchRoutes({ [SERVICE_TYPES]: () => json({ errors: [] }, { status: 500 }) });

        await runJob(historyJob, openDb);
        expect(latestSyncRun(db, "history")).toMatchObject({
            ok: false,
            message: expect.stringContaining("status: 500"),
        });
    });
});

describe("startJobs", () => {
    test("checks each job every everyMs, and an atBoot job soon after boot too", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(T0);
        const hourly = vi.fn();
        const everyTwoHours = vi.fn();
        startJobs({
            jobs: [
                testJob(hourly),
                {
                    kind: "backup",
                    everyMs: 2 * HOUR_MS,
                    atBoot: true,
                    run: everyTwoHours,
                },
            ],
            openDb,
        });

        await vi.advanceTimersByTimeAsync(BOOT_DELAY_MS);
        expect(hourly).not.toHaveBeenCalled();
        expect(everyTwoHours).toHaveBeenCalledOnce();

        await vi.advanceTimersByTimeAsync(HOUR_MS - BOOT_DELAY_MS);
        expect(hourly).toHaveBeenCalledOnce();
        expect(everyTwoHours).toHaveBeenCalledOnce();

        await vi.advanceTimersByTimeAsync(HOUR_MS);
        expect(hourly).toHaveBeenCalledTimes(2);
        expect(everyTwoHours).toHaveBeenCalledTimes(2);
        expect(recentSyncRuns(db)).toHaveLength(4);
    });

    test("asks isDue before each scheduled run", async () => {
        vi.useFakeTimers();
        const run = vi.fn();
        let due = false;
        startJobs({ jobs: [testJob(run, { isDue: () => due })], openDb });
        await vi.advanceTimersByTimeAsync(HOUR_MS);
        expect(run).not.toHaveBeenCalled();
        due = true;
        await vi.advanceTimersByTimeAsync(HOUR_MS);
        expect(run).toHaveBeenCalledOnce();
    });

    test("schedules the jobs once per process", async () => {
        vi.useFakeTimers();
        const run = vi.fn();
        expect(startJobs({ jobs: [testJob(run)], openDb })).toBe(true);
        expect(startJobs({ jobs: [testJob(run)], openDb })).toBe(false);
        expect(vi.getTimerCount()).toBe(1);
        await vi.advanceTimersByTimeAsync(HOUR_MS);
        expect(run).toHaveBeenCalledOnce();
    });

    test("does not keep the process alive", () => {
        vi.useFakeTimers();
        const intervals = vi.spyOn(globalThis, "setInterval");
        const timeouts = vi.spyOn(globalThis, "setTimeout");
        startJobs({ jobs: [testJob(vi.fn(), { atBoot: true })], openDb });
        const interval = intervals.mock.results[0].value as NodeJS.Timeout;
        const timeout = timeouts.mock.results[0].value as NodeJS.Timeout;
        expect(interval.hasRef()).toBe(false);
        expect(timeout.hasRef()).toBe(false);
    });
});
