import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

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

beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
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
