import { describe, expect, test } from "vitest";
import type { CatalogSongSummary, LabelledEntry } from "@/lib/domain";
import {
    CATALOG_PAGE_SIZE,
    filterCatalogSongs,
    foldForSearch,
    pageCatalogSongs,
    parseCatalogSongsQuery,
    selectCatalogSongs,
    sortCatalogSongs,
    type CatalogSongsQuery,
} from "./filter";

const BOOK_CODES = ["R", "G", "CB"];

/** An entry as `[book, number]`, `[book, null, location]` or `[book, null, null, position]`. */
type EntrySpec = [string, number | null, (string | null)?, number?];

function labelOf([book, number, location]: EntrySpec): string {
    if (book === "CB") {
        return "Chorus Book";
    }
    if (number !== null) {
        return `${book}-${number}`;
    }
    return location ? `${book}-Front Cover` : `${book}-?`;
}

let nextId = 1;

function row(
    title: string,
    tuneName: string | null,
    entries: EntrySpec[],
    extra: Partial<CatalogSongSummary> = {}
): CatalogSongSummary {
    const id = nextId++;
    return {
        id,
        hymnId: id,
        title,
        aliases: [],
        tuneId: tuneName === null ? null : id,
        tuneName,
        tuneAliases: [],
        pcoSongId: null,
        entries: entries.map(
            (spec, index): LabelledEntry => ({
                id: id * 100 + index,
                bookId: BOOK_CODES.indexOf(spec[0]) + 1,
                songId: id,
                number: spec[1],
                position: spec[3] ?? null,
                locationLabel: spec[2] ?? null,
                variantNote: null,
                bookCode: spec[0],
                label: labelOf(spec),
            })
        ),
        ...extra,
    };
}

const amazingGrace = row("Amazing Grace", "NEW BRITAIN", [
    ["R", 108],
    ["G", 247],
    ["CB", null, null, 2],
]);
const chargeToKeep = row("A Charge to Keep I Have", "BOYLSTON", [
    ["R", 396],
    ["G", 317],
]);
const otherAt396 = row("O Worship the King", "LYONS", [["G", 396]]);
const doxology = row("Doxology", "OLD HUNDREDTH", [
    ["R", 14],
    ["G", null, "front cover"],
]);
const rejoice = row(
    "Rejoice, the Lord Is King",
    "DARWALL",
    [
        ["R", 43],
        ["G", 143],
    ],
    {
        aliases: ["Rejoice – the Lord Is King!"],
        tuneAliases: ["DARWAL"],
    }
);
const tisSoSweet = row("‘Tis So Sweet to Trust in Jesus", "TRUST IN JESUS", [
    ["R", 389],
]);
const howGreatOurJoy = row("How Great Our Joy", "JÜNGST", [["R", 198]]);
const thankYouLynch = row("Thank You, Lord", "LYNCH", [["R", 561]]);
const thankYouNoTune = row("Thank You, Lord", null, [["G", 221]]);
const thankYouOwnTune = row("Thank You, Lord", "THANK YOU, LORD", [["R", 266]]);
const chorusOnly = row("Alleluia", "ALLELUIA", [["CB", null, null, 1]]);
const nowhere = row("Unplaced Hymn", "SOMEWHERE", []);

const ROWS = [
    amazingGrace,
    chargeToKeep,
    otherAt396,
    doxology,
    rejoice,
    tisSoSweet,
    howGreatOurJoy,
    thankYouLynch,
    thankYouNoTune,
    thankYouOwnTune,
    chorusOnly,
    nowhere,
];

const titles = (rows: CatalogSongSummary[]) =>
    rows.map(({ title, tuneName }) => (tuneName ? `${title} (${tuneName})` : title));

function search(q: string, book: string | null = null): CatalogSongSummary[] {
    return filterCatalogSongs(ROWS, { q, book });
}

describe("foldForSearch", () => {
    test.each([
        ["Amazing Grace", "amazing grace"],
        ["  AMAZING   grace!  ", "amazing grace"],
        ["All Hail the Power of Jesus' Name", "all hail the power of jesus name"],
        ["‘Tis So Sweet", "tis so sweet"],
        ["O’er the Hills", "oer the hills"],
        ["Rejoice – the Lord Is King!", "rejoice the lord is king"],
        ["Come, Thou Long-Expected Jesus", "come thou long expected jesus"],
        ["Faith & Hope", "faith and hope"],
        ["JÜNGST", "jungst"],
        ["IL EST NÉ", "il est ne"],
        ["Psalm 23", "psalm 23"],
        ["?!", ""],
    ])("%j becomes %j", (text, expected) => {
        expect(foldForSearch(text)).toBe(expected);
    });
});

