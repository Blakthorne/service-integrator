import "server-only";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { backupDirectory, getDb } from "@/lib/db";
import { backupDatabase, isBackupDue } from "@/lib/db/backup";
import { errorMessage } from "@/lib/db/errors";
import {
    finishSyncRun,
    latestSyncRun,
    startSyncRun,
    type SyncRun,
    type SyncRunCounts,
    type SyncRunKind,
    type SyncRunOutcome,
} from "@/lib/db/syncRuns";
import { describePcoSongsSync, syncPcoSongs } from "@/lib/queries/sync";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

/** How long after boot the `atBoot` check waits, so it does not compete with the first requests. */
export const BOOT_DELAY_MS = MINUTE_MS;

/** What a run reports, recorded on its `sync_runs` row. */
export interface JobResult {
    message?: string;
    counts?: SyncRunCounts;
}

/** A background job. Each run is recorded in `sync_runs` under its kind. */
export interface Job {
    /** Its `sync_runs` kind. One job per kind. */
    kind: SyncRunKind;
    /** How often the scheduler checks it. */
    everyMs: number;
    /** Also check it once, `BOOT_DELAY_MS` after the server starts. */
    atBoot?: boolean;
    /**
     * Whether a scheduled check should run it now. Omitted: every check
     * runs it. A run on demand (`runJob`) does not ask.
     */
    isDue?: (db: DatabaseSync, now: Date) => boolean;
    /**
     * The work. What it returns is recorded with the run; a throw or a
     * rejection records a failed run.
     */
    run: (db: DatabaseSync) => JobResult | void | Promise<JobResult | void>;
}

/**
 * The daily backup. It is checked hourly and soon after boot, and runs when
 * the newest backup is a day old, so restarts (every deploy) never stretch the
 * gap between backups much past a day. It also runs when the last backup run
 * did not succeed: it failed, or a restart interrupted it (`boot()` finishes
 * such a run as failed), even if that run had already written its file.
 */
export const backupJob: Job = {
    kind: "backup",
    everyMs: HOUR_MS,
    atBoot: true,
    isDue: (db, now) =>
        latestSyncRun(db, "backup")?.ok === false ||
        isBackupDue(backupDirectory(), now),
    run: (db) => {
        const { file, pruned } = backupDatabase(db, { dir: backupDirectory() });
        return {
            message: `Wrote ${path.basename(file)}`,
            counts: { pruned: pruned.length },
        };
    },
};

/**
 * The Planning Center song sync, hourly and soon after boot: mirror the song
 * library and make the auto-links it allows (see `syncPcoSongs`). "Sync now"
 * runs it on demand through `runJob`.
 */
export const pcoSongsJob: Job = {
    kind: "pco-songs",
    everyMs: HOUR_MS,
    atBoot: true,
    run: async (db) => {
        const counts = await syncPcoSongs(db);
        return { message: describePcoSongsSync(counts), counts };
    },
};

/**
 * The jobs `startJobs()` schedules. A new job is one entry here, as the
 * song sync is.
 */
export const JOBS: readonly Job[] = [backupJob, pcoSongsJob];

/**
 * What `runJob` resolves to: the run it started or joined, as recorded
 * (`run.ok` says whether the job succeeded, `run.message` what it did or why
 * it failed); or `run: null` and why, when no run could be recorded because
 * the database could not be opened or written.
 */
export type RunJobResult = { run: SyncRun } | { run: null; error: string };

/**
 * The runs in progress, by kind. They live on globalThis because a run
 * started on demand (a server action) and a scheduled one (started from the
 * instrumentation hook) use different copies of this module (convention 15),
 * and must still see each other. Bump the version if what a run resolves to
 * changes, so that no copy joins a run whose result it cannot read.
 */
const RUNNING_GLOBAL = Symbol.for("service-integrator.jobs.running.v2");

/** Set once the jobs are scheduled in this process. */
const STARTED_GLOBAL = Symbol.for("service-integrator.jobs.started.v1");

function runningJobs(): Map<SyncRunKind, Promise<RunJobResult>> {
    const scope = globalThis as unknown as {
        [RUNNING_GLOBAL]?: Map<SyncRunKind, Promise<RunJobResult>>;
    };
    return (scope[RUNNING_GLOBAL] ??= new Map());
}

