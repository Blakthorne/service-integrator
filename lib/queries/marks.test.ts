import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { findCatalogSong } from "@/lib/db/catalog";
import { openTestDb, seedSong } from "@/lib/db/testing";

// vi.hoisted: vi.mock factories run before the module's own declarations.
const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/lib/db", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/db")>()),
    getDb,
}));

import { getMarkedSongIds, getSongMarks, markCatalogSong, unmarkCatalogSong } from "./marks";

let db: DatabaseSync;

beforeEach(() => {
    db = openTestDb();
    getDb.mockReturnValue(db);
});

afterEach(() => {
    db.close();
    getDb.mockReset();
});

const NOW = new Date("2026-10-04T12:00:00.000Z");

describe("the to-learn shelf, end to end", () => {
    test("marks a song with a note, reads it back, and unmarks it", () => {
        const song = seedSong(db);
        const other = seedSong(db);
        expect(markCatalogSong(song, "to-learn", "For Advent", NOW)).toEqual({ ok: true, changed: true });
        expect(getSongMarks(song)).toEqual([
            { mark: "to-learn", note: "For Advent", createdAt: NOW.toISOString() },
        ]);
        expect(findCatalogSong(db, song)?.marks).toEqual(getSongMarks(song));
        expect(getMarkedSongIds("to-learn")).toEqual([song]);
        expect(getSongMarks(other)).toEqual([]);

        expect(unmarkCatalogSong(song, "to-learn")).toEqual({ ok: true, changed: true });
        expect(getMarkedSongIds("to-learn")).toEqual([]);
    });

    test("refuses a song that is not in the catalog", () => {
        expect(markCatalogSong(999, "to-learn", null)).toMatchObject({ ok: false, reason: "song-not-found" });
        expect(unmarkCatalogSong(999, "to-learn")).toMatchObject({ ok: false, reason: "song-not-found" });
    });

    test("throws when the database cannot be opened", () => {
        getDb.mockImplementation(() => {
            throw new Error("Could not open the database at /srv/data/x: denied");
        });
        expect(() => getMarkedSongIds("to-learn")).toThrow("Could not open the database");
    });
});
