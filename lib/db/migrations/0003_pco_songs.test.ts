import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { parsePcoId } from "@/lib/pco";
import { openTestDb } from "../testing";

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

/** Insert a mirrored song with only the columns that must be given. */
function insert(
    id: SQLInputValue,
    title: SQLInputValue = "Amazing Grace",
    syncedAt: SQLInputValue = "2026-10-04T12:00:00.000Z"
) {
    db.prepare("INSERT INTO pco_songs (id, title, synced_at) VALUES (?, ?, ?)").run(
        id,
        title,
        syncedAt
    );
}

describe("0003_pco_songs", () => {
    test("creates the mirror of the Planning Center song library", () => {
        expect(columns("pco_songs")).toEqual([
            "id",
            "title",
            "author",
            "copyright",
            "ccli_number",
            "admin",
            "themes",
            "hidden",
            "last_scheduled_at",
            "created_at",
            "updated_at",
            "synced_at",
            "removed_at",
            "ignored_at",
            "auto_link_blocked_at",
        ]);
    });

    test("an id is exactly what parsePcoId accepts, so it can go into a request path", () => {
        const ids = [
            "1",
            "397",
            "12345678901234567890",
            "",
            "0",
            "01",
            "-1",
            "1.5",
            "1e3",
            " 1",
            "1 ",
            "12a",
            "../1",
            "123456789012345678901",
        ];
        for (const id of ids) {
            let stored = true;
            try {
                insert(id);
            } catch (error) {
                expect(String(error)).toMatch(/CHECK constraint failed/);
                stored = false;
            }
            expect([id, stored]).toEqual([id, parsePcoId(id) !== null]);
        }
    });

    test("an id is unique", () => {
        insert("1");
        expect(() => insert("1")).toThrow(/UNIQUE constraint failed: pco_songs.id/);
    });

    test("a song is not hidden unless it says so, and hidden is 0 or 1", () => {
        insert("1");
        expect(db.prepare("SELECT hidden FROM pco_songs WHERE id = '1'").get()).toEqual({
            hidden: 0,
        });
        expect(() =>
            db
                .prepare(
                    "INSERT INTO pco_songs (id, title, synced_at, hidden) VALUES ('2', 'x', 'y', 2)"
                )
                .run()
        ).toThrow(/CHECK constraint failed/);
    });

    test("a song has a title and the time it was synced", () => {
        expect(() => insert("1", null)).toThrow(/NOT NULL constraint failed: pco_songs.title/);
        expect(() => insert("1", "Amazing Grace", null)).toThrow(
            /NOT NULL constraint failed: pco_songs.synced_at/
        );
    });

    test("a CCLI number is an integer", () => {
        const update = db.prepare("UPDATE pco_songs SET ccli_number = ? WHERE id = '1'");
        insert("1");
        update.run(22025);
        expect(() => update.run(1.5)).toThrow(/cannot store REAL value in INTEGER column/);
        expect(() => update.run("CCLI 22025")).toThrow(/cannot store TEXT value in INTEGER column/);
    });
});
