import { describe, expect, test } from "vitest";
import type { CatalogSongSummary, LabelledEntry } from "@/lib/domain";
import {
    CATALOG_MARKS,
    CATALOG_PAGE_SIZE,
    arrangeCatalogSongs,
    catalogTagIdsBySong,
    countMarked,
    filterCatalogSongs,
    foldForSearch,
    isUsed,
    pageCatalogSongs,
    parseCatalogSongsQuery,
    parseCatalogTag,
    selectCatalogSongs,
    sortCatalogSongs,
    type CatalogSongsQuery,
    type CatalogTagFilter,
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
        linkedBy: null,
        lastScheduledAt: null,
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
        marks: [],
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
        aliases: ["Rejoice \u2013 the Lord Is King!"],
        tuneAliases: ["DARWAL"],
    }
);
const tisSoSweet = row("\u2018Tis So Sweet to Trust in Jesus", "TRUST IN JESUS", [
    ["R", 389],
]);
const howGreatOurJoy = row("How Great Our Joy", "J\u00DCNGST", [["R", 198]]);
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
    return filterCatalogSongs(ROWS, { q, book, linked: "all", used: "all" });
}

describe("foldForSearch", () => {
    test.each([
        ["Amazing Grace", "amazing grace"],
        ["  AMAZING   grace!  ", "amazing grace"],
        ["All Hail the Power of Jesus' Name", "all hail the power of jesus name"],
        ["\u2018Tis So Sweet", "tis so sweet"],
        ["O\u2019er the Hills", "oer the hills"],
        ["Rejoice \u2013 the Lord Is King!", "rejoice the lord is king"],
        ["Come, Thou Long-Expected Jesus", "come thou long expected jesus"],
        ["Faith & Hope", "faith and hope"],
        ["J\u00DCNGST", "jungst"],
        ["IL EST N\u00C9", "il est ne"],
        ["Psalm 23", "psalm 23"],
        ["?!", ""],
    ])("%j becomes %j", (text, expected) => {
        expect(foldForSearch(text)).toBe(expected);
    });
});

