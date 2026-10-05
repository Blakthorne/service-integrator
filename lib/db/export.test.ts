import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { buildCatalogExport } from "@/lib/catalog/exportJson";
import { readCatalogExport } from "./export";
import { openTestDb, seedBook, seedEntry, seedHymn, seedPcoSong, seedSong, seedSongMark, seedTune } from "./testing";

let db: DatabaseSync;

beforeEach(() => {
    db = openTestDb();
});

afterEach(() => {
    db.close();
});

/** Rejoice, a numbered book not in use, and a chorus book; Amazing Grace, linked, in two of them; a chorus marked to learn. */
function seed() {
    const rejoice = seedBook(db, { code: "R", name: "Rejoice Hymns", shortName: "Rejoice" });
    const old = seedBook(db, { code: "OLD", name: "Old Book", active: false });
    const chorus = seedBook(db, { code: "CB", name: "Chorus Book", numbered: false });
    seedPcoSong(db, { id: "1001", title: "Amazing Grace" });
    const amazingGrace = seedSong(db, {
        hymnId: seedHymn(db, { title: "Amazing Grace", firstLine: "Amazing grace! how sweet the sound", aliases: ["Grace"] }),
        tuneId: seedTune(db, { name: "NEW BRITAIN", meter: "CM", aliases: ["AMAZING GRACE"] }),
        pcoSongId: "1001",
        linkedAt: "2026-10-01T09:00:00.000Z",
        linkedBy: "manual",
    });
    const chorusSong = seedSong(db, { hymnId: seedHymn(db, { title: "Deep and Wide" }) });
    seedEntry(db, { bookId: rejoice, songId: amazingGrace, number: 108 });
    seedEntry(db, { bookId: old, songId: amazingGrace, locationLabel: "front cover" });
    seedEntry(db, { bookId: chorus, songId: chorusSong, position: 1, variantNote: "A Round" });
    seedSongMark(db, chorusSong, { note: "For VBS" });
    return { rejoice, amazingGrace, chorusSong };
}

describe("readCatalogExport", () => {
    test("reads every row as it is stored", () => {
        const { rejoice, amazingGrace, chorusSong } = seed();
        const data = readCatalogExport(db);
        expect(data.books.map(({ code, active, numbered }) => [code, active, numbered])).toEqual([
            ["R", true, true],
            ["OLD", false, true],
            ["CB", true, false],
        ]);
        expect(data.hymns[0]).toEqual({
            id: expect.any(Number),
            title: "Amazing Grace",
            firstLine: "Amazing grace! how sweet the sound",
            notes: null,
            aliases: [{ alias: "Grace", normalized: "grace" }],
        });
        expect(data.tunes[0]).toMatchObject({ name: "NEW BRITAIN", meter: "CM", aliases: [{ alias: "AMAZING GRACE", normalized: "AMAZING GRACE" }] });
        expect(data.songs.find(({ id }) => id === amazingGrace)).toMatchObject({
            pcoSongId: "1001",
            linkedAt: "2026-10-01T09:00:00.000Z",
            linkedBy: "manual",
        });
        expect(data.entries).toEqual([
            { id: expect.any(Number), bookId: rejoice, songId: amazingGrace, number: 108, position: null, locationLabel: null, variantNote: null },
            expect.objectContaining({ number: null, locationLabel: "front cover" }),
            expect.objectContaining({ songId: chorusSong, position: 1, variantNote: "A Round" }),
        ]);
        expect(data.marks).toEqual([{ songId: chorusSong, mark: "to-learn", note: "For VBS", createdAt: "2026-10-04T12:00:00.000Z" }]);
    });

    test("gives the same document twice, and one whose edit changes only its lines", () => {
        const { amazingGrace } = seed();
        const first = buildCatalogExport(readCatalogExport(db));
        expect(buildCatalogExport(readCatalogExport(db))).toBe(first);

        db.prepare("UPDATE songs SET notes = 'Verse 4 optional' WHERE id = ?").run(amazingGrace);
        const second = buildCatalogExport(readCatalogExport(db)).split("\n");
        const before = first.split("\n");
        expect(second).toHaveLength(before.length);
        expect(second.filter((line, index) => line !== before[index])).toEqual(['      "notes": "Verse 4 optional",']);
    });
});
