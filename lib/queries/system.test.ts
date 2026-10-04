import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { finishSyncRun, startSyncRun } from "@/lib/db/syncRuns";
import { openTestDb } from "@/lib/db/testing";

// vi.hoisted: vi.mock factories run before the module's own declarations.
const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/lib/db", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/db")>()),
    getDb,
}));

import { getDatabaseStatus } from "./system";

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
            appliedMigrations: 1,
            latestMigration: "0001_init",
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
