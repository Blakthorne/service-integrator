import type { DatabaseSync, StatementSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { findSongCredits } from "@/lib/db/credits";
import { openTestDb, seedPcoSong, seedPcoSongCredits, seedSetting } from "@/lib/db/testing";
import { stubFetchRoutes } from "@/lib/pco/testing";

const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/lib/db", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/db")>()),
    getDb,
}));

import { getCreditLabelSets, rederiveAllCredits } from "./credits";

let db: DatabaseSync;

beforeEach(() => {
    db = openTestDb();
    getDb.mockReturnValue(db);
});

afterEach(() => {
    db.close();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

/** Three mirrored songs, each with credits derived with the default roles. */
function seedSongs() {
    seedPcoSong(db, { id: "1001", author: "Text: Isaac Watts; Tune: William Croft" });
    seedPcoSongCredits(db, "1001", [], "unparsed");
    seedPcoSong(db, {
        id: "1002",
        author: "Words: John Newton",
        removedAt: "2026-10-04T13:00:00.000Z",
    });
    seedPcoSongCredits(db, "1002", [{ role: "Words", names: ["John Newton"] }]);
    seedPcoSong(db, { id: "1003", author: "Lowell Mason", ignoredAt: "2026-10-04T13:00:00.000Z" });
}

describe("rederiveAllCredits", () => {
    test("reads every mirrored song's author again with the stored roles, removed and ignored songs too", () => {
        seedSongs();
        seedSetting(db, "creditRoles", ["Text", "Tune"]);

        expect(rederiveAllCredits()).toEqual({ songs: 3, ok: 1, legacy: 1, unparsed: 1 });
        expect(findSongCredits(db, "1001")).toEqual({
            status: "ok",
            credits: [
                { role: "Text", names: ["Isaac Watts"] },
                { role: "Tune", names: ["William Croft"] },
            ],
        });
        expect(findSongCredits(db, "1002")).toEqual({ status: "unparsed", credits: [] });
        expect(findSongCredits(db, "1003")).toEqual({
            status: "legacy",
            credits: [
                { role: "Text", names: ["Lowell Mason"] },
                { role: "Tune", names: ["Lowell Mason"] },
            ],
        });
    });

    test("reads them with the default roles when the stored ones do not parse, or none are stored", () => {
        seedSongs();
        seedSetting(db, "creditRoles", ["Text"]);
        expect(rederiveAllCredits()).toEqual({ songs: 3, ok: 1, legacy: 1, unparsed: 1 });
        expect(findSongCredits(db, "1002")).toEqual({
            status: "ok",
            credits: [{ role: "Words", names: ["John Newton"] }],
        });

        db.prepare("DELETE FROM settings").run();
        expect(rederiveAllCredits()).toEqual({ songs: 3, ok: 1, legacy: 1, unparsed: 1 });
    });

    test("gives zero songs for an empty mirror", () => {
        expect(rederiveAllCredits()).toEqual({ songs: 0, ok: 0, legacy: 0, unparsed: 0 });
    });

    test("asks Planning Center nothing", () => {
        seedSongs();
        const fetchMock = stubFetchRoutes({});
        rederiveAllCredits();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    test("is one transaction: a failure part-way leaves every song's credits as they were", () => {
        seedSongs();
        seedSetting(db, "creditRoles", ["Text", "Tune"]);
        const before = ["1001", "1002", "1003"].map((id) => findSongCredits(db, id));

        // The second song's credits fail to store.
        const prepare = db.prepare.bind(db);
        let inserts = 0;
        vi.spyOn(db, "prepare").mockImplementation((sql: string) => {
            const statement = prepare(sql);
            if (!sql.includes("INSERT INTO pco_song_credits")) {
                return statement;
            }
            return new Proxy(statement, {
                get(target, key) {
                    if (key === "run") {
                        return (...params: Parameters<StatementSync["run"]>) => {
                            inserts += 1;
                            if (inserts === 3) {
                                throw new Error("database or disk is full");
                            }
                            return target.run(...params);
                        };
                    }
                    const value = Reflect.get(target, key);
                    return typeof value === "function" ? value.bind(target) : value;
                },
            });
        });

        expect(() => rederiveAllCredits()).toThrow("database or disk is full");
        vi.restoreAllMocks();
        expect(["1001", "1002", "1003"].map((id) => findSongCredits(db, id))).toEqual(before);
    });

    test("throws when the database cannot be opened", () => {
        const cause = new Error("Could not open the database at /srv/data/x: denied");
        getDb.mockImplementation(() => {
            throw cause;
        });
        expect(() => rederiveAllCredits()).toThrow(cause);
    });
});

describe("getCreditLabelSets", () => {
    test("groups the labels of the songs' authors with the stored roles, leaving out removed songs", () => {
        seedSongs();
        seedPcoSong(db, {
            id: "1004",
            author: "Text: John Newton; Tune: Anon",
            ignoredAt: "2026-10-04T13:00:00.000Z",
        });
        seedPcoSong(db, { id: "1005", author: "Text: Fanny Crosby" });
        seedPcoSong(db, {
            id: "1006",
            author: "Text: Charles Wesley",
            removedAt: "2026-10-04T13:00:00.000Z",
        });
        seedSetting(db, "creditRoles", ["Text", "Tune"]);

        // An ignored song (1004) counts; one Planning Center no longer has (1006) does not,
        // and neither do authors with no labels (1003) or labels that are not roles (1002).
        expect(getCreditLabelSets()).toEqual({
            sets: [
                { labels: ["Text", "Tune"], songs: 2 },
                { labels: ["Text"], songs: 1 },
            ],
            error: null,
        });
    });

    test("reads them with the default roles when the stored ones do not parse, or none are stored", () => {
        seedPcoSong(db, { id: "1001", author: "Words: Isaac Watts; Music: Lowell Mason" });
        seedPcoSong(db, { id: "1002", author: "Text: Isaac Watts" });
        const expected = { sets: [{ labels: ["Words", "Music"], songs: 1 }], error: null };

        expect(getCreditLabelSets()).toEqual(expected);
        seedSetting(db, "creditRoles", ["Text"]);
        expect(getCreditLabelSets()).toEqual(expected);
    });

    test("gives no sets for an empty mirror", () => {
        expect(getCreditLabelSets()).toEqual({ sets: [], error: null });
    });

    test("asks Planning Center nothing", () => {
        seedSongs();
        const fetchMock = stubFetchRoutes({});
        getCreditLabelSets();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    test("never throws: a database that cannot be opened is logged, and comes back as the error", () => {
        const cause = new Error("Could not open the database at /srv/data/x: denied");
        getDb.mockImplementation(() => {
            throw cause;
        });
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

        expect(getCreditLabelSets()).toEqual({
            sets: [],
            error: "Could not open the database at /srv/data/x: denied",
        });
        expect(consoleError).toHaveBeenCalledWith(
            "Failed to read the labels of the songs' credits:",
            cause
        );
    });
});