/**
 * Record, now, how run `id` of `job` (started at `startedAt`) ended, and give
 * the run as recorded. Throws when the end cannot be recorded.
 */
function finishRun(
    db: DatabaseSync,
    job: Job,
    id: number,
    startedAt: Date,
    outcome: Required<SyncRunOutcome>
): SyncRun {
    const finishedAt = new Date();
    finishSyncRun(db, id, outcome, finishedAt);
    return {
        id,
        kind: job.kind,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        ...outcome,
    };
}

async function execute(job: Job, openDb: () => DatabaseSync): Promise<RunJobResult> {
    const startedAt = new Date();
    let db: DatabaseSync;
    let id: number;
    try {
        db = openDb();
        id = startSyncRun(db, job.kind, startedAt);
    } catch (error) {
        console.error(`Job ${job.kind} could not start:`, error);
        return { run: null, error: errorMessage(error) };
    }
    try {
        const result = (await job.run(db)) ?? {};
        const run = finishRun(db, job, id, startedAt, {
            ok: true,
            message: result.message ?? null,
            counts: result.counts ?? null,
        });
        console.log(
            `Job ${job.kind} finished${result.message ? `: ${result.message}` : ""}`
        );
        return { run };
    } catch (error) {
        console.error(`Job ${job.kind} failed:`, error);
        try {
            return {
                run: finishRun(db, job, id, startedAt, {
                    ok: false,
                    message: errorMessage(error),
                    counts: null,
                }),
            };
        } catch (recordError) {
            console.error(
                `Job ${job.kind}: could not record the failure:`,
                recordError
            );
            return { run: null, error: errorMessage(error) };
        }
    }
}

/**
 * Run `job` now and record the run in `sync_runs`. Resolves, when it is
 * done, to that run as recorded, `ok` false when the job failed; or, when no
 * run could be recorded (the database could not be opened or written), to
 * `run: null` and why. Never an older run, and never throws or rejects:
 * every failure is logged too. A call while a run of the same kind is in
 * progress joins that run instead of starting another, and resolves to it.
 */
export function runJob(
    job: Job,
    openDb: () => DatabaseSync = getDb
): Promise<RunJobResult> {
    const running = runningJobs();
    const current = running.get(job.kind);
    if (current) {
        return current;
    }
    const run = execute(job, openDb).finally(() => {
        if (running.get(job.kind) === run) {
            running.delete(job.kind);
        }
    });
    running.set(job.kind, run);
    return run;
}

/** A scheduled check: run `job` if it is due. Never throws or rejects. */
export async function runIfDue(
    job: Job,
    openDb: () => DatabaseSync = getDb,
    now: () => Date = () => new Date()
): Promise<void> {
    if (job.isDue) {
        let due: boolean;
        try {
            due = job.isDue(openDb(), now());
        } catch (error) {
            console.error(`Job ${job.kind}: could not tell whether it is due:`, error);
            return;
        }
        if (!due) {
            return;
        }
    }
    await runJob(job, openDb);
}

/** Options for startJobs (tests pass their own). */
export interface StartJobsOptions {
    jobs?: readonly Job[];
    openDb?: () => DatabaseSync;
}

/**
 * Schedule the background jobs: each is checked every `everyMs` and, with
 * `atBoot`, once `BOOT_DELAY_MS` from now. It schedules them once per process
 * (Next may run the instrumentation hook again in development): later calls
 * do nothing and return false. The timers are unref()ed, so they never keep a
 * process alive on their own.
 */
export function startJobs({
    jobs = JOBS,
    openDb = getDb,
}: StartJobsOptions = {}): boolean {
    const scope = globalThis as unknown as { [STARTED_GLOBAL]?: boolean };
    if (scope[STARTED_GLOBAL]) {
        return false;
    }
    scope[STARTED_GLOBAL] = true;
    for (const job of jobs) {
        const check = () => {
            void runIfDue(job, openDb);
        };
        setInterval(check, job.everyMs).unref();
        if (job.atBoot) {
            setTimeout(check, BOOT_DELAY_MS).unref();
        }
    }
    return true;
}
