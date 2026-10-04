import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { parsePcoId } from "@/lib/pco";
import { openTestDb, seedPcoSong } from "../testing";

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

function count(table: string): number {
    return Number(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n);
}

/** Store a credit row, each column given or a valid default. */
function credit({
    pcoSongId = "1001",
    role = "Words",
    name = "Isaac Watts",
    position = 0,
    parseStatus = "ok",
}: Partial<Record<"pcoSongId" | "role" | "name" | "position" | "parseStatus", SQLInputValue>> = {}) {
    db.prepare(
        "INSERT INTO pco_song_credits (pco_song_id, role, name, position, parse_status) VALUES (?, ?, ?, ?, ?)"
    ).run(pcoSongId, role, name, position, parseStatus);
}

function group(id: SQLInputValue, allowMultiple: SQLInputValue = 1, tagsFor: SQLInputValue = "song") {
    db.prepare(
        "INSERT INTO pco_tag_groups (id, name, tags_for, allow_multiple) VALUES (?, 'Type', ?, ?)"
    ).run(id, tagsFor, allowMultiple);
}

function tag(id: SQLInputValue, groupId: SQLInputValue) {
    db.prepare("INSERT INTO pco_tags (id, group_id, name) VALUES (?, ?, 'Hymn')").run(id, groupId);
}

function songTag(pcoSongId: SQLInputValue, tagId: SQLInputValue) {
    db.prepare("INSERT INTO pco_song_tags (pco_song_id, tag_id) VALUES (?, ?)").run(pcoSongId, tagId);
}

/** Whether `insert` stores a row, or a CHECK refuses it. */
function storesWithCheck(insert: () => void): boolean {
    try {
        insert();
        return true;
    } catch (error) {
        expect(String(error)).toMatch(/CHECK constraint failed/);
        return false;
    }
}

/** Ids to try against a CHECK that holds them to what parsePcoId accepts. */
const IDS = ["1", "8000001", "12345678901234567890", "", "0", "01", "-1", "1.5", " 1", "1a", "../1", "123456789012345678901"];

describe("0005_credits_tags: pco_song_credits", () => {
    beforeEach(() => {
        seedPcoSong(db, { id: "1001" });
    });

    test("holds a song's credits, a row for each name of each role", () => {
        expect(columns("pco_song_credits")).toEqual([
            "pco_song_id",
            "role",
            "name",
            "position",
            "parse_status",
        ]);
    });

    test("has one row per position of a song", () => {
        credit({ position: 0 });
        credit({ position: 1, role: "Music", name: "William Croft" });
        expect(() => credit({ position: 1, role: "Arr.", name: "Someone" })).toThrow(
            /UNIQUE constraint failed: pco_song_credits.pco_song_id, pco_song_credits.position/
        );
        expect(() => credit({ position: -1 })).toThrow(/CHECK constraint failed/);
    });

    test("belongs to a song of the mirror", () => {
        expect(() => credit({ pcoSongId: "2002" })).toThrow(/FOREIGN KEY constraint failed/);
    });

    test("has both a role and a name, or neither (the row that holds only the status)", () => {
        credit({ role: null, name: null, parseStatus: "unparsed" });
        db.prepare("DELETE FROM pco_song_credits").run();
        expect(() => credit({ role: null })).toThrow(/CHECK constraint failed/);
        expect(() => credit({ name: null })).toThrow(/CHECK constraint failed/);
        expect(() => credit({ role: "" })).toThrow(/CHECK constraint failed/);
        expect(() => credit({ name: "" })).toThrow(/CHECK constraint failed/);
    });

    test("needs a parse status, which is not checked here", () => {
        expect(() => credit({ parseStatus: null })).toThrow(
            /NOT NULL constraint failed: pco_song_credits.parse_status/
        );
        // A newer build's status is stored; readers skip it (lib/db/credits.ts).
        credit({ parseStatus: "newer-status" });
    });
});

