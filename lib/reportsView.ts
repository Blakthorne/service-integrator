import { countOf, formatCount } from "./catalog/counts";
import { parseBookCode } from "./catalog/ids";
import { localDateStamp } from "./catalog/songsCsv";
import { toCsv } from "./csv";
import type { HistoryCounts } from "./db/history";
import { formatShortDate } from "./format";
import {
    MOST_SUNG_PERIODS,
    MOST_SUNG_PERIOD_LABELS,
    defaultNotSince,
    notSungSince,
    parseReportDate,
    type LastSungRow,
    type MostSungPeriod,
    type MostSungRow,
    type NeverSungRow,
    type ReportSong,
    type SongUse,
} from "./reports";
import { formatScheduleNumbers } from "./serviceSchedule";
import { parseEnum, parsePage } from "./urlState";

/**
 * The Reports page (`/reports`) as the browser shows it: which report, its
 * period, date, place and page from the URL, the rows the page sends (`toReportData`,
 * with the little of each song a table shows), the rows of each report, a page
 * of them, their words and their CSV. The reports themselves are built by
 * lib/reports.ts from the plan history; the page sends them all once and the
 * view narrows them in the browser, as the songs list does, so a date typed
 * into "not sung since" answers at once. Pure and safe on both sides.
 */

/** The reports the page offers, in the order its picker lists them. */
export const REPORTS = ["most-sung", "last-sung", "not-sung", "never-sung"] as const;

export type ReportKind = (typeof REPORTS)[number];

/** What each report is called in the picker. */
export const REPORT_LABELS: Readonly<Record<ReportKind, string>> = {
    "most-sung": "Most sung",
    "last-sung": "Last sung",
    "not-sung": "Not sung since",
    "never-sung": "Never sung",
};

/** What each report is, in a sentence, for the picker's tooltips and the page's description. */
export const REPORT_DESCRIPTIONS: Readonly<Record<ReportKind, string>> = {
    "most-sung": "The songs sung in the most plans of a period, most sung first.",
    "last-sung": "Every catalog song linked to Planning Center, with when it was last sung.",
    "not-sung": "The songs not sung since a date, and those never sung, the longest unsung first.",
    "never-sung":
        "Every song in Planning Center or in a book that was never in a past plan, by title. A catalog song not linked to Planning Center counts as never sung.",
};

/** The report shown when the URL names none. */
export const DEFAULT_REPORT: ReportKind = "most-sung";

/** The period "most sung" is counted over when the URL names none. */
export const DEFAULT_PERIOD: MostSungPeriod = "last-12-months";

/** Where "never sung" looks when the URL names nowhere: Planning Center and every book. Never a book code, which starts with a letter. */
export const ANYWHERE = "";

/** Where "never sung" looks for the songs in Planning Center: longer than a book code can be, so never one. */
export const IN_PLANNING_CENTER = "planning-center";

/** Rows per page of a report. */
export const REPORTS_PAGE_SIZE = 50;

/** What `useSearchParams()` and `URLSearchParams` both offer. */
interface QueryParams {
    get(name: string): string | null;
}

/** The Reports page's view, read from the URL by `parseReportsQuery`. */
export interface ReportsQuery {
    report: ReportKind;
    /** The period "most sung" counts over. */
    period: MostSungPeriod;
    /**
     * The date "not sung since" is as of, `YYYY-MM-DD`, as the URL has it;
     * null when it has none or a bad one (the report then uses a year ago,
     * `notSinceDate`).
     */
    notSince: string | null;
    /**
     * Where "never sung" looks, as the URL has it: `ANYWHERE`,
     * `IN_PLANNING_CENTER`, or a book's code, which `neverSungScope` checks
     * against the books offered.
     */
    scope: string;
    /** The page asked for, at least 1; `pageReportRows` clamps it to the last page. */
    page: number;
}

/**
 * Read the page's view from the query string: the report (`?report=`,
 * "most-sung" by default), the period (`?period=`, the last 12 months by
 * default), the "not sung since" date (`?notSince=`, which must be a real date
 * written `YYYY-MM-DD`), where "never sung" looks (`?in=`: `planning-center`
 * or a book code, anywhere by default) and the page (`?page=`). A missing or
 * unknown value falls back, and each must be spelled exactly.
 */
export function parseReportsQuery(params: QueryParams): ReportsQuery {
    const scope = params.get("in");
    return {
        report: parseEnum(params.get("report"), REPORTS, DEFAULT_REPORT),
        period: parseEnum(params.get("period"), MOST_SUNG_PERIODS, DEFAULT_PERIOD),
        notSince: parseReportDate(params.get("notSince")),
        scope: scope === IN_PLANNING_CENTER ? scope : (parseBookCode(scope) ?? ANYWHERE),
        page: parsePage(params.get("page")),
    };
}

