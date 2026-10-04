import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { openTestDb } from "../testing";
import { MIGRATIONS } from ".";

describe("MIGRATIONS", () => {
    const ids = MIGRATIONS.map(({ id }) => id);

    test("ids are unique", () => {
        expect(new Set(ids).size).toBe(ids.length);
    });

    test("ids are sorted", () => {
        expect([...ids].sort()).toEqual(ids);
    });

    test("ids are numbered 0001, 0002, … in order, then a snake_case name", () => {
        ids.forEach((id, index) => {
            expect(id).toMatch(/^\d{4}_[a-z0-9]+(?:_[a-z0-9]+)*$/);
            expect(id.slice(0, 4)).toBe(String(index + 1).padStart(4, "0"));
        });
    });

    test("starts with 0001_init", () => {
        expect(ids[0]).toBe("0001_init");
    });
});

describe("the migrated schema", () => {
    let db: DatabaseSync;

    beforeEach(() => {
        db = openTestDb();
    });

    afterEach(() => {
        db.close();
    });

    function columns(table: string): string[] {
        return db
            .prepare("SELECT name FROM pragma_table_info(?) ORDER BY cid")
            .all(table)
            .map((row) => String(row.name));
    }

    test("every table is STRICT", () => {
        const loose = db
            .prepare(
                "SELECT name FROM pragma_table_list WHERE schema = 'main' AND type = 'table' AND name NOT LIKE 'sqlite_%' AND strict = 0"
            )
            .all();
        expect(loose).toEqual([]);
    });

    test("0001_init creates settings and sync_runs", () => {
        expect(columns("settings")).toEqual(["key", "value", "updated_at"]);
        expect(columns("sync_runs")).toEqual([
            "id",
            "kind",
            "started_at",
            "finished_at",
            "ok",
            "message",
            "counts",
        ]);
    });

    test("a setting's value must be JSON", () => {
        const insert = db.prepare(
            "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)"
        );
        insert.run("hymnNoteCategoryName", '"Hymnal"', "2026-10-03T12:00:00.000Z");
        expect(() =>
            insert.run("broken", "not json", "2026-10-03T12:00:00.000Z")
        ).toThrow(/CHECK constraint failed/);
    });

    test("a sync run is finished with both finished_at and ok, or neither", () => {
        const insert = db.prepare(
            "INSERT INTO sync_runs (kind, started_at, finished_at, ok) VALUES ('backup', '2026-10-03T12:00:00.000Z', ?, ?)"
        );
        insert.run(null, null);
        insert.run("2026-10-03T12:00:01.000Z", 1);
        expect(() => insert.run("2026-10-03T12:00:01.000Z", null)).toThrow(
            /CHECK constraint failed/
        );
        expect(() => insert.run(null, 0)).toThrow(/CHECK constraint failed/);
        expect(() => insert.run("2026-10-03T12:00:01.000Z", 2)).toThrow(
            /CHECK constraint failed/
        );
    });

    test("a sync run's counts must be JSON", () => {
        const insert = db.prepare(
            "INSERT INTO sync_runs (kind, started_at, counts) VALUES ('backup', '2026-10-03T12:00:00.000Z', ?)"
        );
        insert.run('{"pruned":1}');
        insert.run(null);
        expect(() => insert.run("{oops")).toThrow(/CHECK constraint failed/);
    });
});
