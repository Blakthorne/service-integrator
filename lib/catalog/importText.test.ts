import { describe, expect, test } from "vitest";
import { planBookCsvText, type BookCsvBook, type BookCsvCatalog } from "@/lib/import/bookCsv";
import {
    CSV_COLUMN_HELP,
    CSV_FILE_RULES,
    CSV_SAMPLE_NUMBERED,
    CSV_SAMPLE_UNNUMBERED,
    describeBookColumns,
    describeBookOption,
    describePlanned,
    describeSplitPairTunes,
    importRunLabel,
    NO_TUNE_REASONS,
    SPLIT_PAIR_LABELS,
} from "./importText";

describe("importRunLabel", () => {
    test("names the kind and the id", () => {
        expect(importRunLabel({ id: 3, kind: "hymns-json" })).toBe("Seed import 3");
        expect(importRunLabel({ id: 4, kind: "csv" })).toBe("CSV import 4");
    });
});

describe("describePlanned", () => {
    const seed = {
        books: 2,
        hymns: 895,
        hymnAliases: 4,
        tunes: 768,
        tuneAliases: 1,
        songs: 921,
        songsWithoutTune: 107,
        entries: 1247,
    };

    test("lists what the seed adds", () => {
        expect(describePlanned(seed)).toBe(
            "2 books, 895 hymns, 768 tunes, 921 songs and 1,247 entries"
        );
    });

    test("uses the singular for a count of one", () => {
        expect(
            describePlanned({ ...seed, books: 1, hymns: 1, tunes: 1, songs: 1, entries: 1 })
        ).toBe("1 book, 1 hymn, 1 tune, 1 song and 1 entry");
    });

    test("leaves out a kind that the run adds none of: a book's file adds no book", () => {
        const file = { ...seed, books: 0, hymns: 3, tunes: 2, songs: 3, entries: 12 };

        expect(describePlanned(file)).toBe("3 hymns, 2 tunes, 3 songs and 12 entries");
        expect(describePlanned({ ...file, hymns: 0, tunes: 0, songs: 0 })).toBe("12 entries");
    });

    test("always names the entries, even when there are none", () => {
        expect(describePlanned({ ...seed, books: 0, hymns: 0, tunes: 0, songs: 0, entries: 0 })).toBe(
            "0 entries"
        );
    });
});

describe("the CSV file's help", () => {
    const NUMBERED: BookCsvBook = { id: 1, code: "CB", name: "Chorus Book", numbered: true, labelFormat: "CB-{n}" };
    const UNNUMBERED: BookCsvBook = { id: 2, code: "CH", name: "Choruses", numbered: false, labelFormat: "Choruses" };
    const EMPTY_CATALOG: BookCsvCatalog = { hymns: [], tunes: [], songs: [], entries: [] };

    test("names every column a file takes, once", () => {
        expect(CSV_COLUMN_HELP.map((column) => column.name)).toEqual([
            "number",
            "position",
            "title",
            "tune",
            "variant",
        ]);
        for (const column of CSV_COLUMN_HELP) {
            expect(column.text.length).toBeGreaterThan(20);
        }
    });

    test("the rules say the first row names the columns, to quote a comma, UTF-8 and the size", () => {
        expect(CSV_FILE_RULES).toContain("first row names the columns");
        expect(CSV_FILE_RULES).toContain("double quotes");
        expect(CSV_FILE_RULES).toContain("CSV UTF-8");
        expect(CSV_FILE_RULES).toContain("1 MB");
    });

    test("the sample files are files the importer takes as they are", () => {
        const numbered = planBookCsvText(NUMBERED, CSV_SAMPLE_NUMBERED, EMPTY_CATALOG);
        const unnumbered = planBookCsvText(UNNUMBERED, CSV_SAMPLE_UNNUMBERED, EMPTY_CATALOG);

        expect(numbered.report.problems).toEqual([]);
        expect(numbered.report.planned).toMatchObject({ hymns: 3, tunes: 2, songs: 3, entries: 3 });
        expect(unnumbered.report.problems).toEqual([]);
        expect(unnumbered.report.planned).toMatchObject({ hymns: 2, tunes: 0, songs: 2, entries: 2 });
    });

    test("the sample for a book without numbers starts with position, and the other with number", () => {
        expect(CSV_SAMPLE_NUMBERED.split("\n")[0]).toBe("number,title,tune,variant");
        expect(CSV_SAMPLE_UNNUMBERED.split("\n")[0]).toBe("position,title,tune,variant");
    });

    test("says which columns a book's file needs", () => {
        expect(describeBookColumns({ name: "Rejoice Hymns", numbered: true })).toBe(
            "Rejoice Hymns numbers its songs, so its file's columns are number, title, tune and variant."
        );
        expect(describeBookColumns({ name: "Chorus Book", numbered: false })).toBe(
            "Chorus Book has no numbers, so its file's columns are position, title, tune and variant."
        );
    });

    test("words a book in the list with its code, its numbering and whether it is in use", () => {
        const book = { name: "Chorus Book", code: "CB", numbered: false, active: true };

        expect(describeBookOption(book)).toBe("Chorus Book (CB) · not numbered");
        expect(describeBookOption({ ...book, numbered: true })).toBe("Chorus Book (CB) · numbered");
        expect(describeBookOption({ ...book, active: false })).toBe(
            "Chorus Book (CB) · not numbered · not in use"
        );
    });
});

describe("a split pair's outcome", () => {
    test("each outcome has a label of its own, a conflict is not an ambiguity", () => {
        expect(SPLIT_PAIR_LABELS).toEqual({
            merged: "Merged",
            ambiguous: "Ambiguous",
            conflict: "Conflict",
        });
    });

    test("words the tunes for what the outcome did with them", () => {
        expect(
            describeSplitPairTunes({ outcome: "merged", tunes: ["PINKSTON"] })
        ).toBe("Joined PINKSTON");
        expect(
            describeSplitPairTunes({
                outcome: "ambiguous",
                tunes: ["LYNCH", "THANK YOU, LORD"],
            })
        ).toBe("Candidates: LYNCH \u00b7 THANK YOU, LORD");
        expect(
            describeSplitPairTunes({ outcome: "conflict", tunes: ["PINKSTON"] })
        ).toBe("Would have joined PINKSTON");
    });
});

describe("why a song has no tune", () => {
    test("every reason has words, and no two share them", () => {
        expect(Object.keys(NO_TUNE_REASONS).sort()).toEqual([
            "ambiguous-split-pair",
            "no-tune",
            "split-pair-conflict",
            "variant-without-tune",
        ]);
        const words = Object.values(NO_TUNE_REASONS);
        expect(new Set(words).size).toBe(words.length);
    });

    test("says a conflict is about the song's entry in the book, not about candidate tunes", () => {
        expect(NO_TUNE_REASONS["split-pair-conflict"]).toBe(
            "The one song it could join already has an entry in this book"
        );
        expect(NO_TUNE_REASONS["split-pair-conflict"]).not.toBe(
            NO_TUNE_REASONS["ambiguous-split-pair"]
        );
    });
});