describe("0005_credits_tags: the song tag mirror", () => {
    test("holds tag groups, their tags, which songs have each tag, and when each song's were written", () => {
        expect(columns("pco_tag_groups")).toEqual(["id", "name", "tags_for", "allow_multiple"]);
        expect(columns("pco_tags")).toEqual(["id", "group_id", "name"]);
        expect(columns("pco_song_tags")).toEqual(["pco_song_id", "tag_id"]);
        expect(columns("pco_song_tags_written")).toEqual(["pco_song_id", "written_at"]);
    });

    test("a group's and a tag's ids are exactly what parsePcoId accepts", () => {
        group("7");
        for (const id of IDS) {
            const expected = parsePcoId(id) !== null;
            expect([id, storesWithCheck(() => group(id))]).toEqual([id, expected]);
            expect([id, storesWithCheck(() => tag(id, "7"))]).toEqual([id, expected]);
            db.prepare("DELETE FROM pco_tags").run();
            db.prepare("DELETE FROM pco_tag_groups WHERE id <> '7'").run();
        }
    });

    test("allow_multiple is 0 or 1, and the group's tags_for is not checked here", () => {
        group("1", 0);
        group("2", 1);
        expect(() => group("3", 2)).toThrow(/CHECK constraint failed/);
        expect(() => group("4", null)).toThrow(/NOT NULL constraint failed: pco_tag_groups.allow_multiple/);
        group("5", 1, "arrangement");
    });

    test("a tag belongs to a group, and a song's tag to a mirrored song and a tag", () => {
        seedPcoSong(db, { id: "1001" });
        group("1");
        expect(() => tag("10", "2")).toThrow(/FOREIGN KEY constraint failed/);
        tag("10", "1");
        songTag("1001", "10");
        expect(() => songTag("1001", "10")).toThrow(/UNIQUE constraint failed/);
        expect(() => songTag("2002", "10")).toThrow(/FOREIGN KEY constraint failed/);
        expect(() => songTag("1001", "11")).toThrow(/FOREIGN KEY constraint failed/);
    });

    test("deleting a group deletes its tags, and deleting a tag takes it off every song", () => {
        seedPcoSong(db, { id: "1001" });
        seedPcoSong(db, { id: "1002" });
        group("1");
        group("2");
        tag("10", "1");
        tag("11", "1");
        tag("20", "2");
        songTag("1001", "10");
        songTag("1002", "10");
        songTag("1002", "20");

        db.prepare("DELETE FROM pco_tags WHERE id = '10'").run();
        expect(count("pco_song_tags")).toBe(1);

        db.prepare("DELETE FROM pco_tag_groups WHERE id = '2'").run();
        expect(db.prepare("SELECT id FROM pco_tags ORDER BY id").all()).toEqual([{ id: "11" }]);
        expect(count("pco_song_tags")).toBe(0);
    });
});

describe("0005_credits_tags: when each song's tags were written", () => {
    function written(pcoSongId: SQLInputValue, writtenAt: SQLInputValue = "2026-10-04T12:00:00.000Z") {
        db.prepare("INSERT INTO pco_song_tags_written (pco_song_id, written_at) VALUES (?, ?)").run(
            pcoSongId,
            writtenAt
        );
    }

    beforeEach(() => {
        seedPcoSong(db, { id: "1001" });
    });

    test("has one row per song, of a song the mirror has", () => {
        written("1001");
        expect(() => written("1001")).toThrow(
            /UNIQUE constraint failed: pco_song_tags_written.pco_song_id/
        );
        expect(() => written("2002")).toThrow(/FOREIGN KEY constraint failed/);
    });

    test("needs the time", () => {
        expect(() => written("1001", null)).toThrow(
            /NOT NULL constraint failed: pco_song_tags_written.written_at/
        );
    });

    test("deleting the song deletes its row", () => {
        written("1001");
        db.prepare("DELETE FROM pco_songs WHERE id = '1001'").run();
        expect(count("pco_song_tags_written")).toBe(0);
    });
});