/** What the "never sung" filter needs of a book: its code, its name and the short name its button shows. */
export interface ReportBookOption {
    code: string;
    name: string;
    shortName: string;
}

/**
 * Where "never sung" looks: `scope` as `parseReportsQuery` read it, with a
 * book's code spelled as `books` has it (a code is matched without regard
 * to case), or `ANYWHERE` for a code that is not one of `books`.
 */
export function neverSungScope(scope: string, books: readonly ReportBookOption[]): string {
    if (scope === ANYWHERE || scope === IN_PLANNING_CENTER) {
        return scope;
    }
    const wanted = scope.toLowerCase();
    return books.find(({ code }) => code.toLowerCase() === wanted)?.code ?? ANYWHERE;
}

/** What a `neverSungScope` is called: "Planning Center", a book's name, or null for anywhere. */
export function neverSungScopeName(scope: string, books: readonly ReportBookOption[]): string | null {
    if (scope === IN_PLANNING_CENTER) {
        return "Planning Center";
    }
    return books.find(({ code }) => code === scope)?.name ?? null;
}

/** The "never sung" filter's buttons: anywhere, Planning Center, then each of `books` by its short name. */
export function neverSungScopeOptions(
    books: readonly ReportBookOption[]
): { value: string; label: string; title?: string }[] {
    return [
        { value: ANYWHERE, label: "Anywhere", title: "Planning Center and every book" },
        { value: IN_PLANNING_CENTER, label: "Planning Center", title: "The songs in Planning Center" },
        ...books.map(({ code, name, shortName }) => ({ value: code, label: shortName, title: name })),
    ];
}

/**
 * The date "not sung since" is as of: the one the URL has, or a year before
 * `today` (`defaultNotSince`) when it has none.
 */
export function notSinceDate(notSince: string | null, today: string): string {
    return notSince ?? defaultNotSince(today);
}

/** What a report shows of a catalog song, so the page sends the browser no more than its tables show. */
export interface ReportSongView {
    id: number;
    title: string;
    tuneName: string | null;
    /** Its numbers as the schedule text prints them ("R-396 / G-317"); "" when it is in no book. */
    numbers: string;
}

/** A catalog song as a report shows it, its numbers joined with `numberSeparator` (a setting). */
export function toReportSongView(song: ReportSong, numberSeparator: string): ReportSongView {
    return {
        id: song.id,
        title: song.title,
        tuneName: song.tuneName,
        numbers: formatScheduleNumbers(song.entries, numberSeparator),
    };
}

/** A row of "most sung" as the page sends it: `MostSungRow` with a catalog song reduced to what a table shows. */
export interface MostSungView extends Omit<MostSungRow, "song"> {
    song: ReportSongView | null;
}

/** A row of "last sung" as the page sends it: `LastSungRow` with its song reduced to what a table shows. */
export interface LastSungView extends SongUse {
    song: ReportSongView;
}

/** A row of "never sung" as the page sends it: `NeverSungRow` with its song reduced to what a table shows. */
export interface NeverSungView extends Omit<NeverSungRow, "song"> {
    song: ReportSongView | null;
    /** The codes of the books it is in, for the filter; empty for a song in no book. */
    books: string[];
}

/** What the Reports page sends the browser: the date the reports are as of, and the rows of "most sung", "last sung" and "never sung". */
export interface ReportData {
    /** The date the reports are as of, `YYYY-MM-DD` (the server's): a plan before it is past. */
    today: string;
    /** The songs sung in each period, most sung first. */
    mostSung: Record<MostSungPeriod, MostSungView[]>;
    /** Every catalog song linked to Planning Center, by title, with its use. "Not sung since" is worked out from these. */
    lastSung: LastSungView[];
    /** Every song in Planning Center or in a book never in a past plan, by title. */
    neverSung: NeverSungView[];
}

/**
 * The page's data from `getReports` (lib/queries/reports.ts), with each
 * catalog song's numbers worked out and nothing else of it kept.
 * `numberSeparator` is the setting that joins a song's numbers.
 */
