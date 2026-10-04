import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
    CREDIT_PARSE_STATUSES,
    findSongCredits,
    isCreditParseStatus,
    replaceSongCredits,
} from "./credits";
import { openTestDb, seedPcoSong, seedPcoSongCredits } from "./testing";

let db: DatabaseSync;

beforeEach(() => {
    db = openTestDb();
    seedPcoSong(db, { id: "1001", title: "O God, Our Help in Ages Past" });
    seedPcoSong(db, { id: "1002", title: "Amazing Grace" });
});

afterEach(() => {
    vi.restoreAllMocks();
    db.close();
});

/** A song's rows as stored, in position order. */
function rows(pcoSongId: string) {
    return db
        .prepare(
            "SELECT role, name, position, parse_status FROM pco_song_credits WHERE pco_song_id = ? ORDER BY position"
        )
        .all(pcoSongId)
        .map((row) => ({ ...row }));
}

const OUR_HELP = {
    status: "ok" as const,
    credits: [
        { role: "Words", names: ["Isaac Watts"] },
        { role: "Music", names: ["William Croft"] },
        { role: "Arr.", names: ["A. Arranger", "B. Arranger"] },
    ],
};

describe("isCreditParseStatus", () => {
    test("accepts the known statuses only", () => {
        expect(CREDIT_PARSE_STATUSES).toEqual(["ok", "legacy", "unparsed"]);
        for (const status of CREDIT_PARSE_STATUSES) {
            expect(isCreditParseStatus(status)).toBe(true);
        }
        for (const value of ["newer-status", "OK", "", null]) {
            expect(isCreditParseStatus(value)).toBe(false);
        }
    });
});

describe("replaceSongCredits", () => {
    test("stores a row for each name of each role, numbered in order, with the status", () => {
        replaceSongCredits(db, "1001", OUR_HELP);
        expect(rows("1001")).toEqual([
            { role: "Words", name: "Isaac Watts", position: 0, parse_status: "ok" },
            { role: "Music", name: "William Croft", position: 1, parse_status: "ok" },
            { role: "Arr.", name: "A. Arranger", position: 2, parse_status: "ok" },
            { role: "Arr.", name: "B. Arranger", position: 3, parse_status: "ok" },
        ]);
    });

    test("replaces what the song had, and only that song's rows", () => {
        replaceSongCredits(db, "1001", OUR_HELP);
        replaceSongCredits(db, "1002", {
            status: "legacy",
            credits: [
                { role: "Words", names: ["John Newton"] },
                { role: "Music", names: ["John Newton"] },
            ],
        });
        replaceSongCredits(db, "1001", {
            status: "ok",
            credits: [{ role: "Words", names: ["Isaac Watts"] }],
        });
        expect(rows("1001")).toEqual([
            { role: "Words", name: "Isaac Watts", position: 0, parse_status: "ok" },
        ]);
        expect(rows("1002")).toHaveLength(2);
    });

    test("credits that name nobody leave one row that holds only the status", () => {
        replaceSongCredits(db, "1001", OUR_HELP);
        replaceSongCredits(db, "1001", { status: "unparsed", credits: [] });
        expect(rows("1001")).toEqual([
            { role: null, name: null, position: 0, parse_status: "unparsed" },
        ]);
        replaceSongCredits(db, "1001", { status: "legacy", credits: [] });
        expect(rows("1001")).toEqual([
            { role: null, name: null, position: 0, parse_status: "legacy" },
        ]);
    });

    test("refuses, writing nothing, a status it does not know, a role with no names, or a blank role or name", () => {
        replaceSongCredits(db, "1001", OUR_HELP);
        const before = rows("1001");
        const refusals: [unknown, RegExp][] = [
            [{ status: "newer-status", credits: [] }, /Unknown credit parse status: "newer-status"/],
            [{ status: "ok", credits: [{ role: "Words", names: [] }] }, /The credit for "Words" names nobody/],
            [{ status: "ok", credits: [{ role: " ", names: ["X"] }] }, /A credit's role must not be blank/],
            [
                { status: "ok", credits: [{ role: "Words", names: ["X", "  "] }] },
                /A name credited for "Words" is blank/,
            ],
        ];
        for (const [songCredits, message] of refusals) {
            expect(() =>
                replaceSongCredits(db, "1001", songCredits as Parameters<typeof replaceSongCredits>[2])
            ).toThrow(message);
        }
        expect(rows("1001")).toEqual(before);
    });

    test("refuses a song the mirror lacks", () => {
        expect(() => replaceSongCredits(db, "2002", OUR_HELP)).toThrow(/FOREIGN KEY constraint failed/);
        expect(rows("2002")).toEqual([]);
    });
});

describe("findSongCredits", () => {
    test("reads a song's credits back as they were stored", () => {
        replaceSongCredits(db, "1001", OUR_HELP);
        expect(findSongCredits(db, "1001")).toEqual(OUR_HELP);
    });

    test("gives the status of a song whose author names nobody, with no credits", () => {
        seedPcoSongCredits(db, "1001", [], "unparsed");
        expect(findSongCredits(db, "1001")).toEqual({ status: "unparsed", credits: [] });
    });

    test("is null for a song whose author has not been read, or one the mirror lacks", () => {
        expect(findSongCredits(db, "1001")).toBeNull();
        expect(findSongCredits(db, "2002")).toBeNull();
    });

    test("is null for a song whose status a newer build wrote", () => {
        seedPcoSongCredits(db, "1001", [{ role: "Words", names: ["Isaac Watts"] }], "newer-status");
        expect(findSongCredits(db, "1001")).toBeNull();
    });

    test("gives each role once, where its first name comes, with its names in position order", () => {
        const insert = db.prepare(
            "INSERT INTO pco_song_credits (pco_song_id, role, name, position, parse_status) VALUES ('1001', ?, ?, ?, 'ok')"
        );
        insert.run("Music", "William Croft", 2);
        insert.run("Words", "Isaac Watts", 0);
        insert.run("Words", "A. Reviser", 3);
        insert.run("Music", "B. Composer", 1);
        expect(findSongCredits(db, "1001")).toEqual({
            status: "ok",
            credits: [
                { role: "Words", names: ["Isaac Watts", "A. Reviser"] },
                { role: "Music", names: ["B. Composer", "William Croft"] },
            ],
        });
    });

    test("asks one query", () => {
        const prepare = vi.spyOn(db, "prepare");
        findSongCredits(db, "1001");
        expect(prepare).toHaveBeenCalledTimes(1);
    });
});
