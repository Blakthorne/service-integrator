import { describe, expect, test } from "vitest";
import {
    InvalidPlannedRowsError,
    parsePlannedRows,
    type PlannedCatalogRows,
} from "./rows";

function valid(): PlannedCatalogRows {
    return {
        books: [
            {
                code: "R",
                name: "Rejoice Hymns",
                shortName: "Rejoice",
                numbered: true,
                labelFormat: "R-{n}",
                sortOrder: 1,
            },
        ],
        hymns: [
            {
                key: "rejoice, the lord is king",
                title: "Rejoice, the Lord Is King",
                aliases: [
                    {
                        alias: "Rejoice \u2013 the Lord Is King!",
                        normalized: "rejoice \u2013 the lord is king",
                    },
                ],
            },
        ],
        tunes: [{ key: "DARWALL", name: "DARWALL", aliases: [] }],
        songs: [
            { hymnKey: "rejoice, the lord is king", tuneKey: "DARWALL" },
            { hymnKey: "rejoice, the lord is king", tuneKey: null },
        ],
        entries: [
            {
                bookCode: "R",
                hymnKey: "rejoice, the lord is king",
                tuneKey: "DARWALL",
                number: 43,
                position: null,
                locationLabel: null,
                variantNote: null,
            },
        ],
    };
}

describe("parsePlannedRows", () => {
    test("returns rows of the right shape", () => {
        expect(parsePlannedRows(valid())).toEqual(valid());
    });

    test("drops fields it does not know", () => {
        const rows = { ...valid(), extra: true, books: [{ ...valid().books[0], color: "red" }] };
        expect(parsePlannedRows(rows)).toEqual(valid());
    });

    test.each([
        ["not an object", () => "rows", "rows"],
        ["an array", () => [], "rows"],
        ["missing a list", () => ({ ...valid(), tunes: undefined }), "rows.tunes"],
        [
            "a book whose numbered is not a boolean",
            () => ({ ...valid(), books: [{ ...valid().books[0], numbered: 1 }] }),
            "rows.books[0].numbered",
        ],
        [
            "a sort order that is not a whole number",
            () => ({ ...valid(), books: [{ ...valid().books[0], sortOrder: 1.5 }] }),
            "rows.books[0].sortOrder",
        ],
        [
            "an alias without its normalized form",
            () => ({
                ...valid(),
                hymns: [{ ...valid().hymns[0], aliases: [{ alias: "X" }] }],
            }),
            "rows.hymns[0].aliases[0].normalized",
        ],
        [
            "a song whose tune key is missing rather than null",
            () => ({ ...valid(), songs: [{ hymnKey: "x" }] }),
            "rows.songs[0].tuneKey",
        ],
        [
            "an entry whose number is text",
            () => ({ ...valid(), entries: [{ ...valid().entries[0], number: "43" }] }),
            "rows.entries[0].number",
        ],
    ])("refuses %s, naming where", (_, rows, path) => {
        expect(() => parsePlannedRows(rows())).toThrow(InvalidPlannedRowsError);
        expect(() => parsePlannedRows(rows())).toThrow(
            `The planned rows are not valid at ${path}`
        );
    });

    test.each([
        [
            "a book code planned twice, in any case",
            () => ({ ...valid(), books: [...valid().books, { ...valid().books[0], code: "r" }] }),
            "rows.books[1].code: planned twice",
        ],
        [
            "a hymn key planned twice",
            () => ({ ...valid(), hymns: [...valid().hymns, { ...valid().hymns[0], aliases: [] }] }),
            "rows.hymns[1].key: planned twice",
        ],
        [
            "a tune key planned twice",
            () => ({ ...valid(), tunes: [...valid().tunes, ...valid().tunes] }),
            "rows.tunes[1].key: planned twice",
        ],
        [
            "a song planned twice",
            () => ({ ...valid(), songs: [...valid().songs, valid().songs[1]] }),
            "rows.songs[2].tuneKey: planned twice",
        ],
        [
            "an alias form planned twice",
            () => ({
                ...valid(),
                hymns: [
                    ...valid().hymns,
                    { key: "another", title: "Another", aliases: valid().hymns[0].aliases },
                ],
            }),
            "rows.hymns[1].aliases[0].normalized: planned twice",
        ],
        [
            "a song of a hymn that is not planned",
            () => ({ ...valid(), songs: [{ hymnKey: "missing", tuneKey: null }], entries: [] }),
            "rows.songs[0].hymnKey: no such hymn",
        ],
        [
            "a song to a tune that is not planned",
            () => ({
                ...valid(),
                songs: [{ hymnKey: "rejoice, the lord is king", tuneKey: "MISSING" }],
                entries: [],
            }),
            "rows.songs[0].tuneKey: no such tune",
        ],
        [
            "an entry in a book that is not planned, or not spelt as planned",
            () => ({ ...valid(), entries: [{ ...valid().entries[0], bookCode: "r" }] }),
            "rows.entries[0].bookCode: no such book",
        ],
        [
            "an entry of a song that is not planned",
            () => ({ ...valid(), entries: [{ ...valid().entries[0], tuneKey: "OTHER" }] }),
            "rows.entries[0]: no such song",
        ],
    ])("refuses %s", (_, rows, problem) => {
        expect(() => parsePlannedRows(rows())).toThrow(InvalidPlannedRowsError);
        expect(() => parsePlannedRows(rows())).toThrow(
            `The planned rows are not valid at ${problem}`
        );
    });
});