export function toReportData(
    reports: {
        today: string;
        mostSung: Record<MostSungPeriod, readonly MostSungRow[]>;
        lastSung: readonly LastSungRow[];
        neverSung: readonly NeverSungRow[];
    },
    numberSeparator: string
): ReportData {
    return {
        today: reports.today,
        mostSung: Object.fromEntries(
            MOST_SUNG_PERIODS.map((period) => [
                period,
                reports.mostSung[period].map(
                    (row): MostSungView => ({
                        ...row,
                        song: row.song === null ? null : toReportSongView(row.song, numberSeparator),
                    })
                ),
            ])
        ) as Record<MostSungPeriod, MostSungView[]>,
        lastSung: reports.lastSung.map(
            ({ song, times, lastSungOn, nextScheduledOn }): LastSungView => ({
                song: toReportSongView(song, numberSeparator),
                times,
                lastSungOn,
                nextScheduledOn,
            })
        ),
        neverSung: reports.neverSung.map(
            (row): NeverSungView => ({
                ...row,
                song: row.song === null ? null : toReportSongView(row.song, numberSeparator),
                books: [...new Set((row.song?.entries ?? []).map(({ bookCode }) => bookCode))],
            })
        ),
    };
}

/** A row of a report's table, whichever report it is. */
export interface ReportRow {
    /** Unique within the report, for React. */
    key: string;
    /** The catalog song the row links to; null for a Planning Center song that is in no catalog song. */
    songId: number | null;
    title: string;
    /** The catalog song's tune; null when it is unknown, or there is no catalog song. */
    tuneName: string | null;
    /** Its numbers ("R-396 / G-317"); "" when it has none. */
    numbers: string;
    /** In how many past plans it was sung (of the report's period, for "most sung"). */
    times: number;
    /** The date of the last past plan it was sung in, `YYYY-MM-DD`; null when it never was. */
    lastSungOn: string | null;
    /** The date of the first upcoming plan it is in; null when it is in none, and for "most sung", which does not look. */
    nextScheduledOn: string | null;
    /** Whether it is in Planning Center, for "never sung"; null for the reports that do not say. */
    inPlanningCenter: boolean | null;
}

/** The rows of "most sung", in the order given. */
export function mostSungRows(views: readonly MostSungView[]): ReportRow[] {
    return views.map(
        ({ pcoSongId, song, title, times, lastSungOn }): ReportRow => ({
            key: `pco-${pcoSongId}`,
            songId: song?.id ?? null,
            title,
            tuneName: song?.tuneName ?? null,
            numbers: song?.numbers ?? "",
            times,
            lastSungOn,
            nextScheduledOn: null,
            inPlanningCenter: null,
        })
    );
}

/** The rows of "last sung" and "not sung since", in the order given. */
export function lastSungRows(views: readonly LastSungView[]): ReportRow[] {
    return views.map(
        ({ song, times, lastSungOn, nextScheduledOn }): ReportRow => ({
            key: `song-${song.id}`,
            songId: song.id,
            title: song.title,
            tuneName: song.tuneName,
            numbers: song.numbers,
            times,
            lastSungOn,
            nextScheduledOn,
            inPlanningCenter: null,
        })
    );
}

/**
 * The rows of "never sung" that are in `scope`, in the order given: all of
 * them (`ANYWHERE`), the songs in Planning Center (`IN_PLANNING_CENTER`), or
 * the songs with an entry in the book with that code.
 */
export function neverSungRows(views: readonly NeverSungView[], scope: string): ReportRow[] {
    return views
        .filter((view) =>
            scope === ANYWHERE
                ? true
                : scope === IN_PLANNING_CENTER
                  ? view.inPlanningCenter
                  : view.books.includes(scope)
        )
        .map(
            ({ song, pcoSongId, title, inPlanningCenter, nextScheduledOn }): ReportRow => ({
                key: song === null ? `pco-${pcoSongId}` : `song-${song.id}`,
                songId: song?.id ?? null,
                title,
                tuneName: song?.tuneName ?? null,
                numbers: song?.numbers ?? "",
                times: 0,
                lastSungOn: null,
                nextScheduledOn,
                inPlanningCenter,
            })
        );
}

/**
 * Every row of the report the view asks for, not paged: the songs sung in
 * `period` (most sung first), every linked song (by title), the linked
 * songs not sung since `since` (never sung first, then the longest unsung),
 * or the songs never sung in `scope` (a `neverSungScope`, by title).
 */
export function selectReportRows(
    data: ReportData,
    {
        report,
        period,
        scope = ANYWHERE,
    }: Pick<ReportsQuery, "report" | "period"> & { scope?: string },
    since: string
): ReportRow[] {
    switch (report) {
        case "most-sung":
            return mostSungRows(data.mostSung[period]);
        case "last-sung":
            return lastSungRows(data.lastSung);
        case "not-sung":
            return lastSungRows(notSungSince(data.lastSung, since));
        case "never-sung":
            return neverSungRows(data.neverSung, scope);
    }
}

