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
});
