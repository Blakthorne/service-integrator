import { describe, expect, test } from "vitest";
import { UTF8_BOM, parseCsv, type CsvRecord } from "@/lib/csv";
import {
    InvalidStoredBookCsvRowsError,
    bookCsvColumns,
    parseStoredBookCsvRows,
    planBookCsvImport,
    planBookCsvText,
    type BookCsvBook,
    type BookCsvCatalog,
} from "./bookCsv";

const REJOICE: BookCsvBook = { id: 1, code: "R", name: "Rejoice Hymns", numbered: true, labelFormat: "R-{n}" };
const CHORUS: BookCsvBook = { id: 2, code: "CB", name: "Chorus Book", numbered: false, labelFormat: "Chorus Book" };

/**
 * Amazing Grace (also "Amazing Grace! How Sweet the Sound") to NEW
 * BRITAIN, at R-108; two hymns titled "Thank You, Lord", the first to
 * LYNCH at R-561 and the second with no tune; DARWALL (also DARWAL); and
 * two tunes named OLD HUNDREDTH, the Doxology sung to the second.
 */
function catalog(entries: BookCsvCatalog["entries"] = []): BookCsvCatalog {
    return {
        hymns: [
            { id: 1, title: "Amazing Grace", aliases: ["Amazing Grace! How Sweet the Sound"] },
            { id: 2, title: "Thank You, Lord", aliases: [] },
            { id: 3, title: "Thank You, Lord", aliases: [] },
            { id: 4, title: "Doxology", aliases: [] },
        ],
        tunes: [
            { id: 10, name: "NEW BRITAIN", aliases: [] },
            { id: 11, name: "LYNCH", aliases: [] },
            { id: 12, name: "DARWALL", aliases: ["DARWAL"] },
            { id: 13, name: "OLD HUNDREDTH", aliases: [] },
            { id: 14, name: "OLD HUNDREDTH", aliases: [] },
        ],
        songs: [
            { id: 100, hymnId: 1, tuneId: 10 },
            { id: 101, hymnId: 2, tuneId: 11 },
            { id: 102, hymnId: 3, tuneId: null },
            { id: 103, hymnId: 4, tuneId: 14 },
        ],
        entries,
    };
}

/** Rejoice's entries: Amazing Grace at R-108 and Thank You, Lord (LYNCH) at R-561. */
const REJOICE_ENTRIES: BookCsvCatalog["entries"] = [
    { songId: 100, number: 108, position: null, variantNote: null },
    { songId: 101, number: 561, position: null, variantNote: null },
];

/** CSV text as records, through the parser. */
function records(...lines: string[]): CsvRecord[] {
    const parsed = parseCsv(lines.join("\n"));
    if (!parsed.ok) {
        throw new Error(parsed.message);
    }
    return parsed.records;
}

function plan(book: BookCsvBook, lines: string[], entries: BookCsvCatalog["entries"] = REJOICE_ENTRIES) {
    return planBookCsvImport(book, records(...lines), catalog(entries));
}

const reasons = (issues: { reason: string }[]) => issues.map(({ reason }) => reason);

describe("bookCsvColumns", () => {
    test("names a numbered book's columns, and a book without numbers'", () => {
        expect(bookCsvColumns(true)).toEqual(["number", "title", "tune", "variant"]);
        expect(bookCsvColumns(false)).toEqual(["position", "title", "tune", "variant"]);
    });
});

