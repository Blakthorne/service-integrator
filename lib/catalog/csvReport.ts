import type {
    BookCsvIssue,
    BookCsvMatch,
    BookCsvProblemReason,
    BookCsvReport,
    BookCsvRow,
    BookCsvWarningReason,
} from "@/lib/domain";
import { formatCount } from "./counts";

/**
 * What the review page of a book's CSV import shows, as pure helpers shared
 * by its components: the summary's counts, the words for each problem,
 * warning and row, and how much of a long list is shown. Each record is
 * typed by the union it spells out, so a new reason or outcome does not
 * compile until it has its words.
 */

/** How many problems, or warnings, the page lists before it says how many more there are. */
export const CSV_ISSUES_SHOWN = 100;

/** How many rows the page lists before it says how many more there are. */
export const CSV_ROWS_SHOWN = 300;

/** A report with more rows than this lists them in a section that starts closed. */
export const CSV_ROWS_OPEN_MAX = 50;

/** A short tag for each problem that blocks the import. */
export const PROBLEM_LABELS: Record<BookCsvProblemReason, string> = {
    malformed: "Not CSV",
    empty: "Empty file",
    header: "Header",
    "extra-fields": "Extra fields",
    "blank-title": "No title",
    "too-long": "Too long",
    "bad-number": "Number",
    "bad-position": "Position",
    "number-duplicated": "Number twice",
    "position-duplicated": "Position twice",
    "number-taken": "Number taken",
    "song-twice": "Song twice",
};

/** A short tag for each warning. */
export const WARNING_LABELS: Record<BookCsvWarningReason, string> = {
    "ambiguous-hymn": "Several hymns",
    "ambiguous-tune": "Several tunes",
    "already-in-book": "Already in the book",
    positions: "Order",
};

/** What applying the import does with a row. */
export const OUTCOME_LABELS: Record<BookCsvRow["outcome"], string> = {
    add: "Adds the entry",
    skip: "Left out",
    blocked: "Blocked",
};

/** What the review says of a report's rows and whether it can be applied. */
export interface CsvReportSummary {
    /** Rows that are not blank. */
    rows: number;
    /** Rows left out because they have nothing in them. */
    blankRows: number;
    /** Rows that add an entry. */
    adding: number;
    /** Rows left out because the book has the entry already. */
    skipped: number;
    /** Rows that a problem blocks. */
    blocked: number;
    /** Problems that block the import, which is refused while there are any. */
    problems: number;
    warnings: number;
    /** No problem blocks it. */
    canApply: boolean;
    /** It has no problem, and adds nothing: every row is in the book already. */
    nothingToAdd: boolean;
}

/** Count a report: its rows by outcome, its problems and warnings, and whether it can be applied. */
export function summarizeCsvReport(report: BookCsvReport): CsvReportSummary {
    const count = (outcome: BookCsvRow["outcome"]) =>
        report.rows.filter((row) => row.outcome === outcome).length;
    const adding = count("add");
    const canApply = report.problems.length === 0;
    return {
        rows: report.rows.length,
        blankRows: report.input.blankRows,
        adding,
        skipped: count("skip"),
        blocked: count("blocked"),
        problems: report.problems.length,
        warnings: report.warnings.length,
        canApply,
        nothingToAdd: canApply && adding === 0,
    };
}

/** The first `limit` of `items`, and how many are left out. */
export function limitList<T>(items: readonly T[], limit: number): { shown: T[]; hidden: number } {
    return { shown: items.slice(0, limit), hidden: Math.max(0, items.length - limit) };
}

/** What a list of problems or warnings says when it stops at its limit: "120 more warnings are not listed." */
export function describeHiddenIssues(hidden: number, noun: "problem" | "warning"): string {
    return `${formatCount(hidden)} more ${hidden === 1 ? noun : `${noun}s`} ${hidden === 1 ? "is" : "are"} not listed.`;
}

/** What the rows table says when it stops at `limit`. */
export function describeShownRows(shown: number, total: number): string {
    return `Showing the first ${formatCount(shown)} of ${formatCount(total)} rows. Problems and warnings above are listed by line, whichever row they are on.`;
}

/** The line a problem or warning is on, for its table: "File" for one about the whole file. */
export function issueLine(issue: Pick<BookCsvIssue<string>, "line">): string {
    return issue.line === null ? "File" : String(issue.line);
}

/** A row's place in the book: its label in a numbered book, or its position in one without numbers. */
export function placeText(row: Pick<BookCsvRow, "label" | "position">, numbered: boolean): string {
    if (numbered) {
        return row.label ?? "No number";
    }
    return row.position === null ? "No position" : `Position ${row.position}`;
}

/** How a row's hymn matched the catalog, in a few words. */
export function describeHymnMatch(match: BookCsvMatch): string {
    switch (match.kind) {
        case "new":
            return "New hymn";
        case "none":
            return "No hymn";
        case "existing":
            return match.by === "alias" ? `Hymn in the catalog, as "${match.name}"` : "Hymn in the catalog";
    }
}

/** How a row's tune matched the catalog, in a few words. */
export function describeTuneMatch(match: BookCsvMatch): string {
    switch (match.kind) {
        case "new":
            return "New tune";
        case "none":
            return "No tune";
        case "existing":
            return match.by === "alias" ? `Tune in the catalog, as "${match.name}"` : "Tune in the catalog";
    }
}

/** Whether a row's song (its hymn to its tune) is in the catalog already. */
export function describeSongMatch(song: BookCsvRow["song"]): string {
    return song === null ? "Not matched" : song === "new" ? "New song" : "Song in the catalog";
}