describe("parseCatalogSongsQuery", () => {
    const parse = (query: string) =>
        parseCatalogSongsQuery(new URLSearchParams(query), BOOK_CODES);

    const DEFAULTS: CatalogSongsQuery = {
        q: "",
        book: null,
        linked: "all",
        used: "all",
        mark: "all",
        sort: "title",
        page: 1,
    };

    test("falls back to no search, every book, linked or not, used or not, marked or not, by title, page 1", () => {
        expect(parse("")).toEqual(DEFAULTS);
        expect(parse("q=&book=&linked=&used=&mark=&sort=&page=")).toEqual(DEFAULTS);
    });

    test("reads the search, trimmed, the book, the filters, the sort and the page", () => {
        expect(
            parse("q=+amazing+grace+&book=G&linked=yes&used=never&mark=to-learn&sort=number&page=3")
        ).toEqual({
            q: "amazing grace",
            book: "G",
            linked: "yes",
            used: "never",
            mark: "to-learn",
            sort: "number",
            page: 3,
        });
    });

    test("reads each value of the link and usage filters", () => {
        expect(parse("linked=all").linked).toBe("all");
        expect(parse("linked=yes").linked).toBe("yes");
        expect(parse("linked=no").linked).toBe("no");
        expect(parse("used=all").used).toBe("all");
        expect(parse("used=never").used).toBe("never");
    });

    test("matches the book without regard to case, giving the catalog's spelling", () => {
        expect(parse("book=cb").book).toBe("CB");
        expect(parse("book=Cb").book).toBe("CB");
    });

    test("ignores a book, filter, sort or page it does not know", () => {
        expect(parse("book=Q&linked=maybe&used=always&mark=later&sort=tune&page=0")).toEqual(DEFAULTS);
        expect(parse("sort=Number&page=-2").sort).toBe("title");
    });

    test("spells the link and usage filters exactly, so a bad value falls back", () => {
        expect(parse("linked=YES").linked).toBe("all");
        expect(parse("linked=true").linked).toBe("all");
        expect(parse("used=Never").used).toBe("all");
        expect(parse("used=unused").used).toBe("all");
    });

    test("reads each mark, spelled exactly, so a bad value falls back", () => {
        expect(CATALOG_MARKS).toEqual(["all", "to-learn"]);
        expect(parse("mark=all").mark).toBe("all");
        expect(parse("mark=to-learn").mark).toBe("to-learn");
        expect(parse("mark=To-Learn").mark).toBe("all");
        expect(parse("mark=to+learn").mark).toBe("all");
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
        expect(search("rejoice \u2013 the lord is king!")).toEqual([rejoice]);
    });

    test("finds the tune name and the tune's aliases, accents or not", () => {
        expect(search("new britain")).toEqual([amazingGrace]);
        expect(search("darwal")).toEqual([rejoice]);
        expect(search("jungst")).toEqual([howGreatOurJoy]);
        expect(search("j\u00FCngst")).toEqual([howGreatOurJoy]);
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

describe("isUsed", () => {
    test("is true for a song whose Planning Center song has a last scheduled date", () => {
        expect(isUsed({ lastScheduledAt: "2026-09-27T08:00:00Z" })).toBe(true);
    });

    test("is false for a song with no date: not linked, or linked and never scheduled", () => {
        expect(isUsed({ lastScheduledAt: null })).toBe(false);
    });
});

describe("the link and usage filters", () => {
    const notLinked = row("Not Linked", "TUNE A", [["R", 1]]);
    const neverScheduled = row("Linked, Never Scheduled", "TUNE B", [["R", 2]], {
        pcoSongId: "1002",
        linkedBy: "manual",
    });
    const scheduled = row("Linked and Scheduled", "TUNE C", [["G", 3]], {
        pcoSongId: "1003",
        linkedBy: "auto",
        lastScheduledAt: "2026-09-27T08:00:00Z",
    });
    const LIST = [notLinked, neverScheduled, scheduled];

    function filter(fields: Partial<CatalogSongsQuery>): CatalogSongSummary[] {
        return filterCatalogSongs(LIST, {
            q: "",
            book: null,
            linked: "all",
            used: "all",
            ...fields,
        });
    }

    test("keeps every song for any link and any usage", () => {
        expect(filter({})).toEqual(LIST);
    });

    test("keeps the songs linked to a Planning Center song for linked yes", () => {
        expect(filter({ linked: "yes" })).toEqual([neverScheduled, scheduled]);
    });

    test("keeps the songs that are not linked for linked no", () => {
        expect(filter({ linked: "no" })).toEqual([notLinked]);
    });

    test("keeps the songs not linked and the linked ones never scheduled for used never", () => {
        expect(filter({ used: "never" })).toEqual([notLinked, neverScheduled]);
    });

    test("combines the two: used never of the linked songs, or of the songs not linked", () => {
        expect(filter({ linked: "yes", used: "never" })).toEqual([neverScheduled]);
        expect(filter({ linked: "no", used: "never" })).toEqual([notLinked]);
    });

    test("combines with the search and the book", () => {
        expect(filter({ q: "scheduled", used: "never" })).toEqual([neverScheduled]);
        expect(filter({ q: "linked", linked: "no" })).toEqual([notLinked]);
        expect(filter({ book: "R", used: "never" })).toEqual([notLinked, neverScheduled]);
        expect(filter({ book: "G", used: "never" })).toEqual([]);
        expect(filter({ book: "G", linked: "yes" })).toEqual([scheduled]);
    });
});

describe("the mark filter", () => {
    const toLearn = row("To Learn", "TUNE A", [["R", 1]], { marks: ["to-learn"] });
    const linkedToLearn = row("Linked, To Learn", "TUNE B", [["G", 2]], {
        pcoSongId: "1002",
        linkedBy: "manual",
        marks: ["to-learn"],
    });
    const unmarked = row("Unmarked", "TUNE C", [["R", 3]]);
    const LIST = [toLearn, linkedToLearn, unmarked];

    function filter(fields: Partial<CatalogSongsQuery>): CatalogSongSummary[] {
        return filterCatalogSongs(LIST, { q: "", book: null, linked: "all", used: "all", ...fields });
    }

    test("keeps every song for all marks, or with the mark left out", () => {
        expect(filter({ mark: "all" })).toEqual(LIST);
        expect(filter({})).toEqual(LIST);
    });

    test("keeps the songs with the mark", () => {
        expect(filter({ mark: "to-learn" })).toEqual([toLearn, linkedToLearn]);
    });

    test("combines with the other filters and the search", () => {
        expect(filter({ mark: "to-learn", linked: "yes" })).toEqual([linkedToLearn]);
        expect(filter({ mark: "to-learn", book: "R" })).toEqual([toLearn]);
        expect(filter({ mark: "to-learn", q: "linked" })).toEqual([linkedToLearn]);
        expect(filter({ mark: "to-learn", q: "unmarked" })).toEqual([]);
    });

    test("applies before the list sorts and pages it, and to the export", () => {
        const query = { q: "", book: null, linked: "all", used: "all", sort: "title", page: 1 } as const;
        expect(arrangeCatalogSongs(LIST, { ...query, mark: "to-learn" }, BOOK_CODES)).toEqual([
            linkedToLearn,
            toLearn,
        ]);
        expect(selectCatalogSongs(LIST, { ...query, mark: "to-learn" }, BOOK_CODES, 1)).toEqual({
            rows: [linkedToLearn],
            page: 1,
            totalPages: 2,
            total: 2,
        });
        expect(arrangeCatalogSongs(LIST, query, BOOK_CODES)).toHaveLength(3);
    });

    test("counts the songs with a mark", () => {
        expect(countMarked(LIST, "to-learn")).toBe(2);
        expect(countMarked([unmarked], "to-learn")).toBe(0);
        expect(countMarked([], "to-learn")).toBe(0);
    });
});

describe("sortCatalogSongs", () => {
    test("sorts by title without regard to case, accents and punctuation, then by tune", () => {
        expect(titles(sortCatalogSongs(ROWS, "title", null, BOOK_CODES))).toEqual([
            "A Charge to Keep I Have (BOYLSTON)",
            "Alleluia (ALLELUIA)",
            "Amazing Grace (NEW BRITAIN)",
            "Doxology (OLD HUNDREDTH)",
            "How Great Our Joy (J\u00DCNGST)",
            "O Worship the King (LYONS)",
            "Rejoice, the Lord Is King (DARWALL)",
            "Thank You, Lord (LYNCH)",
            "Thank You, Lord (THANK YOU, LORD)",
            "Thank You, Lord",
            "\u2018Tis So Sweet to Trust in Jesus (TRUST IN JESUS)",
            "Unplaced Hymn (SOMEWHERE)",
        ]);
    });

    test("does not change the array it is given", () => {
        const rows = [doxology, amazingGrace];
        sortCatalogSongs(rows, "title", null, BOOK_CODES);
        expect(rows).toEqual([doxology, amazingGrace]);
    });

    test("sorts by number in the book, the front cover first", () => {
        const great = filterCatalogSongs(ROWS, { q: "", book: "G", linked: "all", used: "all" });
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

describe("arrangeCatalogSongs", () => {
    const query = (
        fields: Partial<Omit<CatalogSongsQuery, "page">> = {}
    ): Omit<CatalogSongsQuery, "page"> => ({
        q: "",
        book: null,
        linked: "all",
        used: "all",
        mark: "all",
        sort: "title",
        ...fields,
    });

    test("filters and then sorts, as the list does", () => {
        const fields = query({ q: "thank you", sort: "number", book: "R" });
        expect(arrangeCatalogSongs(ROWS, fields, BOOK_CODES)).toEqual([
            thankYouOwnTune,
            thankYouLynch,
        ]);
        expect(arrangeCatalogSongs(ROWS, query({ q: "thank you" }), BOOK_CODES)).toEqual([
            thankYouLynch,
            thankYouOwnTune,
            thankYouNoTune,
        ]);
    });

    test("applies the link and usage filters", () => {
        const never = row("Never Scheduled", "TUNE", [["R", 7]], { pcoSongId: "9001" });
        const used = row("Scheduled", "TUNE", [["R", 8]], {
            pcoSongId: "9002",
            lastScheduledAt: "2026-09-27T08:00:00Z",
        });
        const rows = [used, never, thankYouLynch];
        expect(arrangeCatalogSongs(rows, query({ used: "never" }), BOOK_CODES)).toEqual([
            never,
            thankYouLynch,
        ]);
        expect(
            arrangeCatalogSongs(rows, query({ linked: "yes", used: "never" }), BOOK_CODES)
        ).toEqual([never]);
        expect(arrangeCatalogSongs(rows, query({ linked: "no" }), BOOK_CODES)).toEqual([
            thankYouLynch,
        ]);
    });

    test("keeps every row the filters leave, however many pages they make", () => {
        const many = Array.from({ length: 120 }, (_, index) =>
            row(`Hymn ${String(index).padStart(3, "0")}`, null, [])
        );
        expect(arrangeCatalogSongs(many, query(), BOOK_CODES)).toEqual(many);
    });

    test("does not change the array it is given", () => {
        const rows = [doxology, amazingGrace];
        arrangeCatalogSongs(rows, query(), BOOK_CODES);
        expect(rows).toEqual([doxology, amazingGrace]);
    });
});

describe("selectCatalogSongs", () => {
    const query = (fields: Partial<CatalogSongsQuery>): CatalogSongsQuery => ({
        q: "",
        book: null,
        linked: "all",
        used: "all",
        mark: "all",
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

    test("applies the link and usage filters before it pages", () => {
        const first = row("A Hymn", null, [], { pcoSongId: "9101" });
        const second = row("B Hymn", null, [], { pcoSongId: "9102" });
        const third = row("C Hymn", null, [], {
            pcoSongId: "9103",
            lastScheduledAt: "2026-09-27T08:00:00Z",
        });
        const rows = [third, second, first, thankYouLynch];
        const never = query({ linked: "yes", used: "never" });
        expect(selectCatalogSongs(rows, never, BOOK_CODES, 1)).toEqual({
            rows: [first],
            page: 1,
            totalPages: 2,
            total: 2,
        });
        expect(selectCatalogSongs(rows, { ...never, page: 2 }, BOOK_CODES, 1).rows).toEqual([
            second,
        ]);
    });

    test("gives every row on one page by default", () => {
        const result = selectCatalogSongs(ROWS, query({}), BOOK_CODES);
        expect(result.total).toBe(ROWS.length);
        expect(result.rows[0]).toBe(chargeToKeep);
    });
});

describe("the tag filter", () => {
    const TAG_IDS = ["101", "102", "301"];
    const hymn = row("Linked Hymn", "TUNE A", [["R", 1]], { pcoSongId: "5001", linkedBy: "auto" });
    const chorus = row("Linked Chorus", "TUNE B", [["G", 2]], {
        pcoSongId: "5002",
        linkedBy: "manual",
        lastScheduledAt: "2026-09-27T08:00:00Z",
    });
    const untagged = row("Linked, No Tags", "TUNE C", [["R", 3]], { pcoSongId: "5003" });
    const notLinked = row("Not Linked", "TUNE D", [["R", 4]]);
    const LIST = [hymn, chorus, untagged, notLinked];
    const TAGS_BY_SONG: Record<string, string[]> = {
        "5001": ["102", "301"],
        "5002": ["101"],
        // A Planning Center song not in the catalog.
        "5999": ["102"],
    };

    function tagged(tagId: string): CatalogTagFilter {
        return { tagId, tagIdsBySong: TAGS_BY_SONG };
    }

    function filter(tag: CatalogTagFilter | null, fields: Partial<CatalogSongsQuery> = {}) {
        return filterCatalogSongs(LIST, { q: "", book: null, linked: "all", used: "all", tag, ...fields });
    }

    test("reads a known tag's id from ?tag=, spelled exactly", () => {
        expect(parseCatalogTag(new URLSearchParams("tag=102"), TAG_IDS)).toBe("102");
        expect(parseCatalogTag(new URLSearchParams("q=x&tag=301&page=2"), TAG_IDS)).toBe("301");
    });

    test("falls back to any tag for a missing, unknown or misspelled one", () => {
        for (const query of ["", "tag=", "tag=999", "tag=+102", "tag=102x", "tag=Hymn", "tag=0102"]) {
            expect(parseCatalogTag(new URLSearchParams(query), TAG_IDS)).toBeNull();
        }
        expect(parseCatalogTag(new URLSearchParams("tag=102"), [])).toBeNull();
    });

    test("leaves the rest of the view as parseCatalogSongsQuery reads it", () => {
        expect(parseCatalogSongsQuery(new URLSearchParams("tag=102&linked=yes"), BOOK_CODES)).toEqual({
            q: "",
            book: null,
            linked: "yes",
            used: "all",
            mark: "all",
            sort: "title",
            page: 1,
        });
    });

    test("keeps every row with no tag filter", () => {
        expect(filter(null)).toEqual(LIST);
        expect(filterCatalogSongs(LIST, { q: "", book: null, linked: "all", used: "all" })).toEqual(LIST);
    });

    test("keeps the linked songs whose Planning Center song has the tag", () => {
        expect(filter(tagged("102"))).toEqual([hymn]);
        expect(filter(tagged("301"))).toEqual([hymn]);
        expect(filter(tagged("101"))).toEqual([chorus]);
    });

    test("never keeps a song that is not linked, which has no tags", () => {
        expect(filter(tagged("102"), { linked: "no" })).toEqual([]);
        expect(filter({ tagId: "102", tagIdsBySong: {} })).toEqual([]);
    });

    test("combines with the other filters and the search", () => {
        expect(filter(tagged("101"), { used: "never" })).toEqual([]);
        expect(filter(tagged("102"), { used: "never" })).toEqual([hymn]);
        expect(filter(tagged("102"), { book: "G" })).toEqual([]);
        expect(filter(tagged("102"), { q: "hymn" })).toEqual([hymn]);
        expect(filter(tagged("102"), { q: "chorus" })).toEqual([]);
    });

    test("ignores tags kept under a key that is not a song's own", () => {
        const proto = row("Proto", null, [], { pcoSongId: "constructor" });
        expect(
            filterCatalogSongs([proto], {
                q: "",
                book: null,
                linked: "all",
                used: "all",
                tag: { tagId: "102", tagIdsBySong: {} },
            })
        ).toEqual([]);
    });

    test("applies before the list sorts and pages it, and to the export", () => {
        const query: CatalogSongsQuery = {
            q: "",
            book: null,
            linked: "all",
            used: "all",
            mark: "all",
            sort: "title",
            page: 1,
        };
        const songs = [chorus, hymn, notLinked];
        const tagsBySong = { "5001": ["101"], "5002": ["101"] };
        expect(
            arrangeCatalogSongs(songs, { ...query, tag: { tagId: "101", tagIdsBySong: tagsBySong } }, BOOK_CODES)
        ).toEqual([chorus, hymn]);
        expect(
            selectCatalogSongs(songs, { ...query, tag: { tagId: "101", tagIdsBySong: tagsBySong } }, BOOK_CODES, 1)
        ).toEqual({ rows: [chorus], page: 1, totalPages: 2, total: 2 });
        expect(arrangeCatalogSongs(songs, query, BOOK_CODES)).toEqual([chorus, hymn, notLinked]);
    });

    test("trims the tags to the songs the list links to", () => {
        const trimmed = catalogTagIdsBySong(LIST, TAGS_BY_SONG);
        expect(trimmed).toEqual({ "5001": ["102", "301"], "5002": ["101"] });
        trimmed["5001"].push("x");
        expect(TAGS_BY_SONG["5001"]).toEqual(["102", "301"]);
        expect(catalogTagIdsBySong([], TAGS_BY_SONG)).toEqual({});
        expect(catalogTagIdsBySong([row("P", null, [], { pcoSongId: "toString" })], {})).toEqual({});
    });
});
