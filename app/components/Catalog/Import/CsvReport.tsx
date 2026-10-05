import type { BookCsvIssue, BookCsvReport, BookCsvRow } from "@/lib/domain";
import { countOf } from "@/lib/catalog/counts";
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
} from "@/lib/catalog/csvReport";
import { Pill, ReportTable, Section, Stat, type Column } from "./ReportParts";

interface CsvReportProps {
    report: BookCsvReport;
    /** The file's name, such as "chorus.csv". */
    sourceName: string;
}

/** A muted dash for a value a row does not have. */
const NONE = <span className="text-gray-400 dark:text-gray-500">&mdash;</span>;

/** A line of detail under a cell's value. */
function Detail({ children }: { children: React.ReactNode }) {
    return <span className="block text-xs text-gray-500 dark:text-gray-400">{children}</span>;
}

/** What the file read and what applying it adds, with the rows counted by what happens to them. */
function Summary({ report, sourceName }: CsvReportProps) {
    const { book, input, planned } = report;
    const summary = summarizeCsvReport(report);
    return (
        <section
            aria-labelledby="csv-report-summary"
            className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4 sm:p-6"
        >
            <h2
                id="csv-report-summary"
                className="text-base font-semibold text-gray-900 dark:text-gray-100"
            >
                What it reads and adds
            </h2>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                Reads {countOf(input.rows, "row")} from {sourceName} for {book.name}, a book that{" "}
                {book.numbered ? "numbers its songs" : "has no numbers"}.
                {input.blankRows > 0 &&
                    ` ${countOf(input.blankRows, "blank row")} ${input.blankRows === 1 ? "is" : "are"} left out.`}
            </p>
            <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-5">
                <Stat label="Entries" value={planned.entries} note={`added to ${book.name}`} />
                <Stat
                    label="Songs"
                    value={planned.songs}
                    note={`new, ${planned.songsWithoutTune} without a tune`}
                />
                <Stat label="Hymns" value={planned.hymns} note="new" />
                <Stat label="Tunes" value={planned.tunes} note="new" />
                <Stat
                    label="Rows"
                    value={summary.rows}
                    note={`${summary.adding} add · ${summary.skipped} left out · ${summary.blocked} blocked`}
                />
            </dl>
        </section>
    );
}

/** The columns of a table of problems or warnings: where, what kind, and what. */
function issueColumns<R extends string>(labels: Record<R, string>): Column<BookCsvIssue<R>>[] {
    return [
        { header: "Line", cell: (issue) => issueLine(issue) },
        { header: "Kind", cell: (issue) => labels[issue.reason] },
        { header: "What", cell: (issue) => issue.message },
    ];
}

const PROBLEM_COLUMNS = issueColumns(PROBLEM_LABELS);
const WARNING_COLUMNS = issueColumns(WARNING_LABELS);

interface IssueListProps<R extends string> {
    caption: string;
    issues: BookCsvIssue<R>[];
    columns: Column<BookCsvIssue<R>>[];
    noun: "problem" | "warning";
    empty: string;
}

/** A table of problems or warnings, the first `CSV_ISSUES_SHOWN` of them, with how many more there are. */
function IssueList<R extends string>({ caption, issues, columns, noun, empty }: IssueListProps<R>) {
    const { shown, hidden } = limitList(issues, CSV_ISSUES_SHOWN);
    return (
        <>
            <ReportTable caption={caption} rows={shown} columns={columns} empty={empty} />
            {hidden > 0 && (
                <p className="text-sm text-gray-600 dark:text-gray-300">
                    {describeHiddenIssues(hidden, noun)} Fix these first, then preview the file
                    again.
                </p>
            )}
        </>
    );
}

/** The columns of the table of rows; `numbered` says how a row's place is worded. */
function rowColumns(numbered: boolean): Column<BookCsvRow>[] {
    return [
        { header: "Line", cell: (row) => row.line },
        { header: numbered ? "Entry" : "Position", cell: (row) => placeText(row, numbered) },
        {
            header: "Hymn",
            cell: (row) => (
                <>
                    {row.title}
                    <Detail>{describeHymnMatch(row.hymn)}</Detail>
                </>
            ),
        },
        {
            header: "Tune",
            cell: (row) => (
                <>
                    {row.tune ?? NONE}
                    <Detail>{describeTuneMatch(row.tuneMatch)}</Detail>
                </>
            ),
        },
        { header: "Variant", cell: (row) => row.variantNote ?? NONE },
        { header: "Song", cell: (row) => describeSongMatch(row.song) },
        {
            header: "Outcome",
            cell: (row) => (
                <Pill tone={row.outcome === "add" ? "green" : row.outcome === "skip" ? "gray" : "red"}>
                    {OUTCOME_LABELS[row.outcome]}
                </Pill>
            ),
        },
    ];
}

/**
 * The review of a book's CSV file: what it read and adds, then the problems
 * that block it, the warnings, and every row with what applying does with it,
 * section by section. A server component: nothing here is interactive beyond
 * the browser's own disclosure widgets.
 *
 * The lists stop at a limit (`CSV_ISSUES_SHOWN`, `CSV_ROWS_SHOWN`) and say how
 * many more there are: a 1 MB file can hold tens of thousands of rows, and
 * the page would be as long. The problems come first, and a file with any is
 * refused by Apply, so the first of them are the ones to fix.
 */
export default function CsvReport({ report, sourceName }: CsvReportProps) {
    const { problems, warnings, rows, book } = report;
    const { shown: shownRows } = limitList(rows, CSV_ROWS_SHOWN);
    return (
        <div className="space-y-6">
            <Summary report={report} sourceName={sourceName} />
            <Section
                title="Problems that block the import"
                count={problems.length}
                description="Each of these stops the import until the file is fixed. Fix them in the spreadsheet, save the file again and preview it again; this preview stays as it was."
            >
                <IssueList
                    caption="Problems that block the import"
                    issues={problems}
                    columns={PROBLEM_COLUMNS}
                    noun="problem"
                    empty="None: nothing blocks the import."
                />
            </Section>
            <Section
                title="Warnings"
                count={warnings.length}
                description="Worth a look, but they do not block the import."
            >
                <IssueList
                    caption="Warnings"
                    issues={warnings}
                    columns={WARNING_COLUMNS}
                    noun="warning"
                    empty="None: nothing in the file needs a second look."
                />
            </Section>
            <Section
                title="Rows"
                count={rows.length}
                description="Every row of the file that is not blank, in file order, with what applying the import does with it."
                open={rows.length <= CSV_ROWS_OPEN_MAX}
            >
                <ReportTable
                    caption="Rows of the file"
                    rows={shownRows}
                    columns={rowColumns(book.numbered)}
                    empty="None: the file has no rows."
                />
                {rows.length > shownRows.length && (
                    <p className="text-sm text-gray-600 dark:text-gray-300">
                        {describeShownRows(shownRows.length, rows.length)}
                    </p>
                )}
            </Section>
        </div>
    );
}
