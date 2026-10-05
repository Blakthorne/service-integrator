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
import { openTestDb } from "@/lib/db/testing";
import {
    BOOT_DELAY_MS,
    JOBS,
    backupJob,
    runIfDue,
    runJob,
    startJobs,
    type Job,
} from "./jobs";

const HOUR_MS = 60 * 60 * 1000;
const T0 = new Date("2026-10-03T12:00:00.000Z");
const hoursAfterT0 = (hours: number) => new Date(T0.getTime() + hours * HOUR_MS);

/** The globalThis keys jobs.ts keeps its state under. */
const JOB_GLOBALS = [
    "service-integrator.jobs.started.v1",
    "service-integrator.jobs.running.v1",
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
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

/** A test job of kind "tags", checked hourly. */
function testJob(run: Job["run"], options: Partial<Job> = {}): Job {
    return { kind: "tags", everyMs: HOUR_MS, run, ...options };
}

describe("runJob", () => {
    test("records a successful run with its message and counts", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(T0);
        await runJob(
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
        "records a failed run when the job %s, and resolves",
        async (_case, run, message) => {
            await expect(runJob(testJob(run), openDb)).resolves.toBeUndefined();
            expect(latestSyncRun(db, "tags")).toMatchObject({
                ok: false,
                message,
            });
            expect(console.error).toHaveBeenCalledWith(
                "Job tags failed:",
                expect.anything()
            );
        }
    );

    test("only logs when the database cannot be opened", async () => {
        const run = vi.fn();
        const broken = () => {
            throw new Error("Could not open the database");
        };
        await expect(runJob(testJob(run), broken)).resolves.toBeUndefined();
        expect(run).not.toHaveBeenCalled();
        expect(console.error).toHaveBeenCalledWith(
            "Job tags could not start:",
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
        expect(runJob(job, openDb)).toBe(first);
        finish();
        await first;
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