/** One page of a report. */
export interface ReportPage {
    /** The rows on this page. */
    rows: ReportRow[];
    /** The page shown: the one asked for, clamped to the last. */
    page: number;
    /** How many pages there are, at least 1. */
    totalPages: number;
    /** How many rows there are on every page together. */
    total: number;
    /** The place in the report of this page's first row, from 1: the rank "most sung" numbers its rows with. */
    firstPlace: number;
}

/** The `page`th page of `pageSize` rows, clamped to the last page (an empty report is page 1 of 1). */
export function pageReportRows(
    rows: readonly ReportRow[],
    page: number,
    pageSize: number = REPORTS_PAGE_SIZE
): ReportPage {
    const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
    const shown = Math.min(Math.max(1, Math.floor(page)), totalPages);
    return {
        rows: rows.slice((shown - 1) * pageSize, shown * pageSize),
        page: shown,
        totalPages,
        total: rows.length,
        firstPlace: (shown - 1) * pageSize + 1,
    };
}

/** What each period reads as at the end of a sentence about the songs sung in it. */
const PERIOD_PHRASES: Readonly<Record<MostSungPeriod, string>> = {
    "last-12-months": "in the last 12 months",
    "this-year": "so far this year",
    "all-time": "in all the plans on record",
};

/** How many of `rows` were never sung. */
function neverSungCount(rows: readonly ReportRow[]): number {
    return rows.filter(({ lastSungOn }) => lastSungOn === null).length;
}

/**
 * The line above a report's table, which says what the rows are and how many:
 * "120 songs sung in the last 12 months", "921 songs linked to Planning
 * Center, 312 never sung", "47 songs not sung since 10/4/25, 12 of them
 * never sung", "412 songs never sung, 3 of them scheduled", "380 songs in
 * Rejoice Hymns never sung". `rows` are all the report's rows, not a page of
 * them; `since` is the date "not sung since" is as of, and `scopeName` what
 * "never sung" looks in (`neverSungScopeName`; null for anywhere).
 */
export function describeReport(
    report: ReportKind,
    rows: readonly ReportRow[],
    {
        period,
        since,
        scopeName = null,
    }: { period: MostSungPeriod; since: string; scopeName?: string | null }
): string {
    const songs = countOf(rows.length, "song");
    const never = neverSungCount(rows);
    switch (report) {
        case "most-sung":
            return `${songs} sung ${PERIOD_PHRASES[period]}`;
        case "last-sung":
            return never === 0
                ? `${songs} linked to Planning Center`
                : `${songs} linked to Planning Center, ${formatCount(never)} never sung`;
        case "not-sung": {
            const text = `${songs} not sung since ${formatShortDate(since)}`;
            return never === 0 ? text : `${text}, ${formatCount(never)} of them never sung`;
        }
        case "never-sung": {
            const text = scopeName === null ? `${songs} never sung` : `${songs} in ${scopeName} never sung`;
            const scheduled = rows.filter(({ nextScheduledOn }) => nextScheduledOn !== null).length;
            return scheduled === 0 ? text : `${text}, ${formatCount(scheduled)} of them scheduled`;
        }
    }
}

/** "1 time", "14 times". */
function timesText(times: number): string {
    return countOf(times, "time");
}

/**
 * What a row says of its use on a phone, where the table's columns for it
 * are folded under the title: "Sung 11 times, last 9/27/26", "Last sung
 * 9/27/26, 14 times, next 10/11/26", "Never sung".
 */
export function describeRowUse(report: ReportKind, row: ReportRow): string {
    const last = row.lastSungOn === null ? null : formatShortDate(row.lastSungOn);
    switch (report) {
        case "most-sung":
            return last === null
                ? `Sung ${timesText(row.times)}`
                : `Sung ${timesText(row.times)}, last ${last}`;
        case "last-sung": {
            if (last === null && row.nextScheduledOn === null) {
                return "Never sung";
            }
            const parts = [
                last === null ? "Never sung" : `Last sung ${last}`,
                ...(row.times > 0 ? [timesText(row.times)] : []),
                ...(row.nextScheduledOn === null ? [] : [`next ${formatShortDate(row.nextScheduledOn)}`]),
            ];
            return parts.join(", ");
        }
        case "not-sung":
            return last === null ? "Never sung" : `Last sung ${last}`;
        case "never-sung":
            if (row.inPlanningCenter === false) {
                return "Never sung, not in Planning Center";
            }
            return row.nextScheduledOn === null
                ? "Never sung"
                : `Never sung, next ${formatShortDate(row.nextScheduledOn)}`;
    }
}

