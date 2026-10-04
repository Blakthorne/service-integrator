import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, test, vi } from "vitest";
import { BUSY_TIMEOUT_MS, loadSqlite, openDatabase } from "./connection";

let db: DatabaseSync | undefined;
let dir: string | undefined;

afterEach(() => {
    db?.close();
    db = undefined;
    if (dir) {
        rmSync(dir, { recursive: true, force: true });
        dir = undefined;
    }
    vi.restoreAllMocks();
});

/** The value a `PRAGMA name` query returns. */
function pragma(database: DatabaseSync, name: string): unknown {
    const row = database.prepare(`PRAGMA ${name}`).get();
    return row ? Object.values(row)[0] : undefined;
}

describe("openDatabase", () => {
    test("turns foreign keys on and sets the busy timeout", () => {
        db = openDatabase(":memory:");
        expect(pragma(db, "foreign_keys")).toBe(1);
        expect(pragma(db, "busy_timeout")).toBe(BUSY_TIMEOUT_MS);
    });

    test("enforces foreign keys", () => {
        const database = (db = openDatabase(":memory:"));
        database.exec(`
            CREATE TABLE parent (id INTEGER PRIMARY KEY) STRICT;
            CREATE TABLE child (parent_id INTEGER NOT NULL REFERENCES parent (id)) STRICT;
        `);
        expect(() => database.exec("INSERT INTO child VALUES (1)")).toThrow(
            /FOREIGN KEY constraint failed/
        );
    });

    test("uses the WAL journal for a file", () => {
        dir = mkdtempSync(path.join(tmpdir(), "si-db-connection-"));
        db = openDatabase(path.join(dir, "test.sqlite"));
        expect(pragma(db, "journal_mode")).toBe("wal");
    });

    test("leaves an in-memory database's journal in memory", () => {
        db = openDatabase(":memory:");
        expect(pragma(db, "journal_mode")).toBe("memory");
    });
});

describe("loadSqlite", () => {
    test("returns node:sqlite", () => {
        expect(typeof loadSqlite().DatabaseSync).toBe("function");
    });

    test("says Node 22.13 is needed when node:sqlite is missing", () => {
        vi.spyOn(process, "getBuiltinModule").mockReturnValue(
            undefined as never
        );
        expect(() => loadSqlite()).toThrow(
            /needs node:sqlite, which Node 22\.13 or later provides; this is Node v/
        );
        expect(() => openDatabase(":memory:")).toThrow(/Node 22\.13/);
    });

    test("says the same when loading node:sqlite throws", () => {
        vi.spyOn(process, "getBuiltinModule").mockImplementation(() => {
            throw new Error("No such built-in module: node:sqlite");
        });
        expect(() => loadSqlite()).toThrow(/Node 22\.13/);
    });
});