describe("parseCatalogSongsQuery", () => {
    const parse = (query: string) =>
        parseCatalogSongsQuery(new URLSearchParams(query), BOOK_CODES);

    test("falls back to no search, every book, by title, page 1", () => {
        expect(parse("")).toEqual({ q: "", book: null, sort: "title", page: 1 });
        expect(parse("q=&book=&sort=&page=")).toEqual({
            q: "",
            book: null,
            sort: "title",
            page: 1,
        });
    });

    test("reads the search, trimmed, the book, the sort and the page", () => {
        expect(parse("q=+amazing+grace+&book=G&sort=number&page=3")).toEqual({
            q: "amazing grace",
            book: "G",
            sort: "number",
            page: 3,
        });
    });

    test("matches the book without regard to case, giving the catalog's spelling", () => {
        expect(parse("book=cb").book).toBe("CB");
        expect(parse("book=Cb").book).toBe("CB");
    });

    test("ignores a book, sort or page it does not know", () => {
        expect(parse("book=Q&sort=tune&page=0")).toEqual({
            q: "",
            book: null,
            sort: "title",
            page: 1,
        });
        expect(parse("sort=Number&page=-2").sort).toBe("title");
    });
});

describe("filterCatalogSongs", () => {
    test("keeps every row, in order, with no search and no book", () => {
        expect(search("")).toEqual(ROWS);
        expect(search("   ")).toEqual(ROWS);
    });

    test("finds words of the title in any order, case and spacing", () => {
        expect(titles(search("amazing grace"))).toEqual(["Amazing Grace (NEW BRITAIN)"]);
        expect(titles(search("GRACE   amazing"))).toEqual(["Amazing Grace (NEW BRITAIN)"]);
        expect(titles(search("amaz"))).toEqual(["Amazing Grace (NEW BRITAIN)"]);
    });

    test("ignores punctuation, apostrophes and curly quotes", () => {
        expect(search("'tis so sweet")).toEqual([tisSoSweet]);
        expect(search("tis so")).toEqual([tisSoSweet]);
        expect(search("rejoice, the lord")).toEqual([rejoice]);
    });

    test("finds a hymn's aliases", () => {
        rejoice.aliases.forEach((alias) => {
            expect(search(alias)).toEqual([rejoice]);
        });
        expect(search("rejoice – the lord is king!")).toEqual([rejoice]);
    });

    test("finds the tune name and the tune's aliases, accents or not", () => {
        expect(search("new britain")).toEqual([amazingGrace]);
        expect(search("darwal")).toEqual([rejoice]);
        expect(search("jungst")).toEqual([howGreatOurJoy]);
        expect(search("jüngst")).toEqual([howGreatOurJoy]);
    });

    test("finds every row with an entry of that number", () => {
        expect(search("396")).toEqual([chargeToKeep, otherAt396]);
        expect(search("14")).toEqual([doxology]);
        expect(search("0396")).toEqual([chargeToKeep, otherAt396]);
        expect(search("999")).toEqual([]);
    });

    test("finds the row with an entry of that label, in any case and spacing", () => {
        for (const q of ["R-396", "r-396", "R396", "r 396", " R - 396 "]) {
            expect(search(q)).toEqual([chargeToKeep]);
        }
        expect(search("G-396")).toEqual([otherAt396]);
        expect(search("G-Front Cover")).toEqual([doxology]);
        expect(search("g front cover")).toEqual([doxology]);
    });

    test("does not take a label search for words", () => {
        // "R-39" is no entry's label, and "39" is no word of any row's text.
        expect(search("R-39")).toEqual([]);
    });

    test("finds every song in an unnumbered book by its label", () => {
        expect(search("chorus book")).toEqual([amazingGrace, chorusOnly]);
    });

    test("matches everything for a search with no letters or digits", () => {
        expect(search("?!")).toEqual(ROWS);
    });

    test("keeps the rows with an entry in the book", () => {
        expect(search("", "CB")).toEqual([amazingGrace, chorusOnly]);
        expect(search("", "G")).toEqual([
            amazingGrace,
            chargeToKeep,
            otherAt396,
            doxology,
            rejoice,
            thankYouNoTune,
        ]);
    });

    test("combines the search and the book", () => {
        expect(search("thank you", "R")).toEqual([thankYouLynch, thankYouOwnTune]);
        expect(search("396", "R")).toEqual([chargeToKeep]);
        expect(search("amazing", "X")).toEqual([]);
    });
});