describe("planBookCsvImport: matching", () => {
    test("matches hymns by title or other title and tunes by name or other name, planning what is new", () => {
        const { report, rows } = plan(REJOICE, [
            "number,title,tune,variant",
            "109,amazing grace,New Britain,Descant",
            "200,Amazing Grace! How Sweet the Sound,AZMON,",
            "201,Be Thou My Vision,SLANE,",
            "202,Rejoice the Lord Is King,darwal,",
            "203,Be Thou My Vision,,",
        ]);
        expect(report.problems).toEqual([]);
        expect(report.rows.map(({ line, label, hymn, tuneMatch, song, outcome }) => [line, label, hymn, tuneMatch, song, outcome])).toEqual([
            [2, "R-109", { kind: "existing", id: 1, name: "Amazing Grace", by: "name" }, { kind: "existing", id: 10, name: "NEW BRITAIN", by: "name" }, "existing", "add"],
            [3, "R-200", { kind: "existing", id: 1, name: "Amazing Grace", by: "alias" }, { kind: "new" }, "new", "add"],
            [4, "R-201", { kind: "new" }, { kind: "new" }, "new", "add"],
            [5, "R-202", { kind: "new" }, { kind: "existing", id: 12, name: "DARWALL", by: "alias" }, "new", "add"],
            [6, "R-203", { kind: "new" }, { kind: "none" }, "new", "add"],
        ]);
        expect(rows).toEqual({
            bookId: 1,
            hymns: [
                { key: "be thou my vision", title: "Be Thou My Vision" },
                { key: "rejoice the lord is king", title: "Rejoice the Lord Is King" },
            ],
            tunes: [
                { key: "AZMON", name: "AZMON" },
                { key: "SLANE", name: "SLANE" },
            ],
            songs: [
                { hymn: { id: 1 }, tune: { key: "AZMON" } },
                { hymn: { key: "be thou my vision" }, tune: { key: "SLANE" } },
                { hymn: { key: "rejoice the lord is king" }, tune: { id: 12 } },
                { hymn: { key: "be thou my vision" }, tune: null },
            ],
            entries: [
                { line: 2, hymn: { id: 1 }, tune: { id: 10 }, number: 109, position: null, variantNote: "Descant" },
                { line: 3, hymn: { id: 1 }, tune: { key: "AZMON" }, number: 200, position: null, variantNote: null },
                { line: 4, hymn: { key: "be thou my vision" }, tune: { key: "SLANE" }, number: 201, position: null, variantNote: null },
                { line: 5, hymn: { key: "rejoice the lord is king" }, tune: { id: 12 }, number: 202, position: null, variantNote: null },
                { line: 6, hymn: { key: "be thou my vision" }, tune: null, number: 203, position: null, variantNote: null },
            ],
        });
        expect(report.planned).toEqual({
            books: 0,
            hymns: 2,
            hymnAliases: 0,
            tunes: 2,
            tuneAliases: 0,
            songs: 4,
            songsWithoutTune: 1,
            entries: 5,
        });
    });

    test("takes the columns in any order and case, without tune or variant, and cleans what it reads", () => {
        const { report, rows } = plan(REJOICE, [" Title ,NUMBER", "  Be  Thou My Vision , 0400 "]);
        expect(report.problems).toEqual([]);
        expect(report.input).toEqual({ rows: 1, blankRows: 0, columns: ["Title", "NUMBER"] });
        expect(report.rows[0]).toMatchObject({ number: 400, title: "Be Thou My Vision", tune: null, variantNote: null });
        expect(rows.entries).toEqual([
            { line: 2, hymn: { key: "be thou my vision" }, tune: null, number: 400, position: null, variantNote: null },
        ]);
    });

    test("goes with the hymn of a shared title that is sung to the row's tune, or has no tune, and says so", () => {
        const { report } = plan(REJOICE, [
            "number,title,tune",
            "300,\"Thank You, Lord\",LYNCH",
            "301,\"Thank You, Lord\",",
        ]);
        expect(report.rows.map(({ hymn }) => hymn.kind === "existing" && hymn.id)).toEqual([2, 3]);
        expect(reasons(report.warnings)).toEqual(["ambiguous-hymn", "ambiguous-hymn"]);
        expect(report.warnings[0]).toEqual({
            reason: "ambiguous-hymn",
            line: 2,
            lines: [2],
            message:
                'Line 2: 2 hymns are titled "Thank You, Lord"; the row goes with the one sung to its tune. Merge them, or retitle one, if they are one hymn.',
        });
        // Thank You, Lord (LYNCH) is R-561 already, so a second plain entry would be its twin.
        expect(reasons(report.problems)).toEqual(["song-twice"]);
    });

    test("goes with the tune of a shared name that the row's hymn is sung to, and says so", () => {
        const { report, rows } = plan(REJOICE, ["number,title,tune", "14,Doxology,Old Hundredth"]);
        expect(report.rows[0].tuneMatch).toEqual({ kind: "existing", id: 14, name: "OLD HUNDREDTH", by: "name" });
        expect(report.rows[0].song).toBe("existing");
        expect(report.warnings).toEqual([
            expect.objectContaining({
                reason: "ambiguous-tune",
                message:
                    "Line 2: 2 tunes are named Old Hundredth; the row goes with the one its hymn is sung to. Merge them if they are one tune.",
            }),
        ]);
        expect(rows.songs).toEqual([]);
    });

    test("gives rows of one new title one new hymn, spelled as the first row spells it", () => {
        const { rows } = plan(REJOICE, [
            "number,title,tune",
            "400,Shout to the Lord,",
            "401,shout to the lord!,",
            "402,Shout to the Lord,SHOUT",
        ]);
        expect(rows.hymns).toEqual([{ key: "shout to the lord", title: "Shout to the Lord" }]);
        expect(rows.songs).toEqual([
            { hymn: { key: "shout to the lord" }, tune: null },
            { hymn: { key: "shout to the lord" }, tune: { key: "SHOUT" } },
        ]);
    });

    test("plans the same twice", () => {
        const lines = ["number,title,tune", "400,Shout to the Lord,", "109,Amazing Grace,NEW BRITAIN"];
        expect(plan(REJOICE, lines)).toEqual(plan(REJOICE, lines));
    });
});

