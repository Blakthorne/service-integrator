import { describe, expect, test } from "vitest";
import {
    CATALOG_EXPORT_FORMAT,
    CATALOG_EXPORT_VERSION,
    buildCatalogExport,
    catalogExportFileName,
    type CatalogExportData,
} from "./exportJson";

/** A small catalog, its rows given out of order. */
function data(): CatalogExportData {
    return {
        books: [
            { id: 2, code: "G", name: "Great Hymns of the Faith", shortName: "Great Hymns", numbered: true, labelFormat: "G-{n}", sortOrder: 2, active: true },
            { id: 1, code: "R", name: "Rejoice Hymns", shortName: "Rejoice", numbered: true, labelFormat: "R-{n}", sortOrder: 1, active: false },
        ],
        hymns: [
            {
                id: 7,
                title: "Amazing Grace",
                firstLine: null,
                notes: null,
                aliases: [
                    { alias: "Grace", normalized: "grace" },
                    { alias: "Amazing Grace! How Sweet the Sound", normalized: "amazing grace! how sweet the sound" },
                ],
            },
        ],
        tunes: [{ id: 3, name: "NEW BRITAIN", meter: "CM", notes: null, aliases: [] }],
        songs: [
            { id: 11, hymnId: 7, tuneId: null, pcoSongId: null, linkedAt: null, linkedBy: null, notes: null },
            { id: 10, hymnId: 7, tuneId: 3, pcoSongId: "1001", linkedAt: "2026-10-01T09:00:00.000Z", linkedBy: "auto", notes: "Verse 4 optional" },
        ],
        entries: [
            { id: 21, bookId: 2, songId: 10, number: 247, position: null, locationLabel: null, variantNote: null },
            { id: 20, bookId: 1, songId: 10, number: 108, position: null, locationLabel: null, variantNote: null },
        ],
        marks: [
            { songId: 11, mark: "to-learn", note: null, createdAt: "2026-10-04T12:00:00.000Z" },
            { songId: 10, mark: "to-learn", note: "For Advent", createdAt: "2026-10-03T12:00:00.000Z" },
            { songId: 10, mark: "newer-mark", note: null, createdAt: "2026-10-03T12:00:00.000Z" },
        ],
    };
}

describe("buildCatalogExport", () => {
    test("sorts keys and rows, keeps ids, pretty-prints, and ends with a line break", () => {
        const text = buildCatalogExport(data());
        expect(text.endsWith("}\n")).toBe(true);
        expect(text.startsWith('{\n  "books": [\n    {\n      "active": false,\n      "code": "R",')).toBe(true);
        const document = JSON.parse(text);
        expect(Object.keys(document)).toEqual(["books", "entries", "format", "hymns", "marks", "songs", "tunes", "version"]);
        expect(document.format).toBe(CATALOG_EXPORT_FORMAT);
        expect(document.version).toBe(CATALOG_EXPORT_VERSION);
        expect(document.books.map(({ id }: { id: number }) => id)).toEqual([1, 2]);
        expect(Object.keys(document.books[0])).toEqual(["active", "code", "id", "labelFormat", "name", "numbered", "shortName", "sortOrder"]);
        expect(document.songs.map(({ id }: { id: number }) => id)).toEqual([10, 11]);
        expect(document.songs[0]).toEqual({
            hymnId: 7,
            id: 10,
            linkedAt: "2026-10-01T09:00:00.000Z",
            linkedBy: "auto",
            notes: "Verse 4 optional",
            pcoSongId: "1001",
            tuneId: 3,
        });
        expect(document.entries.map(({ id }: { id: number }) => id)).toEqual([20, 21]);
        expect(document.hymns[0].aliases).toEqual([
            { alias: "Amazing Grace! How Sweet the Sound", normalized: "amazing grace! how sweet the sound" },
            { alias: "Grace", normalized: "grace" },
        ]);
        expect(document.marks.map(({ songId, mark }: { songId: number; mark: string }) => [songId, mark])).toEqual([
            [10, "newer-mark"],
            [10, "to-learn"],
            [11, "to-learn"],
        ]);
    });

    test("gives the same text for the same catalog, whatever order its rows come in", () => {
        const shuffled = data();
        shuffled.books.reverse();
        shuffled.songs.reverse();
        shuffled.entries.reverse();
        shuffled.marks.reverse();
        shuffled.hymns[0].aliases.reverse();
        expect(buildCatalogExport(shuffled)).toBe(buildCatalogExport(data()));
    });

    test("changes only an edited row's own line", () => {
        const before = buildCatalogExport(data()).split("\n");
        const edited = data();
        edited.tunes[0].meter = "C.M.";
        const after = buildCatalogExport(edited).split("\n");
        expect(after).toHaveLength(before.length);
        expect(after.filter((line, index) => line !== before[index])).toEqual(['      "meter": "C.M.",']);
    });

    test("holds an empty catalog", () => {
        expect(JSON.parse(buildCatalogExport({ books: [], hymns: [], tunes: [], songs: [], entries: [], marks: [] }))).toEqual({
            books: [],
            entries: [],
            format: CATALOG_EXPORT_FORMAT,
            hymns: [],
            marks: [],
            songs: [],
            tunes: [],
            version: 1,
        });
    });
});

describe("catalogExportFileName", () => {
    test("names the file by the date on the viewer's calendar", () => {
        expect(catalogExportFileName(new Date(2026, 9, 4, 23, 30))).toBe("catalog-2026-10-04.json");
        expect(catalogExportFileName(new Date(2027, 0, 9, 0, 5))).toBe("catalog-2027-01-09.json");
    });
});
