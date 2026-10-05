import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { MIGRATIONS } from "@/lib/db/migrations";
import { finishSyncRun, startSyncRun } from "@/lib/db/syncRuns";
import { openTestDb, seedHistoryPlan, seedOccurrence } from "@/lib/db/testing";

// vi.hoisted: vi.mock factories run before the module's own declarations.
const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/lib/db", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/db")>()),
    getDb,
}));

import { getDatabaseStatus, getLastHistorySync, getLastPcoSongsSync } from "./system";

let db: DatabaseSync;

beforeEach(() => {
    db = openTestDb();
    getDb.mockReturnValue(db);
    vi.stubEnv("DATABASE_PATH", "/srv/data/service-integrator.sqlite");
    vi.stubEnv("DATABASE_BACKUP_DIR", "/srv/data/backups");
    vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
    db.close();
    getDb.mockReset();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

describe("getDatabaseStatus", () => {
    test("reports the file, the migrations and that there is no backup yet", () => {
        expect(getDatabaseStatus()).toEqual({
            ok: true,
            path: "/srv/data/service-integrator.sqlite",
            appliedMigrations: MIGRATIONS.length,
            latestMigration: MIGRATIONS.at(-1)?.id,
            lastBackup: null,
            backupDir: "/srv/data/backups",
        });
    });

    test("reports the latest backup run", () => {
        const at = new Date("2026-10-03T12:00:00.000Z");
        const id = startSyncRun(db, "backup", at);
        finishSyncRun(db, id, { ok: true, message: "Wrote a backup" }, at);
        startSyncRun(db, "pco-songs", at);

        const status = getDatabaseStatus();
        expect(status.ok && status.lastBackup).toMatchObject({
            id,
            kind: "backup",
            ok: true,
            finishedAt: "2026-10-03T12:00:00.000Z",
            message: "Wrote a backup",
        });
    });

    test("returns the error when the database cannot be opened", () => {
        getDb.mockImplementation(() => {
            throw new Error("Could not open the database at /srv/data/x: denied");
        });
        expect(getDatabaseStatus()).toEqual({
            ok: false,
            error: "Could not open the database at /srv/data/x: denied",
        });
        expect(console.error).toHaveBeenCalledOnce();
    });

    test("returns the error when reading the database fails", () => {
        db.exec("DROP TABLE sync_runs");
        const status = getDatabaseStatus();
        expect(status).toEqual({
            ok: false,
            error: expect.stringContaining("no such table: sync_runs"),
        });
    });
});

describe("getLastPcoSongsSync", () => {
    test("is null before the first run", () => {
        expect(getLastPcoSongsSync()).toEqual({ ok: true, lastRun: null });
    });

    test("gives the latest run of the song sync, finished or not", () => {
        const at = new Date("2026-10-03T12:00:00.000Z");
        const first = startSyncRun(db, "pco-songs", at);
        finishSyncRun(db, first, { ok: true, message: "Synced 397 songs: no changes" }, at);
        startSyncRun(db, "backup", at);
        expect(getLastPcoSongsSync()).toEqual({
            ok: true,
            lastRun: expect.objectContaining({
                id: first,
                kind: "pco-songs",
                ok: true,
                message: "Synced 397 songs: no changes",
            }),
        });

        const second = startSyncRun(db, "pco-songs", at);
        expect(getLastPcoSongsSync()).toEqual({
            ok: true,
            lastRun: expect.objectContaining({ id: second, finishedAt: null, ok: null }),
        });
    });

    test("logs, and says so, when the database cannot be read", () => {
        getDb.mockImplementation(() => {
            throw new Error("Could not open the database at /srv/data/x: denied");
        });
        expect(getLastPcoSongsSync()).toEqual({ ok: false });
        expect(console.error).toHaveBeenCalledOnce();
    });
});

describe("getLastHistorySync", () => {
    test("is no run and an empty history before the first sync", () => {
        expect(getLastHistorySync()).toEqual({
            ok: true,
            lastRun: null,
            counts: { plans: 0, plansRead: 0, occurrences: 0, firstPlanDate: null, lastPlanDate: null },
        });
    });

    test("gives the latest run of the history sync, finished or not, and what the history holds", () => {
        const at = new Date("2026-10-03T12:00:00.000Z");
        const first = startSyncRun(db, "history", at);
        finishSyncRun(db, first, { ok: true, message: "Synced 2 plans" }, at);
        startSyncRun(db, "pco-songs", at);
        const plan = seedHistoryPlan(db, { planDate: "2026-09-27" });
        seedHistoryPlan(db, { planDate: "2026-10-04", itemsSyncedAt: null });
        seedOccurrence(db, { planId: plan, pcoSongId: "5001" });
        expect(getLastHistorySync()).toEqual({
            ok: true,
            lastRun: expect.objectContaining({ id: first, kind: "history", ok: true, message: "Synced 2 plans" }),
            counts: {
                plans: 2,
                plansRead: 1,
                occurrences: 1,
                firstPlanDate: "2026-09-27",
                lastPlanDate: "2026-10-04",
            },
        });

        const second = startSyncRun(db, "history", at);
        expect(getLastHistorySync()).toMatchObject({
            ok: true,
            lastRun: { id: second, finishedAt: null, ok: null },
        });
    });

    test("logs, and says so, when the database cannot be read", () => {
        getDb.mockImplementation(() => {
            throw new Error("Could not open the database at /srv/data/x: denied");
        });
        expect(getLastHistorySync()).toEqual({ ok: false });
        expect(console.error).toHaveBeenCalledOnce();
    });
});
