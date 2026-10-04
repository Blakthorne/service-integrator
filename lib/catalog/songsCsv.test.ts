import { describe, expect, test } from "vitest";
import type { CatalogSongSummary, LabelledEntry } from "@/lib/domain";
import {
    catalogCsvFilename,
    catalogSongsCsv,
    catalogSongsCsvRecords,
    localDateStamp,
    type CsvBook,
} from "./songsCsv";

const BOOKS: CsvBook[] = [
    { code: "R", name: "Rejoice Hymns" },
    { code: "G", name: "Great Hymns of the Faith" },
    { code: "CB", name: "Chorus Book" },
];

let nextId = 1;

/** A song with its entries as `[book code, label]`. */
function song(
    title: string,
    tuneName: string | null,
    entries: [string, string][],
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
        marks: [],
        entries: entries.map(
            ([bookCode, label], index): LabelledEntry => ({
                id: id * 100 + index,
                bookId: BOOKS.findIndex((book) => book.code === bookCode) + 1,
                songId: id,
                number: null,
                position: null,
                locationLabel: null,
                variantNote: null,
                bookCode,
                label,
            })
        ),
        ...extra,
    };
}

const amazingGrace = song(
    "Amazing Grace",
    "NEW BRITAIN",
    [
        ["R", "R-108"],
        ["G", "G-247"],
    ],
    { pcoSongId: "1001", linkedBy: "auto", lastScheduledAt: "2026-09-27T08:00:00Z" }
);
const comeThouFount = song("Come, Thou Fount of Every Blessing", "NETTLETON", [["G", "G-60"]], {
    pcoSongId: "1002",
    linkedBy: "manual",
});
const doxology = song("Doxology", null, [["G", "G-Front Cover"]]);
const withDescant = song("Come, Thou Almighty King", "ITALIAN HYMN", [
    ["R", "R-5"],
    ["R", "R-6"],
    ["CB", "Chorus Book"],
]);
const notInABook = song("Unplaced Hymn", "SOMEWHERE", []);

describe("catalogSongsCsvRecords", () => {
    test("starts with the header: title, tune, a column for each book, linked, last scheduled, to learn", () => {
        expect(catalogSongsCsvRecords([], BOOKS)).toEqual([
            ["Title", "Tune", "Rejoice Hymns", "Great Hymns of the Faith", "Chorus Book", "Linked", "Last scheduled", "To learn"],
        ]);
    });

    test("has a header with no book columns when there are no books", () => {
        expect(catalogSongsCsvRecords([amazingGrace], [])).toEqual([
            ["Title", "Tune", "Linked", "Last scheduled", "To learn"],
            ["Amazing Grace", "NEW BRITAIN", "yes", "2026-09-27", "no"],
        ]);
    });

    test("has a record for each song, in the order given", () => {
        expect(catalogSongsCsvRecords([comeThouFount, amazingGrace], BOOKS).slice(1)).toEqual([
            ["Come, Thou Fount of Every Blessing", "NETTLETON", "", "G-60", "", "yes", "", "no"],
            ["Amazing Grace", "NEW BRITAIN", "R-108", "G-247", "", "yes", "2026-09-27", "no"],
        ]);
    });

    test("leaves the tune empty when it is unknown, and a book empty when the song is not in it", () => {
        expect(catalogSongsCsvRecords([doxology, notInABook], BOOKS).slice(1)).toEqual([
            ["Doxology", "", "", "G-Front Cover", "", "no", "", "no"],
            ["Unplaced Hymn", "SOMEWHERE", "", "", "", "no", "", "no"],
        ]);
    });

    test("puts every label a song has in a book in its cell, apart by a semicolon", () => {
        expect(catalogSongsCsvRecords([withDescant], BOOKS)[1]).toEqual([
            "Come, Thou Almighty King",
            "ITALIAN HYMN",
            "R-5; R-6",
            "",
            "Chorus Book",
            "no",
            "",
            "no",
        ]);
    });

    test("writes whether it is linked from the Planning Center link, and the date from its date part", () => {
        const linkedNeverScheduled = song("Linked", "A", [], { pcoSongId: "1" });
        const lateInTheDay = song("Late", "B", [], {
            pcoSongId: "2",
            lastScheduledAt: "2026-01-04T23:30:00Z",
        });
        expect(
            catalogSongsCsvRecords([linkedNeverScheduled, lateInTheDay], []).map((record) =>
                record.slice(2)
            )
        ).toEqual([
            ["Linked", "Last scheduled", "To learn"],
            ["yes", "", "no"],
            ["yes", "2026-01-04", "no"],
        ]);
    });

    test("writes whether the song is marked to learn", () => {
        const marked = song("Be Thou My Vision", "SLANE", [], { marks: ["to-learn"] });
        expect(catalogSongsCsvRecords([marked], [])[1]).toEqual(["Be Thou My Vision", "SLANE", "no", "", "yes"]);
    });
});