describe("planBookCsvImport: what blocks the import", () => {
    test("an empty file, or one with only a header", () => {
        expect(plan(REJOICE, []).report.problems).toEqual([
            {
                reason: "empty",
                line: null,
                lines: [],
                message: "The file is empty. It needs a header row, then a row for each song.",
            },
        ]);
        const headerOnly = plan(REJOICE, ["number,title", "", " , "]);
        expect(headerOnly.report.problems).toEqual([
            expect.objectContaining({ reason: "empty", message: "The file has no rows below its header." }),
        ]);
        expect(headerOnly.report.input).toEqual({ rows: 2, blankRows: 2, columns: ["number", "title"] });
    });

    test("a header that does not fit the book", () => {
        expect(plan(REJOICE, ["position,title,tune", "1,A,B"]).report.problems).toEqual([
            {
                reason: "header",
                line: 1,
                lines: [1],
                message:
                    "The header does not fit Rejoice Hymns, which numbers its songs: it has no number column and position is not a column it takes. Its first row must name the columns number, title, tune, variant, in any order (tune and variant may be left out).",
            },
        ]);
        expect(plan(CHORUS, ["number,title", "1,A"]).report.problems[0].message).toContain(
            "Chorus Book, which has no numbers: it has no position column and number is not a column it takes"
        );
        expect(plan(REJOICE, ["number,title,title,hymnal", "1,A,A,X"]).report.problems[0].message).toContain(
            "hymnal is not a column it takes and it names title twice"
        );
        expect(plan(REJOICE, ["number,tune", "1,A"]).report.problems[0].message).toContain("it has no title column");
        expect(plan(REJOICE, ["number,title,tune", "1,A,B"]).rows.entries).toHaveLength(1);
    });

    test("a row with no title, a number that does not read, a field too long, or extra fields", () => {
        const { report, rows } = plan(REJOICE, [
            "number,title,tune,variant",
            "400,,,",
            ",Shout to the Lord,,",
            "0,A,,",
            "100000,B,,",
            "4x,C,,",
            `401,${"x".repeat(201)},,`,
            `402,D,${"T".repeat(101)},${"v".repeat(101)}`,
            "403,E,F,G,extra",
            "404,F,G,H,,",
        ]);
        expect(report.problems.map(({ reason, line, message }) => [reason, line, message])).toEqual([
            ["blank-title", 2, "Line 2 has no title."],
            ["bad-number", 3, "Line 3 has no number."],
            ["bad-number", 4, 'Line 4: "0" is not a number, a whole number from 1 to 99,999.'],
            ["bad-number", 5, 'Line 5: "100000" is not a number, a whole number from 1 to 99,999.'],
            ["bad-number", 6, 'Line 6: "4x" is not a number, a whole number from 1 to 99,999.'],
            ["too-long", 7, "Line 7: the title has more than 200 characters."],
            ["too-long", 8, "Line 8: the tune's name has more than 100 characters."],
            ["too-long", 8, "Line 8: the variant note has more than 100 characters."],
            [
                "extra-fields",
                9,
                "Line 9 has 5 fields, but the header names 4. Put a field with a comma in it in double quotes.",
            ],
        ]);
        expect(report.rows.map(({ line, outcome }) => [line, outcome]).filter(([, outcome]) => outcome !== "blocked")).toEqual([
            [10, "add"],
        ]);
        expect(rows.entries.map(({ line }) => line)).toEqual([10]);
    });

    test("a number on several rows, which blocks each of them", () => {
        const { report, rows } = plan(REJOICE, ["number,title", "400,A", "401,B", "400,C", "400,D"]);
        expect(report.problems).toEqual([
            {
                reason: "number-duplicated",
                line: 2,
                lines: [2, 4, 5],
                message: "R-400 is on lines 2, 4 and 5. A number is in a book once.",
            },
        ]);
        expect(report.rows.map(({ outcome }) => outcome)).toEqual(["blocked", "add", "blocked", "blocked"]);
        expect(rows.entries.map(({ line }) => line)).toEqual([3]);
    });

    test("a number the book has for another song, or another variant of the song", () => {
        expect(plan(REJOICE, ["number,title,tune", "108,Be Thou My Vision,SLANE"]).report.problems).toEqual([
            {
                reason: "number-taken",
                line: 2,
                lines: [2],
                message: 'Line 2: R-108 is taken by "Amazing Grace (NEW BRITAIN)".',
            },
        ]);
        expect(
            plan(REJOICE, ["number,title,tune,variant", "108,Amazing Grace,NEW BRITAIN,Descant"]).report.problems
        ).toEqual([expect.objectContaining({ reason: "number-taken", line: 2 })]);
    });

    test("one song in the book twice with the same variant note, from the book or from two rows", () => {
        const { report } = plan(REJOICE, [
            "number,title,tune,variant",
            "500,Amazing Grace,NEW BRITAIN,",
            "501,Be Thou My Vision,SLANE,",
            "502,be thou my vision,slane,",
            "503,Be Thou My Vision,SLANE,Descant",
        ]);
        expect(report.problems).toEqual([
            {
                reason: "song-twice",
                line: 2,
                lines: [2],
                message:
                    'Line 2: "Amazing Grace (NEW BRITAIN)" is already in Rejoice Hymns as R-108, with no variant note. Give the row a variant note, or leave it out.',
            },
            {
                reason: "song-twice",
                line: 4,
                lines: [3, 4],
                message:
                    'Lines 3 and 4 put "Be Thou My Vision (SLANE)" in Rejoice Hymns 2 times, with no variant note. Give each a variant note of its own, or keep one.',
            },
        ]);
        expect(report.rows.map(({ outcome }) => outcome)).toEqual(["blocked", "add", "blocked", "add"]);
    });
});

