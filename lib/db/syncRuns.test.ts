import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
    INTERRUPTED_MESSAGE,
    finishInterruptedRuns,
    finishSyncRun,
    isSyncRunKind,
    latestSyncRun,
    latestSyncRuns,
    recentSyncRuns,
    startSyncRun,
    type SyncRunKind,
} from "./syncRuns";
import { openTestDb } from "./testing";

const T0 = new Date("2026-10-03T12:00:00.000Z");
const T1 = new Date("2026-10-03T12:00:05.000Z");
const T2 = new Date("2026-10-03T13:00:00.000Z");

let db: DatabaseSync;

beforeEach(() => {
    db = openTestDb();
});

afterEach(() => {
    db.close();
});

/** A row of a kind a newer build added. */
function insertFutureRun(): void {
    db.prepare(
        "INSERT INTO sync_runs (kind, started_at) VALUES ('newer-kind', ?)"
    ).run(T2.toISOString());
}

describe("isSyncRunKind", () => {
    test("accepts the known kinds only", () => {
        for (const kind of ["backup", "pco-songs", "tags", "history"]) {
            expect(isSyncRunKind(kind)).toBe(true);
        }
        expect(isSyncRunKind("newer-kind")).toBe(false);
        expect(isSyncRunKind(null)).toBe(false);
    });
});

describe("startSyncRun", () => {
    test("records a run in progress and returns its id", () => {
        const first = startSyncRun(db, "backup", T0);
        const second = startSyncRun(db, "pco-songs", T1);
        expect(second).toBeGreaterThan(first);
        expect(latestSyncRun(db, "backup")).toEqual({
            id: first,
            kind: "backup",
            startedAt: "2026-10-03T12:00:00.000Z",
            finishedAt: null,
            ok: null,
            message: null,
            counts: null,
        });
    });

    test("refuses an unknown kind", () => {
        expect(() =>
            startSyncRun(db, "newer-kind" as SyncRunKind, T0)
        ).toThrow("Unknown sync run kind: newer-kind");
        expect(recentSyncRuns(db)).toEqual([]);
    });
});

describe("finishSyncRun", () => {
    test("records a success with its message and counts", () => {
        const id = startSyncRun(db, "backup", T0);
        finishSyncRun(
            db,
            id,
            { ok: true, message: "Wrote a backup", counts: { pruned: 2 } },
            T1
        );
        expect(latestSyncRun(db, "backup")).toEqual({
            id,
            kind: "backup",
            startedAt: "2026-10-03T12:00:00.000Z",
            finishedAt: "2026-10-03T12:00:05.000Z",
            ok: true,
            message: "Wrote a backup",
            counts: { pruned: 2 },
        });
    });

    test("records a failure", () => {
        const id = startSyncRun(db, "backup", T0);
        finishSyncRun(db, id, { ok: false, message: "disk full" }, T1);
        expect(latestSyncRun(db, "backup")).toMatchObject({
            finishedAt: "2026-10-03T12:00:05.000Z",
            ok: false,
            message: "disk full",
            counts: null,
        });
    });

    test("refuses a run that is not in progress", () => {
        const id = startSyncRun(db, "backup", T0);
        finishSyncRun(db, id, { ok: true }, T1);
        expect(() => finishSyncRun(db, id, { ok: false }, T2)).toThrow(
            `Sync run ${id} is not in progress`
        );
        expect(() => finishSyncRun(db, 999, { ok: true }, T2)).toThrow(
            "Sync run 999 is not in progress"
        );
        expect(latestSyncRun(db, "backup")?.ok).toBe(true);
    });
});

describe("finishInterruptedRuns", () => {
    test("finishes every run still in progress as interrupted, and only those", () => {
        const done = startSyncRun(db, "backup", T0);
        finishSyncRun(db, done, { ok: true, message: "Wrote a backup" }, T0);
        const backup = startSyncRun(db, "backup", T1);
        const songs = startSyncRun(db, "pco-songs", T1);

        expect(finishInterruptedRuns(db, T2)).toBe(2);
        for (const id of [backup, songs]) {
            expect(recentSyncRuns(db).find((run) => run.id === id)).toMatchObject({
                finishedAt: T2.toISOString(),
                ok: false,
                message: INTERRUPTED_MESSAGE,
            });
        }
        expect(recentSyncRuns(db).find((run) => run.id === done)).toMatchObject({
            finishedAt: T0.toISOString(),
            ok: true,
            message: "Wrote a backup",
        });
        expect(INTERRUPTED_MESSAGE).toBe("interrupted (the server restarted)");
    });

    test("finishes nothing when no run is in progress", () => {
        const id = startSyncRun(db, "backup", T0);
        finishSyncRun(db, id, { ok: false, message: "disk full" }, T1);
        expect(finishInterruptedRuns(db, T2)).toBe(0);
        expect(latestSyncRun(db, "backup")?.message).toBe("disk full");
    });
});

describe("latestSyncRun", () => {
    test("is null before the first run of the kind", () => {
        startSyncRun(db, "pco-songs", T0);
        expect(latestSyncRun(db, "backup")).toBeNull();
    });

    test("is the run that started last, even if an earlier one finished later", () => {
        const earlier = startSyncRun(db, "backup", T0);
        const later = startSyncRun(db, "backup", T1);
        finishSyncRun(db, later, { ok: true }, T1);
        finishSyncRun(db, earlier, { ok: false }, T2);
        expect(latestSyncRun(db, "backup")).toMatchObject({ id: later, ok: true });
    });
});

describe("latestSyncRuns", () => {
    test("gives the latest run of each kind that has run, leaving out unknown kinds", () => {
        startSyncRun(db, "backup", T0);
        const backup = startSyncRun(db, "backup", T1);
        const songs = startSyncRun(db, "pco-songs", T1);
        insertFutureRun();
        const latest = latestSyncRuns(db);
        expect(Object.keys(latest).sort()).toEqual(["backup", "pco-songs"]);
        expect(latest.backup?.id).toBe(backup);
        expect(latest["pco-songs"]?.id).toBe(songs);
    });

    test("is empty before any run", () => {
        expect(latestSyncRuns(db)).toEqual({});
    });
});

describe("recentSyncRuns", () => {
    test("lists runs newest first, up to the limit, leaving out unknown kinds", () => {
        const ids = [
            startSyncRun(db, "backup", T0),
            startSyncRun(db, "pco-songs", T0),
            startSyncRun(db, "tags", T1),
        ];
        insertFutureRun();
        expect(recentSyncRuns(db).map(({ id }) => id)).toEqual(
            [...ids].reverse()
        );
        expect(recentSyncRuns(db, 2).map(({ id }) => id)).toEqual([
            ids[2],
            ids[1],
        ]);
    });
});
