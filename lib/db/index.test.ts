import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { MIGRATIONS } from "./migrations";

/** The key getDb() caches the connection under (see DB_GLOBAL in index.ts). */
const DB_GLOBAL = Symbol.for("service-integrator.db.v1");

const scope = globalThis as unknown as { [DB_GLOBAL]?: DatabaseSync };

let dir: string;

beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "si-db-index-"));
    vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
    scope[DB_GLOBAL]?.close();
    delete scope[DB_GLOBAL];
    rmSync(dir, { recursive: true, force: true });
    vi.doUnmock("./migrations");
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

/** A fresh copy of the module, as another Next bundle layer would load it. */
async function loadDbModule() {
    vi.resetModules();
    return import("./index");
}

describe("getDb", () => {
    test("opens nothing at import time", async () => {
        vi.stubEnv("DATABASE_PATH", path.join(dir, "data", "app.sqlite"));
        await loadDbModule();
        expect(existsSync(path.join(dir, "data"))).toBe(false);
        expect(scope[DB_GLOBAL]).toBeUndefined();
    });

    test("opens DATABASE_PATH, creating its folder, and migrates it", async () => {
        const file = path.join(dir, "nested", "folder", "app.sqlite");
        vi.stubEnv("DATABASE_PATH", file);
        const { getDb } = await loadDbModule();

        const db = getDb();
        expect(existsSync(file)).toBe(true);
        expect(db.prepare("PRAGMA journal_mode").get()).toEqual({
            journal_mode: "wal",
        });
        expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({
            foreign_keys: 1,
        });
        expect(db.prepare("SELECT id FROM schema_migrations").all()).toEqual(
            MIGRATIONS.map(({ id }) => ({ id }))
        );
        expect(console.log).toHaveBeenCalledWith(
            `Database ${file}: applied migration 0001_init`
        );
    });

    test("returns the same connection every time, from every copy of the module", async () => {
        vi.stubEnv("DATABASE_PATH", path.join(dir, "app.sqlite"));
        const first = await loadDbModule();
        const db = first.getDb();
        expect(first.getDb()).toBe(db);

        const second = await loadDbModule();
        expect(second.getDb()).toBe(db);
    });

    test("reopens an existing database without migrating it again", async () => {
        const file = path.join(dir, "app.sqlite");
        vi.stubEnv("DATABASE_PATH", file);
        (await loadDbModule()).getDb();
        scope[DB_GLOBAL]?.close();
        delete scope[DB_GLOBAL];
        vi.mocked(console.log).mockClear();

        const db = (await loadDbModule()).getDb();
        expect(db.prepare("SELECT count(*) AS n FROM schema_migrations").get())
            .toEqual({ n: MIGRATIONS.length });
        expect(console.log).not.toHaveBeenCalled();
    });

    test("names the file it cannot open, caches nothing, and tries again next time", async () => {
        const blocker = path.join(dir, "blocker");
        writeFileSync(blocker, "a file where the folder should be");
        const file = path.join(blocker, "app.sqlite");
        vi.stubEnv("DATABASE_PATH", file);
        const { getDb } = await loadDbModule();

        expect(() => getDb()).toThrow(`Could not open the database at ${file}: `);
        expect(scope[DB_GLOBAL]).toBeUndefined();

        rmSync(blocker);
        expect(getDb().prepare("SELECT 1 AS one").get()).toEqual({ one: 1 });
    });

    test("fails, caching nothing, when a migration fails", async () => {
        vi.stubEnv("DATABASE_PATH", path.join(dir, "app.sqlite"));
        vi.doMock("./migrations", () => ({
            MIGRATIONS: [{ id: "0001_broken", sql: "CREATE TABLE broken (" }],
        }));
        const { getDb } = await loadDbModule();

        expect(() => getDb()).toThrow(
            /^Could not open the database at .*: Database migration 0001_broken failed: /
        );
        expect(scope[DB_GLOBAL]).toBeUndefined();
    });

    test("says Node 22.13 is needed when node:sqlite is missing", async () => {
        vi.stubEnv("DATABASE_PATH", path.join(dir, "app.sqlite"));
        vi.spyOn(process, "getBuiltinModule").mockReturnValue(
            undefined as never
        );
        const { getDb } = await loadDbModule();

        expect(() => getDb()).toThrow(
            /needs node:sqlite, which Node 22\.13 or later provides/
        );
        expect(scope[DB_GLOBAL]).toBeUndefined();
    });
});
