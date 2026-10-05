import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
    openTestDb,
    seedBook,
    seedEntry,
    seedHymn,
    seedSong,
    seedTune,
} from "@/lib/db/testing";

// vi.hoisted: vi.mock factories run before the module's own declarations.
const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/lib/db", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/db")>()),
    getDb,
}));

import {
    getCatalogBook,
    getCatalogBookLabel,
    getCatalogBooks,
    getCatalogCounts,
    getCatalogSong,
    getCatalogSongLabel,
    getCatalogSongs,
    getCatalogTune,
    getCatalogTuneLabel,
    getCatalogTunes,
} from "./catalog";

let db: DatabaseSync;

beforeEach(() => {
    db = openTestDb();
    getDb.mockReturnValue(db);
    vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
    db.close();
    getDb.mockReset();
    vi.restoreAllMocks();
});

/** Amazing Grace to NEW BRITAIN at R-108 and G-247, and the Doxology on G's front cover. */
function seed() {
    const rejoice = seedBook(db, { code: "R", name: "Rejoice Hymns" });
    const great = seedBook(db, { code: "G", name: "Great Hymns of the Faith" });
    const newBritain = seedTune(db, { name: "NEW BRITAIN" });
    const amazingGrace = seedSong(db, {
        hymnId: seedHymn(db, { title: "Amazing Grace" }),
        tuneId: newBritain,
    });
    const doxology = seedSong(db, { hymnId: seedHymn(db, { title: "Doxology" }) });
    seedEntry(db, { bookId: rejoice, songId: amazingGrace, number: 108 });
    seedEntry(db, { bookId: great, songId: amazingGrace, number: 247 });
    seedEntry(db, { bookId: great, songId: doxology, locationLabel: "front cover" });
    return { newBritain, amazingGrace, doxology };
}

/** Make every read of the database fail, as a broken file would. */
function breakDatabase() {
    getDb.mockImplementation(() => {
        throw new Error("Could not open the database at /srv/data/x: denied");
    });
}

describe("the catalog reads", () => {
    test("are empty before the seed import", () => {
        expect(getCatalogSongs()).toEqual([]);
        expect(getCatalogTunes()).toEqual([]);
        expect(getCatalogBooks()).toEqual([]);
        expect(getCatalogCounts()).toEqual({
            books: 0,
            hymns: 0,
            tunes: 0,
            songs: 0,
            entries: 0,
        });
    });

    test("read the songs, tunes, books and counts from the database", () => {
        const { newBritain, amazingGrace, doxology } = seed();
        expect(
            getCatalogSongs().map(({ title, entries }) => [
                title,
                entries.map(({ label }) => label),
            ])
        ).toEqual([
            ["Amazing Grace", ["R-108", "G-247"]],
            ["Doxology", ["G-Front Cover"]],
        ]);
        expect(getCatalogSong(amazingGrace)?.tune?.name).toBe("NEW BRITAIN");
        expect(getCatalogSong(doxology)?.tune).toBeNull();
        expect(getCatalogTunes()).toEqual([
            expect.objectContaining({ name: "NEW BRITAIN", songCount: 1 }),
        ]);
        expect(getCatalogTune(newBritain)?.songs.map(({ id }) => id)).toEqual([
            amazingGrace,
        ]);
        expect(
            getCatalogBooks().map(({ code, entryCount }) => [code, entryCount])
        ).toEqual([
            ["R", 1],
            ["G", 2],
        ]);
        expect(getCatalogBook("g")?.entries.map(({ label }) => label)).toEqual([
            "G-Front Cover",
            "G-247",
        ]);
        expect(getCatalogCounts()).toEqual({
            books: 2,
            hymns: 2,
            tunes: 1,
            songs: 2,
            entries: 3,
        });
    });

    test("give null for a song, tune or book that does not exist", () => {
        seed();
        expect(getCatalogSong(9999)).toBeNull();
        expect(getCatalogTune(9999)).toBeNull();
        expect(getCatalogBook("Q")).toBeNull();
    });

    test("throw when the database cannot be opened, for the error boundary", () => {
        breakDatabase();
        expect(() => getCatalogSongs()).toThrow("Could not open the database");
    });
});

describe("the page-title labels", () => {
    test("name the song, tune or book", () => {
        const { newBritain, amazingGrace, doxology } = seed();
        expect(getCatalogSongLabel(String(amazingGrace))).toBe(
            "Amazing Grace (NEW BRITAIN)"
        );
        expect(getCatalogSongLabel(String(doxology))).toBe("Doxology");
        expect(getCatalogTuneLabel(String(newBritain))).toBe("NEW BRITAIN");
        expect(getCatalogBookLabel("g")).toBe("Great Hymns of the Faith");
    });

    test("fall back when there is no such row", () => {
        seed();
        expect(getCatalogSongLabel("9999")).toBe("Song");
        expect(getCatalogTuneLabel("9999")).toBe("Tune");
        expect(getCatalogBookLabel("Q")).toBe("Book");
        expect(console.error).not.toHaveBeenCalled();
    });

    test("fall back for an invalid key without opening the database", () => {
        expect(getCatalogSongLabel("0")).toBe("Song");
        expect(getCatalogSongLabel("1e3")).toBe("Song");
        expect(getCatalogTuneLabel("../1")).toBe("Tune");
        expect(getCatalogBookLabel("not a code")).toBe("Book");
        expect(getDb).not.toHaveBeenCalled();
    });

    test("fall back and log when the database fails, never throwing", () => {
        breakDatabase();
        expect(getCatalogSongLabel("1")).toBe("Song");
        expect(getCatalogTuneLabel("1")).toBe("Tune");
        expect(getCatalogBookLabel("R")).toBe("Book");
        expect(console.error).toHaveBeenCalledTimes(3);
        expect(console.error).toHaveBeenCalledWith(
            "Failed to load the label for song 1:",
            expect.any(Error)
        );
    });
});