/** What the page says of what the history holds: how many plans and song items, and the dates they span. */
export function describeHistory(counts: HistoryCounts): string {
    if (counts.plans === 0) {
        return "Nothing yet: no plan has been read.";
    }
    const held = `${countOf(counts.plans, "plan")}, with ${countOf(counts.occurrences, "song item")}`;
    return counts.firstPlanDate !== null && counts.lastPlanDate !== null
        ? `${held}, from ${formatShortDate(counts.firstPlanDate)} to ${formatShortDate(counts.lastPlanDate)}`
        : held;
}

/** A song's tune, "" when it is unknown, for a CSV field. */
function tuneField({ tuneName }: ReportRow): string {
    return tuneName ?? "";
}

/**
 * The records of a report's CSV export: a header and a record for each row,
 * in the order given. The columns are the title, the tune ("" when it is
 * unknown), the numbers, and then each report's own: how many times it was
 * sung and when it was last ("most sung", with whether the song is in the
 * catalog); when it was last sung, how many times and when it is next
 * scheduled ("last sung"); when it was last sung ("not sung since");
 * whether it is in Planning Center and in the catalog, and when it is next
 * scheduled ("never sung"). Dates are `YYYY-MM-DD` and "" when there is none.
 */
export function reportCsvRecords(report: ReportKind, rows: readonly ReportRow[]): string[][] {
    switch (report) {
        case "most-sung":
            return [
                ["Title", "Tune", "Numbers", "Times sung", "Last sung", "In catalog"],
                ...rows.map((row) => [
                    row.title,
                    tuneField(row),
                    row.numbers,
                    String(row.times),
                    row.lastSungOn ?? "",
                    row.songId === null ? "no" : "yes",
                ]),
            ];
        case "last-sung":
            return [
                ["Title", "Tune", "Numbers", "Last sung", "Times sung", "Next scheduled"],
                ...rows.map((row) => [
                    row.title,
                    tuneField(row),
                    row.numbers,
                    row.lastSungOn ?? "",
                    String(row.times),
                    row.nextScheduledOn ?? "",
                ]),
            ];
        case "not-sung":
            return [
                ["Title", "Tune", "Numbers", "Last sung"],
                ...rows.map((row) => [row.title, tuneField(row), row.numbers, row.lastSungOn ?? ""]),
            ];
        case "never-sung":
            return [
                ["Title", "Tune", "Numbers", "In Planning Center", "In catalog", "Next scheduled"],
                ...rows.map((row) => [
                    row.title,
                    tuneField(row),
                    row.numbers,
                    row.inPlanningCenter === false ? "no" : "yes",
                    row.songId === null ? "no" : "yes",
                    row.nextScheduledOn ?? "",
                ]),
            ];
    }
}

/** A report as CSV text (`reportCsvRecords`, written by `toCsv`). */
export function reportCsv(report: ReportKind, rows: readonly ReportRow[]): string {
    return toCsv(reportCsvRecords(report, rows));
}

/**
 * A report export's file name: `most-sung-last-12-months-2026-10-04.csv`
 * (the period, then the day it was saved, in the viewer's time zone),
 * `last-sung-2026-10-04.csv`, `not-sung-since-2025-10-04.csv` (the date
 * the report is as of), or `never-sung-2026-10-04.csv`, with where it
 * looked when that is not anywhere (`never-sung-planning-center-2026-10-04.csv`,
 * `never-sung-R-2026-10-04.csv`).
 */
export function reportCsvFilename(
    report: ReportKind,
    { period, since, scope = ANYWHERE }: { period: MostSungPeriod; since: string; scope?: string },
    now: Date
): string {
    switch (report) {
        case "most-sung":
            return `most-sung-${period}-${localDateStamp(now)}.csv`;
        case "last-sung":
            return `last-sung-${localDateStamp(now)}.csv`;
        case "not-sung":
            return `not-sung-since-${since}.csv`;
        case "never-sung":
            return scope === ANYWHERE
                ? `never-sung-${localDateStamp(now)}.csv`
                : `never-sung-${scope}-${localDateStamp(now)}.csv`;
    }
}

/** What the period picker's buttons say: the periods, with their labels. */
export const PERIOD_OPTIONS: readonly { value: MostSungPeriod; label: string }[] = MOST_SUNG_PERIODS.map(
    (value) => ({ value, label: MOST_SUNG_PERIOD_LABELS[value] })
);
