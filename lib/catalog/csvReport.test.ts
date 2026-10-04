import { describe, expect, test } from "vitest";
import type { BookCsvMatch, BookCsvReport, BookCsvRow } from "@/lib/domain";
import {
    CSV_ISSUES_SHOWN,
    CSV_ROWS_OPEN_MAX,
    CSV_ROWS_SHOWN,
    OUTCOME_LABELS,
    PROBLEM_LABELS,
    WARNING_LABELS,
    describeHiddenIssues,
    describeHymnMatch,
    describeShownRows,
    describeSongMatch,
    describeTuneMatch,
    issueLine,
    limitList,
    placeText,
    summarizeCsvReport,
} from "./csvReport";

/** A row of a report; the fields a test does not set are those of a plain row that adds its entry. */
function row(over: Partial<BookCsvRow> = {}): BookCsvRow {
    return {
        line: 2,
        number: 12,
        position: null,
        label: "CB-12",
        title: "Amazing Grace",
        tune: "NEW BRITAIN",
        variantNote: null,
        hymn: { kind: "new" },
        tuneMatch: { kind: "new" },
        song: "new",
        outcome: "add",
        ...over,
    };
}

/** A report with these rows, problems and warnings. */
function report(over: Partial<BookCsvReport> = {}): BookCsvReport {
    return {
        book: { id: 3, code: "CB", name: "Chorus Book", numbered: true },
        input: { rows: 0, blankRows: 0, columns: ["number", "title", "tune", "variant"] },
        planned: {
            books: 0,
            hymns: 0,
            hymnAliases: 0,
            tunes: 0,
            tuneAliases: 0,
            songs: 0,
            songsWithoutTune: 0,
            entries: 0,
        },
        problems: [],
        warnings: [],
        rows: [],
        ...over,
    };
}

describe("summarizeCsvReport", () => {
    test("counts the rows by what applying does with them", () => {
        const summary = summarizeCsvReport(
            report({
                input: { rows: 5, blankRows: 1, columns: [] },
                rows: [row(), row({ line: 3 }), row({ line: 4, outcome: "skip" }), row({ line: 5, outcome: "blocked" })],
                warnings: [{ reason: "already-in-book", line: 4, lines: [4], message: "x" }],
            })
        );

        expect(summary).toEqual({
            rows: 4,
            blankRows: 1,
            adding: 2,
            skipped: 1,
            blocked: 1,
            problems: 0,
            warnings: 1,
            canApply: true,
            nothingToAdd: false,
        });
    });

    test("a problem blocks the import, so it cannot be applied", () => {
        const summary = summarizeCsvReport(
            report({
                rows: [row({ outcome: "blocked" })],
                problems: [{ reason: "bad-number", line: 2, lines: [2], message: "x" }],
            })
        );

        expect(summary).toMatchObject({ problems: 1, canApply: false, nothingToAdd: false });
    });

    test("a file with no problem that adds nothing says so, as a file of rows the book has already", () => {
        const summary = summarizeCsvReport(report({ rows: [row({ outcome: "skip" })] }));

        expect(summary).toMatchObject({ canApply: true, adding: 0, skipped: 1, nothingToAdd: true });
    });

    test("a report with no rows at all and a problem is not 'nothing to add'", () => {
        const summary = summarizeCsvReport(
            report({ problems: [{ reason: "empty", line: null, lines: [], message: "The file is empty." }] })
        );

        expect(summary).toMatchObject({ rows: 0, canApply: false, nothingToAdd: false });
    });
});

describe("limiting a long list", () => {
    test("keeps the first of the items and counts the rest", () => {
        expect(limitList([1, 2, 3, 4, 5], 3)).toEqual({ shown: [1, 2, 3], hidden: 2 });
        expect(limitList([1, 2], 3)).toEqual({ shown: [1, 2], hidden: 0 });
        expect(limitList([], 3)).toEqual({ shown: [], hidden: 0 });
    });

    test("does not change the list it is given", () => {
        const items = [1, 2, 3];
        limitList(items, 1);
        expect(items).toEqual([1, 2, 3]);
    });

    test("the limits show a page's worth, and a long rows section starts closed", () => {
        expect(CSV_ISSUES_SHOWN).toBeLessThan(CSV_ROWS_SHOWN);
        expect(CSV_ROWS_OPEN_MAX).toBeLessThan(CSV_ROWS_SHOWN);
    });

    test("says how many problems or warnings are not listed, in the singular for one", () => {
        expect(describeHiddenIssues(1, "problem")).toBe("1 more problem is not listed.");
        expect(describeHiddenIssues(120, "warning")).toBe("120 more warnings are not listed.");
    });

    test("says how many rows are shown of the total", () => {
        expect(describeShownRows(300, 1200)).toBe(
            "Showing the first 300 of 1,200 rows. Problems and warnings above are listed by line, whichever row they are on."
        );
    });
});

describe("the words for a report", () => {
    test("every problem, warning and outcome has a short label", () => {
        expect(PROBLEM_LABELS["number-duplicated"]).toBe("Number twice");
        expect(WARNING_LABELS["already-in-book"]).toBe("Already in the book");
        expect(OUTCOME_LABELS).toEqual({ add: "Adds the entry", skip: "Left out", blocked: "Blocked" });
        for (const label of [...Object.values(PROBLEM_LABELS), ...Object.values(WARNING_LABELS)]) {
            expect(label.length).toBeGreaterThan(0);
        }
    });

    test("a problem about the whole file is on the line 'File'", () => {
        expect(issueLine({ line: null })).toBe("File");
        expect(issueLine({ line: 7 })).toBe("7");
    });

    test("a numbered book's row is placed by its label, a book without numbers' by its position", () => {
        expect(placeText({ label: "CB-12", position: null }, true)).toBe("CB-12");
        expect(placeText({ label: null, position: null }, true)).toBe("No number");
        expect(placeText({ label: "Chorus Book", position: 3 }, false)).toBe("Position 3");
        expect(placeText({ label: null, position: null }, false)).toBe("No position");
    });

    test("a hymn and a tune match the catalog by name, by another name, or are new", () => {
        const byName: BookCsvMatch = { kind: "existing", id: 1, name: "Amazing Grace", by: "name" };
        const byAlias: BookCsvMatch = { kind: "existing", id: 1, name: "Amazing Grace", by: "alias" };

        expect(describeHymnMatch(byName)).toBe("Hymn in the catalog");
        expect(describeHymnMatch(byAlias)).toBe('Hymn in the catalog, as "Amazing Grace"');
        expect(describeHymnMatch({ kind: "new" })).toBe("New hymn");
        expect(describeTuneMatch(byName)).toBe("Tune in the catalog");
        expect(describeTuneMatch(byAlias)).toBe('Tune in the catalog, as "Amazing Grace"');
        expect(describeTuneMatch({ kind: "new" })).toBe("New tune");
        expect(describeTuneMatch({ kind: "none" })).toBe("No tune");
    });

    test("a song is new, the catalog's, or not matched (a row that has a problem)", () => {
        expect(describeSongMatch("new")).toBe("New song");
        expect(describeSongMatch("existing")).toBe("Song in the catalog");
        expect(describeSongMatch(null)).toBe("Not matched");
    });
});
