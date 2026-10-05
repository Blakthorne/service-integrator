import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
    INTERRUPTED_MESSAGE,
    finishSyncRun,
    latestSyncRun,
    startSyncRun,
} from "@/lib/db/syncRuns";
import { openTestDb } from "@/lib/db/testing";

// vi.hoisted: vi.mock factories run before the module's own declarations.
const { getDb, startJobs } = vi.hoisted(() => ({
    getDb: vi.fn(),
    startJobs: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
    getDb,
    databasePath: () => "/srv/data/service-integrator.sqlite",
}));
vi.mock("@/lib/jobs", () => ({ startJobs }));

import { boot } from "./boot";

let db: DatabaseSync;

beforeEach(() => {
    db = openTestDb();
    getDb.mockReturnValue(db);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
    db.close();
    getDb.mockReset();
    startJobs.mockReset();
    vi.restoreAllMocks();
});

describe("boot", () => {
    test("opens the database, then starts the jobs", () => {
        boot();
        expect(getDb).toHaveBeenCalledOnce();
        expect(startJobs).toHaveBeenCalledOnce();
        expect(getDb.mock.invocationCallOrder[0]).toBeLessThan(
            startJobs.mock.invocationCallOrder[0]
        );
        expect(console.log).toHaveBeenCalledWith(
            "Database ready at /srv/data/service-integrator.sqlite"
        );
        expect(console.warn).not.toHaveBeenCalled();
        expect(console.error).not.toHaveBeenCalled();
    });

    test("finishes the runs the last server left in progress before starting the jobs", () => {
        const done = startSyncRun(db, "backup", new Date("2026-10-02T12:00:00.000Z"));
        finishSyncRun(db, done, { ok: true }, new Date("2026-10-02T12:00:01.000Z"));
        startSyncRun(db, "backup", new Date("2026-10-03T12:00:00.000Z"));
        startJobs.mockImplementation(() => {
            // The jobs never see a run of the old process as in progress.
            expect(latestSyncRun(db, "backup")).toMatchObject({
                ok: false,
                message: INTERRUPTED_MESSAGE,
            });
        });

        boot();
        expect(startJobs).toHaveBeenCalledOnce();
        expect(latestSyncRun(db, "backup")?.finishedAt).not.toBeNull();
        expect(console.warn).toHaveBeenCalledWith(
            "Finished 1 background run(s) the last server left in progress, as interrupted"
        );
        expect(console.error).not.toHaveBeenCalled();
    });

    test("logs a database failure and still starts the jobs", () => {
        const failure = new Error("Could not open the database");
        getDb.mockImplementation(() => {
            throw failure;
        });
        expect(() => boot()).not.toThrow();
        expect(console.error).toHaveBeenCalledWith("Database unavailable:", failure);
        expect(startJobs).toHaveBeenCalledOnce();
    });

    test("logs a failure to start the jobs instead of throwing", () => {
        const failure = new Error("no timers");
        startJobs.mockImplementation(() => {
            throw failure;
        });
        expect(() => boot()).not.toThrow();
        expect(console.error).toHaveBeenCalledWith(
            "Could not start the background jobs:",
            failure
        );
    });
});