describe("sortCatalogSongs", () => {
    test("sorts by title without regard to case, accents and punctuation, then by tune", () => {
        expect(titles(sortCatalogSongs(ROWS, "title", null, BOOK_CODES))).toEqual([
            "A Charge to Keep I Have (BOYLSTON)",
            "Alleluia (ALLELUIA)",
            "Amazing Grace (NEW BRITAIN)",
            "Doxology (OLD HUNDREDTH)",
            "How Great Our Joy (JÜNGST)",
            "O Worship the King (LYONS)",
            "Rejoice, the Lord Is King (DARWALL)",
            "Thank You, Lord (LYNCH)",
            "Thank You, Lord (THANK YOU, LORD)",
            "Thank You, Lord",
            "‘Tis So Sweet to Trust in Jesus (TRUST IN JESUS)",
            "Unplaced Hymn (SOMEWHERE)",
        ]);
    });

    test("does not change the array it is given", () => {
        const rows = [doxology, amazingGrace];
        sortCatalogSongs(rows, "title", null, BOOK_CODES);
        expect(rows).toEqual([doxology, amazingGrace]);
    });

    test("sorts by number in the book, the front cover first", () => {
        const great = filterCatalogSongs(ROWS, { q: "", book: "G" });
        expect(
            sortCatalogSongs(great, "number", "G", BOOK_CODES).map(
                (song) => song.entries.find(({ bookCode }) => bookCode === "G")?.label
            )
        ).toEqual(["G-Front Cover", "G-143", "G-221", "G-247", "G-317", "G-396"]);
    });

    test("sorts an unnumbered book by position", () => {
        expect(sortCatalogSongs([amazingGrace, chorusOnly], "number", "CB", BOOK_CODES)).toEqual([
            chorusOnly,
            amazingGrace,
        ]);
    });

    test("with no book, sorts by each row's first entry in book order, rows without entries last", () => {
        expect(
            sortCatalogSongs(ROWS, "number", null, BOOK_CODES).map(
                (song) => song.entries[0]?.label ?? song.title
            )
        ).toEqual([
            "R-14",
            "R-43",
            "R-108",
            "R-198",
            "R-266",
            "R-389",
            "R-396",
            "R-561",
            "G-221",
            "G-396",
            "Chorus Book",
            "Unplaced Hymn",
        ]);
    });

    test("puts rows without an entry in the book last, by title", () => {
        expect(
            titles(sortCatalogSongs([thankYouLynch, chorusOnly, doxology], "number", "G", BOOK_CODES))
        ).toEqual(["Doxology (OLD HUNDREDTH)", "Alleluia (ALLELUIA)", "Thank You, Lord (LYNCH)"]);
    });
});

describe("pageCatalogSongs", () => {
    const many = Array.from({ length: 120 }, (_, index) =>
        row(`Hymn ${String(index).padStart(3, "0")}`, null, [])
    );

    test("gives the page asked for", () => {
        const page = pageCatalogSongs(many, 2);
        expect(page.rows).toEqual(many.slice(50, 100));
        expect(page).toMatchObject({ page: 2, totalPages: 3, total: 120 });
    });

    test("clamps a page past the end to the last page", () => {
        const page = pageCatalogSongs(many, 9);
        expect(page.rows).toEqual(many.slice(100));
        expect(page).toMatchObject({ page: 3, totalPages: 3, total: 120 });
    });

    test("takes a page size", () => {
        expect(pageCatalogSongs(many, 1, 100)).toMatchObject({ totalPages: 2 });
    });

    test("gives an empty list as page 1 of 1", () => {
        expect(pageCatalogSongs([], 4)).toEqual({
            rows: [],
            page: 1,
            totalPages: 1,
            total: 0,
        });
    });

    test("pages 50 rows at a time by default", () => {
        expect(CATALOG_PAGE_SIZE).toBe(50);
    });
});

describe("selectCatalogSongs", () => {
    const query = (fields: Partial<CatalogSongsQuery>): CatalogSongsQuery => ({
        q: "",
        book: null,
        sort: "title",
        page: 1,
        ...fields,
    });

    test("filters, sorts and pages", () => {
        const result = selectCatalogSongs(
            ROWS,
            query({ q: "thank you", sort: "number", book: "R" }),
            BOOK_CODES,
            1
        );
        expect(result).toEqual({
            rows: [thankYouOwnTune],
            page: 1,
            totalPages: 2,
            total: 2,
        });
        expect(
            selectCatalogSongs(
                ROWS,
                query({ q: "thank you", sort: "number", book: "R", page: 2 }),
                BOOK_CODES,
                1
            ).rows
        ).toEqual([thankYouLynch]);
    });

    test("gives every row on one page by default", () => {
        const result = selectCatalogSongs(ROWS, query({}), BOOK_CODES);
        expect(result.total).toBe(ROWS.length);
        expect(result.rows[0]).toBe(chargeToKeep);
    });
});