describe("catalogSongsCsv", () => {
    test("writes the records as CSV: quoted where it must be, with CRLF line ends", () => {
        expect(catalogSongsCsv([comeThouFount, doxology], BOOKS)).toBe(
            [
                "Title,Tune,Rejoice Hymns,Great Hymns of the Faith,Chorus Book,Linked,Last scheduled,To learn",
                '"Come, Thou Fount of Every Blessing",NETTLETON,,G-60,,yes,,no',
                "Doxology,,,G-Front Cover,,no,,no",
                "",
            ].join("\r\n")
        );
    });

    test("writes just the header for no songs", () => {
        expect(catalogSongsCsv([], BOOKS)).toBe(
            "Title,Tune,Rejoice Hymns,Great Hymns of the Faith,Chorus Book,Linked,Last scheduled,To learn\r\n"
        );
    });

    test("guards a title that a spreadsheet would run as a formula", () => {
        const formula = song("=HYPERLINK(\"http://example.com\")", "-TUNE", []);
        expect(catalogSongsCsv([formula], []).split("\r\n")[1]).toBe(
            "\"'=HYPERLINK(\"\"http://example.com\"\")\",'-TUNE,no,,no"
        );
    });
});

describe("localDateStamp", () => {
    test("writes the date as year, month and day, each padded", () => {
        // Built from local parts, so the answer is the same in every time zone.
        expect(localDateStamp(new Date(2026, 9, 4, 12))).toBe("2026-10-04");
        expect(localDateStamp(new Date(2026, 0, 5, 0, 0))).toBe("2026-01-05");
        expect(localDateStamp(new Date(2026, 11, 31, 23, 59, 59))).toBe("2026-12-31");
    });
});

describe("catalogCsvFilename", () => {
    const NOW = new Date(2026, 9, 4, 9, 30);
    const filename = (filters: Partial<Parameters<typeof catalogCsvFilename>[0]>) =>
        catalogCsvFilename({ q: "", book: null, linked: "all", used: "all", ...filters }, NOW);

    test("is catalog and the day with no filter", () => {
        expect(filename({})).toBe("catalog-2026-10-04.csv");
    });

    test("says unused for the songs never scheduled", () => {
        expect(filename({ used: "never" })).toBe("catalog-unused-2026-10-04.csv");
    });

    test("says linked or unlinked for the link filter", () => {
        expect(filename({ linked: "yes" })).toBe("catalog-linked-2026-10-04.csv");
        expect(filename({ linked: "no" })).toBe("catalog-unlinked-2026-10-04.csv");
    });

    test("names the book by its code, in lower case", () => {
        expect(filename({ book: "G" })).toBe("catalog-g-2026-10-04.csv");
        expect(filename({ book: "CB", used: "never" })).toBe("catalog-cb-unused-2026-10-04.csv");
    });

    test("names the mark the list keeps", () => {
        expect(filename({ mark: "to-learn" })).toBe("catalog-to-learn-2026-10-04.csv");
        expect(filename({ mark: "all" })).toBe("catalog-2026-10-04.csv");
    });

    test("says search for a search", () => {
        expect(filename({ q: "amazing" })).toBe("catalog-search-2026-10-04.csv");
    });

    test("puts every filter in use in the name, always in the same order", () => {
        expect(filename({ q: "grace", book: "R", linked: "yes", used: "never", mark: "to-learn" })).toBe(
            "catalog-r-linked-unused-to-learn-search-2026-10-04.csv"
        );
    });

    test("keeps only what a file name can hold of a book code", () => {
        expect(filename({ book: "My_Book-2" })).toBe("catalog-my_book-2-2026-10-04.csv");
        expect(filename({ book: "../x" })).toBe("catalog-x-2026-10-04.csv");
    });
});
