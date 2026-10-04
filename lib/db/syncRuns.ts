import "server-only";
import type { DatabaseSync, SQLOutputValue } from "node:sqlite";

/**
 * The kinds of background run, as stored in `sync_runs.kind`. They are
 * checked here rather than by a CHECK in the schema, so a new kind needs no
 * migration. Only `backup` runs so far; the Planning Center syncs come later.
 */
export const SYNC_RUN_KINDS = ["backup", "pco-songs", "tags", "history"] as const;

export type SyncRunKind = (typeof SYNC_RUN_KINDS)[number];

export function isSyncRunKind(value: unknown): value is SyncRunKind {
    return (SYNC_RUN_KINDS as readonly unknown[]).includes(value);
}

/** Numbers a run reports, such as `{ songs: 397, changed: 3 }`. */
export type SyncRunCounts = Record<string, number>;

/** A row of `sync_runs`. */
export interface SyncRun {
    id: number;
    kind: SyncRunKind;
    /** ISO 8601 UTC, like the other timestamps. */
    startedAt: string;
    /** Null while the run is in progress, or if the process stopped during it. */
    finishedAt: string | null;
    /** Whether it succeeded; null while it is in progress. */
    ok: boolean | null;
    /** What it did, or why it failed. */
    message: string | null;
    counts: SyncRunCounts | null;
}

/** How a run ended. */
export interface SyncRunOutcome {
    ok: boolean;
    message?: string | null;
    counts?: SyncRunCounts | null;
}

const COLUMNS = "id, kind, started_at, finished_at, ok, message, counts";

function nullableText(value: SQLOutputValue): string | null {
    return value === null ? null : String(value);
}

/** Map a row to a SyncRun. Callers only pass rows of a known kind. */
function toSyncRun(row: Record<string, SQLOutputValue>): SyncRun {
    const counts = nullableText(row.counts);
    return {
        id: Number(row.id),
        kind: row.kind as SyncRunKind,
        startedAt: String(row.started_at),
        finishedAt: nullableText(row.finished_at),
        ok: row.ok === null ? null : row.ok === 1,
        message: nullableText(row.message),
        counts: counts === null ? null : (JSON.parse(counts) as SyncRunCounts),
    };
}

/** Record that a run of `kind` started at `at`. Returns its id, for `finishSyncRun`. */
export function startSyncRun(
    db: DatabaseSync,
    kind: SyncRunKind,
    at: Date = new Date()
): number {
    if (!isSyncRunKind(kind)) {
        throw new Error(`Unknown sync run kind: ${String(kind)}`);
    }
    const { lastInsertRowid } = db
        .prepare("INSERT INTO sync_runs (kind, started_at) VALUES (?, ?)")
        .run(kind, at.toISOString());
    return Number(lastInsertRowid);
}

/**
 * Record how run `id` ended, at `at`. Throws when the run is not in progress
 * (no such run, or already finished).
 */
export function finishSyncRun(
    db: DatabaseSync,
    id: number,
    { ok, message = null, counts = null }: SyncRunOutcome,
    at: Date = new Date()
): void {
    const { changes } = db
        .prepare(
            "UPDATE sync_runs SET finished_at = ?, ok = ?, message = ?, counts = ? WHERE id = ? AND finished_at IS NULL"
        )
        .run(
            at.toISOString(),
            ok ? 1 : 0,
            message,
            counts === null ? null : JSON.stringify(counts),
            id
        );
    if (Number(changes) === 0) {
        throw new Error(`Sync run ${id} is not in progress`);
    }
}

/** The run of `kind` that started last (finished or not), or null if none has. */
export function latestSyncRun(
    db: DatabaseSync,
    kind: SyncRunKind
): SyncRun | null {
    const row = db
        .prepare(
            `SELECT ${COLUMNS} FROM sync_runs WHERE kind = ? ORDER BY id DESC LIMIT 1`
        )
        .get(kind);
    return row ? toSyncRun(row) : null;
}

/**
 * The latest run of each kind that has run. Kinds this build does not know
 * (a newer build's) are left out.
 */
export function latestSyncRuns(
    db: DatabaseSync
): Partial<Record<SyncRunKind, SyncRun>> {
    const latest: Partial<Record<SyncRunKind, SyncRun>> = {};
    const rows = db
        .prepare(
            `SELECT ${COLUMNS} FROM sync_runs WHERE id IN (SELECT max(id) FROM sync_runs GROUP BY kind)`
        )
        .all();
    for (const row of rows) {
        if (isSyncRunKind(row.kind)) {
            latest[row.kind] = toSyncRun(row);
        }
    }
    return latest;
}

/** The `limit` most recent runs of the kinds this build knows, newest first. */
export function recentSyncRuns(db: DatabaseSync, limit = 20): SyncRun[] {
    const kinds = SYNC_RUN_KINDS.map(() => "?").join(", ");
    return db
        .prepare(
            `SELECT ${COLUMNS} FROM sync_runs WHERE kind IN (${kinds}) ORDER BY id DESC LIMIT ?`
        )
        .all(...SYNC_RUN_KINDS, limit)
        .map(toSyncRun);
}
