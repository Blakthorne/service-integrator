import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { openDatabase } from "./connection";
import { appliedMigrations, migrate } from "./migrate";
import type { Migration } from "./migrations";

const first: Migration = {
    id: "0001_first",
    sql: "CREATE TABLE a (id INTEGER PRIMARY KEY) STRICT;",
};
const second: Migration = {
    id: "0002_second",
    sql: "CREATE TABLE b (id INTEGER PRIMARY KEY) STRICT; INSERT INTO b VALUES (1);",
};
// Its first statement works and its second fails.
const broken: Migration = {
    id: "0002_broken",
    sql: "CREATE TABLE c (id INTEGER PRIMARY KEY) STRICT; INSERT INTO nowhere VALUES (1);",
};

const at = (iso: string) => () => new Date(iso);
const clock = at("2026-10-03T12:00:00.000Z");

let db: DatabaseSync;

beforeEach(() => {
    db = openDatabase(":memory:");
});

afterEach(() => {
    db.close();
    vi.restoreAllMocks();
});

function tables(): string[] {
    return db
        .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name")
        .all()
        .map((row) => String(row.name));
}

describe("migrate", () => {
    test("applies every migration to a new database, in order, and records each", () => {
        expect(migrate(db, [first, second], clock)).toEqual({
            applied: ["0001_first", "0002_second"],
            unknown: [],
        });
        expect(tables()).toEqual(["a", "b", "schema_migrations"]);
        expect(appliedMigrations(db)).toEqual([
            { id: "0001_first", appliedAt: "2026-10-03T12:00:00.000Z" },
            { id: "0002_second", appliedAt: "2026-10-03T12:00:00.000Z" },
        ]);
    });

    test("does nothing when the schema is up to date", () => {
        migrate(db, [first, second], clock);
        expect(migrate(db, [first, second], clock)).toEqual({
            applied: [],
            unknown: [],
        });
        // The second migration's INSERT ran once.
        expect(db.prepare("SELECT count(*) AS n FROM b").get()).toEqual({ n: 1 });
    });

    test("applies only the migrations the database lacks", () => {
        migrate(db, [first], clock);
        const result = migrate(db, [first, second], at("2026-10-04T08:00:00.000Z"));
        expect(result.applied).toEqual(["0002_second"]);
        expect(appliedMigrations(db)).toEqual([
            { id: "0001_first", appliedAt: "2026-10-03T12:00:00.000Z" },
            { id: "0002_second", appliedAt: "2026-10-04T08:00:00.000Z" },
        ]);
    });

    test("a failing migration throws, naming it, and leaves nothing of itself", () => {
        expect(() => migrate(db, [first, broken, second], clock)).toThrow(
            "Database migration 0002_broken failed: no such table: nowhere"
        );
        // Its table was rolled back with it, and the next one never ran.
        expect(tables()).toEqual(["a", "schema_migrations"]);
        expect(appliedMigrations(db).map(({ id }) => id)).toEqual(["0001_first"]);
    });

    test("keeps the SQLite error as the cause", () => {
        let thrown: unknown;
        try {
            migrate(db, [broken], clock);
        } catch (error) {
            thrown = error;
        }
        expect((thrown as Error).cause).toBeInstanceOf(Error);
        expect(((thrown as Error).cause as Error).message).toBe(
            "no such table: nowhere"
        );
    });

    test("warns about migrations it does not know and carries on", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        migrate(db, [first, second], clock);
        // An older build, which knows only the first migration.
        expect(migrate(db, [first], clock)).toEqual({
            applied: [],
            unknown: ["0002_second"],
        });
        expect(warn).toHaveBeenCalledOnce();
        expect(warn.mock.calls[0][0]).toContain("0002_second");
        expect(tables()).toEqual(["a", "b", "schema_migrations"]);
    });
});