describe("planBookCsvImport: rows the book has already", () => {
    test("leaves out a row whose entry the book has, at its number", () => {
        const { report, rows } = plan(REJOICE, ["number,title,tune", "108,Amazing Grace,NEW BRITAIN", "109,Amazing Grace,NEW BRITAIN"]);
        expect(report.warnings).toEqual([
            {
                reason: "already-in-book",
                line: 2,
                lines: [2],
                message: 'Line 2: "Amazing Grace (NEW BRITAIN)" is in Rejoice Hymns already as R-108, so the row is left out.',
            },
        ]);
        // The row left out is not the song's plain entry, so the second row is one more of it.
        expect(reasons(report.problems)).toEqual(["song-twice"]);
        expect(report.rows.map(({ outcome }) => outcome)).toEqual(["skip", "blocked"]);
        expect(rows.entries).toEqual([]);
    });
});

describe("planBookCsvImport: a book without numbers", () => {
    test("puts the rows in the order of their positions, after the book's entries", () => {
        const { report, rows } = plan(
            CHORUS,
            ["position,title", "3,Deep and Wide", "1,Jesus Loves Me", "2,Alleluia"],
            [{ songId: 100, number: null, position: 1, variantNote: null }]
        );
        expect(report.problems).toEqual([]);
        expect(rows.entries.map(({ line, number, position }) => [line, number, position])).toEqual([
            [2, null, 4],
            [3, null, 2],
            [4, null, 3],
        ]);
        expect(report.rows.map(({ position, label }) => [position, label])).toEqual([
            [3, "Chorus Book"],
            [1, "Chorus Book"],
            [2, "Chorus Book"],
        ]);
        expect(report.warnings).toEqual([
            {
                reason: "positions",
                line: null,
                lines: [],
                message:
                    "Chorus Book has 1 entry already, so the rows go after them, in the order of their positions: at 2 to 4.",
            },
        ]);
    });

    test("closes gaps in the positions, saying so, and blocks a position on two rows", () => {
        expect(plan(CHORUS, ["position,title", "5,A", "9,B"], []).report.warnings).toEqual([
            expect.objectContaining({ reason: "positions", message: "The rows go in the order of their positions, at 1 to 2." }),
        ]);
        expect(plan(CHORUS, ["position,title", "1,A", "2,B"], []).report.warnings).toEqual([]);
        expect(plan(CHORUS, ["position,title", "1,A", "1,B"], []).report.problems).toEqual([
            {
                reason: "position-duplicated",
                line: 2,
                lines: [2, 3],
                message: "Position 1 is on lines 2 and 3, so their order is not clear.",
            },
        ]);
        expect(plan(CHORUS, ["position,title", ",A"], []).report.problems).toEqual([
            expect.objectContaining({ reason: "bad-position", message: "Line 2 has no position." }),
        ]);
    });

    test("leaves out a song the book has already with the same variant note", () => {
        const { report, rows } = plan(
            CHORUS,
            ["position,title,tune", "1,Amazing Grace,NEW BRITAIN", "2,Shout to the Lord,"],
            [{ songId: 100, number: null, position: 1, variantNote: null }]
        );
        expect(reasons(report.warnings)).toEqual(["already-in-book", "positions"]);
        expect(report.warnings[0].message).toBe(
            'Line 2: "Amazing Grace (NEW BRITAIN)" is in Chorus Book already, so the row is left out.'
        );
        expect(rows.entries.map(({ line, position }) => [line, position])).toEqual([[3, 2]]);
    });
});

describe("planBookCsvText", () => {
    test("reads CSV text with a byte order mark and CRLF line breaks", () => {
        const plan = planBookCsvText(
            REJOICE,
            `${UTF8_BOM}number,title\r\n400,"Shout, to the Lord"\r\n`,
            catalog(REJOICE_ENTRIES)
        );
        expect(plan.report.problems).toEqual([]);
        expect(plan.rows.hymns).toEqual([{ key: "shout, to the lord", title: "Shout, to the Lord" }]);
        expect(plan.stored).toEqual({
            records: [
                { line: 1, fields: ["number", "title"] },
                { line: 2, fields: ["400", "Shout, to the Lord"] },
            ],
            planned: plan.rows,
        });
    });

    test("reports text that is not CSV as the one problem, planning nothing", () => {
        const plan = planBookCsvText(REJOICE, 'number,title\n400,"open', catalog());
        expect(plan.report.problems).toEqual([
            {
                reason: "malformed",
                line: 2,
                lines: [2],
                message: "Line 2: a field that starts with a double quote is never closed.",
            },
        ]);
        expect(plan.rows.entries).toEqual([]);
        expect(plan.stored.records).toEqual([]);
    });
});

describe("parseStoredBookCsvRows", () => {
    test("gives back the records and the plan it was stored with", () => {
        const plan = planBookCsvText(REJOICE, "number,title\n400,A\n", catalog());
        expect(parseStoredBookCsvRows(JSON.parse(JSON.stringify(plan.stored)))).toEqual(plan.stored);
    });

    test("refuses records that are damaged", () => {
        for (const value of [null, [], { records: "x" }, { records: [{ line: "1", fields: [] }] }, { records: [{ line: 1, fields: [2] }] }]) {
            expect(() => parseStoredBookCsvRows(value)).toThrow(InvalidStoredBookCsvRowsError);
        }
    });
});
