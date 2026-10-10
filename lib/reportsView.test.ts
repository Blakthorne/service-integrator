import { describe, expect, test } from "vitest";
import type { HistoryCounts } from "./db/history";
import type { LabelledEntry } from "./domain";
import type { LastSungRow, MostSungRow, NeverSungRow, ReportSong } from "./reports";
import {
    ANYWHERE,
    DEFAULT_PERIOD,
    IN_PLANNING_CENTER,
    DEFAULT_REPORT,
    PERIOD_OPTIONS,
    REPORTS,
    REPORTS_PAGE_SIZE,
    REPORT_DESCRIPTIONS,
    REPORT_LABELS,
    describeHistory,
    describeReport,
    describeRowUse,
    lastSungRows,
    mostSungRows,
    neverSungRows,
    neverSungScope,
    neverSungScopeName,
    neverSungScopeOptions,
    notSinceDate,
    pageReportRows,
    parseReportsQuery,
    reportCsv,
    reportCsvFilename,
    reportCsvRecords,
    selectReportRows,
    toReportData,
    toReportSongView,
    type ReportBookOption,
    type ReportData,
    type ReportRow,
} from "./reportsView";

const TODAY = "2026-10-04";

function entry(label: string, variantNote: string | null = null): LabelledEntry {
    return {
        id: 1,
        bookId: 1,
        songId: 1,
        number: null,
        position: null,
        locationLabel: null,
        variantNote,
        // "G-12" is in book G; every other label is in book R.
        bookCode: label.startsWith("G-") ? "G" : "R",
        label,
    };
}

function song(
    id: number,
    title: string,
    tuneName: string | null,
    labels: string[] = [],
    pcoSongId: string | null = String(5000 + id)
): ReportSong {
    return { id, title, tuneName, pcoSongId, entries: labels.map((label) => entry(label)) };
}

const amazingGrace = song(1, "Amazing Grace", "NEW BRITAIN", ["R-396", "G-317"]);
const blessedAssurance = song(2, "Blessed Assurance", "ASSURANCE", ["R-12"]);
const holyHoly = song(3, "Holy, Holy, Holy", null);
const neverSung = song(4, "Never Sung", "TUNE", ["R-40"]);
const comeThouFount = song(5, "Come, Thou Fount", "NETTLETON", ["G-12", "G-13"], null);

function mostSung(
    pcoSongId: string,
    catalog: ReportSong | null,
    title: string,
    times: number,
    lastSungOn: string
): MostSungRow {
    return { pcoSongId, song: catalog, title, times, lastSungOn };
}

const lastSung: LastSungRow[] = [
    { song: amazingGrace, times: 14, lastSungOn: "2026-09-27", nextScheduledOn: "2026-10-11" },
    { song: blessedAssurance, times: 2, lastSungOn: "2025-03-02", nextScheduledOn: null },
    { song: holyHoly, times: 9, lastSungOn: "2024-12-22", nextScheduledOn: null },
    { song: neverSung, times: 0, lastSungOn: null, nextScheduledOn: null },
];

const reports = {
    today: TODAY,
    mostSung: {
        "last-12-months": [
            mostSung("5001", amazingGrace, "Amazing Grace", 11, "2026-09-27"),
            mostSung("9001", null, "10,000 Reasons", 6, "2026-09-20"),
        ],
        "this-year": [mostSung("5001", amazingGrace, "Amazing Grace", 9, "2026-09-27")],
        "all-time": [
            mostSung("5001", amazingGrace, "Amazing Grace", 14, "2026-09-27"),
            mostSung("5003", holyHoly, "Holy, Holy, Holy", 9, "2024-12-22"),
            mostSung("9001", null, "10,000 Reasons", 8, "2026-09-20"),
        ],
    },
    lastSung,
    neverSung: [
        {
            song: null,
            pcoSongId: "9002",
            title: "Build My Life",
            inPlanningCenter: true,
            nextScheduledOn: "2026-10-11",
        },
        {
            song: comeThouFount,
            pcoSongId: null,
            title: "Come, Thou Fount",
            inPlanningCenter: false,
            nextScheduledOn: null,
        },
        { song: neverSung, pcoSongId: "5004", title: "Never Sung", inPlanningCenter: true, nextScheduledOn: null },
    ] satisfies NeverSungRow[],
};

const data: ReportData = toReportData(reports, " / ");

const books: ReportBookOption[] = [
    { code: "R", name: "Rejoice Hymns", shortName: "Rejoice" },
    { code: "G", name: "Great Hymns", shortName: "Great" },
];

describe("parseReportsQuery", () => {
    const parse = (query: string) => parseReportsQuery(new URLSearchParams(query));

    test("falls back to the most sung of the last 12 months, with no date, on page 1", () => {
        expect(parse("")).toEqual({
            report: "most-sung",
            period: "last-12-months",
            notSince: null,
            scope: ANYWHERE,
            page: 1,
        });
        expect(DEFAULT_REPORT).toBe("most-sung");
        expect(DEFAULT_PERIOD).toBe("last-12-months");
    });

    test("reads each part of the URL", () => {
        expect(parse("report=not-sung&period=this-year&notSince=2025-10-04&page=3")).toEqual({
            report: "not-sung",
            period: "this-year",
            notSince: "2025-10-04",
            scope: ANYWHERE,
            page: 3,
        });
        expect(parse("report=last-sung").report).toBe("last-sung");
        expect(parse("period=all-time").period).toBe("all-time");
    });

    test("ignores a value it does not know or that is spelled another way", () => {
        expect(parse("report=Most-Sung").report).toBe("most-sung");
        expect(parse("report=top").report).toBe("most-sung");
        expect(parse("period=year").period).toBe("last-12-months");
        expect(parse("page=0").page).toBe(1);
        expect(parse("page=abc").page).toBe(1);
    });

    test("reads where never sung looks: Planning Center, a book's code, or anywhere", () => {
        expect(parse("report=never-sung").report).toBe("never-sung");
        expect(parse("in=planning-center").scope).toBe(IN_PLANNING_CENTER);
        expect(parse("in=R").scope).toBe("R");
        expect(parse("in=r").scope).toBe("r");
        expect(parse("in=").scope).toBe(ANYWHERE);
        expect(parse("in=Planning-Center").scope).toBe(ANYWHERE);
        expect(parse("in=1R").scope).toBe(ANYWHERE);
        expect(parse("in=R%20G").scope).toBe(ANYWHERE);
    });

    test("takes only a real date written YYYY-MM-DD", () => {
        for (const bad of ["2025-02-30", "2025-2-3", "10/4/25", "2025-10-04T08:00:00Z", "yesterday", ""]) {
            expect(parse(`notSince=${encodeURIComponent(bad)}`).notSince).toBeNull();
        }
    });
});

describe("the picker's words", () => {
    test("every report has a label and a description", () => {
        expect(REPORTS.map((report) => REPORT_LABELS[report])).toEqual([
            "Most sung",
            "Last sung",
            "Not sung since",
            "Never sung",
        ]);
        for (const report of REPORTS) {
            expect(REPORT_DESCRIPTIONS[report]).toMatch(/\.$/);
        }
    });

    test("the periods are the data's, with its labels", () => {
        expect(PERIOD_OPTIONS).toEqual([
            { value: "last-12-months", label: "Last 12 months" },
            { value: "this-year", label: "This year" },
            { value: "all-time", label: "All time" },
        ]);
    });
});

describe("notSinceDate", () => {
    test("is the date the URL has, or a year before today", () => {
        expect(notSinceDate("2026-01-01", TODAY)).toBe("2026-01-01");
        expect(notSinceDate(null, TODAY)).toBe("2025-10-04");
    });
});

describe("where never sung looks", () => {
    test("keeps anywhere and Planning Center, and spells a book's code as the books do", () => {
        expect(neverSungScope(ANYWHERE, books)).toBe(ANYWHERE);
        expect(neverSungScope(IN_PLANNING_CENTER, books)).toBe(IN_PLANNING_CENTER);
        expect(neverSungScope("G", books)).toBe("G");
        expect(neverSungScope("g", books)).toBe("G");
    });

    test("looks anywhere for a code that is not one of the books offered", () => {
        expect(neverSungScope("X", books)).toBe(ANYWHERE);
        expect(neverSungScope("R", [])).toBe(ANYWHERE);
    });

    test("names Planning Center or the book, and nothing for anywhere", () => {
        expect(neverSungScopeName(ANYWHERE, books)).toBeNull();
        expect(neverSungScopeName(IN_PLANNING_CENTER, books)).toBe("Planning Center");
        expect(neverSungScopeName("R", books)).toBe("Rejoice Hymns");
    });

    test("offers anywhere, Planning Center, then each book by its short name", () => {
        expect(neverSungScopeOptions(books)).toEqual([
            { value: ANYWHERE, label: "Anywhere", title: "Planning Center and every book" },
            { value: IN_PLANNING_CENTER, label: "Planning Center", title: "The songs in Planning Center" },
            { value: "R", label: "Rejoice", title: "Rejoice Hymns" },
            { value: "G", label: "Great", title: "Great Hymns" },
        ]);
    });
});

describe("toReportSongView", () => {
    test("keeps the title and tune and joins the numbers with the separator", () => {
        expect(toReportSongView(amazingGrace, " / ")).toEqual({
            id: 1,
            title: "Amazing Grace",
            tuneName: "NEW BRITAIN",
            numbers: "R-396 / G-317",
        });
        expect(toReportSongView(amazingGrace, ", ").numbers).toBe("R-396, G-317");
    });

    test("leaves a song in no book with no numbers", () => {
        expect(toReportSongView(holyHoly, " / ")).toMatchObject({ tuneName: null, numbers: "" });
    });

    test("prints the numbers as the schedule text does, leaving out a descant", () => {
        const withDescant: ReportSong = {
            ...amazingGrace,
            entries: [entry("R-396"), entry("R-397", "Descant - last stanza only")],
        };
        expect(toReportSongView(withDescant, " / ").numbers).toBe("R-396");
    });
});

describe("toReportData", () => {
    test("sends each song with only what a table shows, and the date the reports are as of", () => {
        expect(data.today).toBe(TODAY);
        expect(data.lastSung[0]).toEqual({
            song: { id: 1, title: "Amazing Grace", tuneName: "NEW BRITAIN", numbers: "R-396 / G-317" },
            times: 14,
            lastSungOn: "2026-09-27",
            nextScheduledOn: "2026-10-11",
        });
        expect(Object.keys(data.lastSung[0].song).sort()).toEqual(["id", "numbers", "title", "tuneName"]);
    });

    test("sends each never sung song with its numbers and the codes of its books, once each", () => {
        expect(data.neverSung).toEqual([
            {
                song: null,
                pcoSongId: "9002",
                title: "Build My Life",
                inPlanningCenter: true,
                nextScheduledOn: "2026-10-11",
                books: [],
            },
            {
                song: { id: 5, title: "Come, Thou Fount", tuneName: "NETTLETON", numbers: "G-12 / G-13" },
                pcoSongId: null,
                title: "Come, Thou Fount",
                inPlanningCenter: false,
                nextScheduledOn: null,
                books: ["G"],
            },
            {
                song: { id: 4, title: "Never Sung", tuneName: "TUNE", numbers: "R-40" },
                pcoSongId: "5004",
                title: "Never Sung",
                inPlanningCenter: true,
                nextScheduledOn: null,
                books: ["R"],
            },
        ]);
    });

    test("keeps a song sung that is in no catalog song, and its Planning Center title", () => {
        expect(data.mostSung["last-12-months"][1]).toEqual({
            pcoSongId: "9001",
            song: null,
            title: "10,000 Reasons",
            times: 6,
            lastSungOn: "2026-09-20",
        });
    });

    test("has every period, in the order of the data", () => {
        expect(Object.keys(data.mostSung)).toEqual(["last-12-months", "this-year", "all-time"]);
        expect(data.mostSung["all-time"].map(({ title }) => title)).toEqual([
            "Amazing Grace",
            "Holy, Holy, Holy",
            "10,000 Reasons",
        ]);
    });
});

describe("report rows", () => {
    test("most sung: a song of the catalog links to its page, one that is not has none", () => {
        const rows = mostSungRows(data.mostSung["last-12-months"]);
        expect(rows).toEqual([
            {
                key: "pco-5001",
                songId: 1,
                title: "Amazing Grace",
                tuneName: "NEW BRITAIN",
                numbers: "R-396 / G-317",
                times: 11,
                lastSungOn: "2026-09-27",
                nextScheduledOn: null,
                inPlanningCenter: null,
            },
            {
                key: "pco-9001",
                songId: null,
                title: "10,000 Reasons",
                tuneName: null,
                numbers: "",
                times: 6,
                lastSungOn: "2026-09-20",
                nextScheduledOn: null,
                inPlanningCenter: null,
            },
        ]);
    });

    test("last sung: every song links to its page and says when it is next scheduled", () => {
        const rows = lastSungRows(data.lastSung);
        expect(rows.map(({ key }) => key)).toEqual(["song-1", "song-2", "song-3", "song-4"]);
        expect(rows[0]).toMatchObject({ songId: 1, nextScheduledOn: "2026-10-11" });
        expect(rows[3]).toMatchObject({ songId: 4, times: 0, lastSungOn: null });
    });

    test("never sung: a song of the catalog links to its page, one that is not has none, and none was sung", () => {
        expect(neverSungRows(data.neverSung, ANYWHERE)).toEqual([
            {
                key: "pco-9002",
                songId: null,
                title: "Build My Life",
                tuneName: null,
                numbers: "",
                times: 0,
                lastSungOn: null,
                nextScheduledOn: "2026-10-11",
                inPlanningCenter: true,
            },
            {
                key: "song-5",
                songId: 5,
                title: "Come, Thou Fount",
                tuneName: "NETTLETON",
                numbers: "G-12 / G-13",
                times: 0,
                lastSungOn: null,
                nextScheduledOn: null,
                inPlanningCenter: false,
            },
            {
                key: "song-4",
                songId: 4,
                title: "Never Sung",
                tuneName: "TUNE",
                numbers: "R-40",
                times: 0,
                lastSungOn: null,
                nextScheduledOn: null,
                inPlanningCenter: true,
            },
        ]);
    });

    test("never sung: keeps the songs in Planning Center, or those in a book", () => {
        const keys = (scope: string) => neverSungRows(data.neverSung, scope).map(({ key }) => key);
        expect(keys(IN_PLANNING_CENTER)).toEqual(["pco-9002", "song-4"]);
        expect(keys("R")).toEqual(["song-4"]);
        expect(keys("G")).toEqual(["song-5"]);
        expect(keys("X")).toEqual([]);
    });

    test("every row of a report has its own key", () => {
        for (const rows of [
            ...Object.values(data.mostSung).map(mostSungRows),
            lastSungRows(data.lastSung),
            neverSungRows(data.neverSung, ANYWHERE),
        ]) {
            expect(new Set(rows.map(({ key }) => key)).size).toBe(rows.length);
        }
    });
});

describe("selectReportRows", () => {
    test("most sung: the period's rows, as the data has them", () => {
        expect(
            selectReportRows(data, { report: "most-sung", period: "this-year" }, "2025-10-04").map(
                ({ title }) => title
            )
        ).toEqual(["Amazing Grace"]);
        expect(
            selectReportRows(data, { report: "most-sung", period: "all-time" }, "2025-10-04")
        ).toHaveLength(3);
    });

    test("last sung: every linked song, whatever the period or the date", () => {
        expect(
            selectReportRows(data, { report: "last-sung", period: "this-year" }, "2020-01-01")
        ).toHaveLength(4);
    });

    test("not sung since: the songs last sung before the date, never sung first, then the longest unsung", () => {
        expect(
            selectReportRows(data, { report: "not-sung", period: "all-time" }, "2026-01-01").map(
                ({ title }) => title
            )
        ).toEqual(["Never Sung", "Holy, Holy, Holy", "Blessed Assurance"]);
    });

    test("not sung since: a song sung on the date counts as sung since", () => {
        const titles = (since: string) =>
            selectReportRows(data, { report: "not-sung", period: "all-time" }, since).map(({ title }) => title);
        expect(titles("2025-03-02")).toEqual(["Never Sung", "Holy, Holy, Holy"]);
        expect(titles("2025-03-03")).toEqual(["Never Sung", "Holy, Holy, Holy", "Blessed Assurance"]);
    });

    test("not sung since: leaves out a song sung since, and has none when every song was", () => {
        expect(
            selectReportRows(data, { report: "not-sung", period: "all-time" }, "2020-01-01").map(
                ({ title }) => title
            )
        ).toEqual(["Never Sung"]);
    });
});

describe("selectReportRows: never sung", () => {
    test("every song never sung, anywhere when no place is given, by title", () => {
        expect(
            selectReportRows(data, { report: "never-sung", period: "all-time" }, "2020-01-01").map(
                ({ title }) => title
            )
        ).toEqual(["Build My Life", "Come, Thou Fount", "Never Sung"]);
    });

    test("the songs never sung in the place asked for, whatever the period or the date", () => {
        expect(
            selectReportRows(
                data,
                { report: "never-sung", period: "this-year", scope: IN_PLANNING_CENTER },
                "2026-10-01"
            ).map(({ title }) => title)
        ).toEqual(["Build My Life", "Never Sung"]);
        expect(
            selectReportRows(data, { report: "never-sung", period: "all-time", scope: "G" }, "2020-01-01").map(
                ({ title }) => title
            )
        ).toEqual(["Come, Thou Fount"]);
    });
});

describe("pageReportRows", () => {
    const rows = (count: number): ReportRow[] =>
        Array.from({ length: count }, (_, index) => ({
            key: `song-${index}`,
            songId: index,
            title: `Song ${index}`,
            tuneName: null,
            numbers: "",
            times: 1,
            lastSungOn: null,
            nextScheduledOn: null,
            inPlanningCenter: null,
        }));

    test("gives the page asked for, with where it starts", () => {
        const page = pageReportRows(rows(120), 2);
        expect(page.rows).toHaveLength(REPORTS_PAGE_SIZE);
        expect(page.rows[0].key).toBe("song-50");
        expect(page).toMatchObject({ page: 2, totalPages: 3, total: 120, firstPlace: 51 });
        expect(pageReportRows(rows(120), 3).rows).toHaveLength(20);
    });

    test("clamps a page past the last, or below the first", () => {
        expect(pageReportRows(rows(120), 9)).toMatchObject({ page: 3, firstPlace: 101 });
        expect(pageReportRows(rows(120), 0)).toMatchObject({ page: 1, firstPlace: 1 });
        expect(pageReportRows(rows(120), -4)).toMatchObject({ page: 1 });
    });

    test("an empty report is page 1 of 1", () => {
        expect(pageReportRows([], 5)).toEqual({ rows: [], page: 1, totalPages: 1, total: 0, firstPlace: 1 });
    });

    test("takes the page size", () => {
        expect(pageReportRows(rows(5), 2, 2).rows.map(({ key }) => key)).toEqual(["song-2", "song-3"]);
    });
});

describe("describeReport", () => {
    const options = { period: "last-12-months", since: "2025-10-04" } as const;
    const all = lastSungRows(data.lastSung);

    test("most sung says how many songs were sung in the period", () => {
        const rows = mostSungRows(data.mostSung["last-12-months"]);
        expect(describeReport("most-sung", rows, options)).toBe("2 songs sung in the last 12 months");
        expect(describeReport("most-sung", rows, { ...options, period: "this-year" })).toBe(
            "2 songs sung so far this year"
        );
        expect(describeReport("most-sung", rows.slice(0, 1), { ...options, period: "all-time" })).toBe(
            "1 song sung in all the plans on record"
        );
        expect(describeReport("most-sung", [], options)).toBe("0 songs sung in the last 12 months");
    });

    test("last sung says how many songs are linked, and how many were never sung", () => {
        expect(describeReport("last-sung", all, options)).toBe(
            "4 songs linked to Planning Center, 1 never sung"
        );
        expect(describeReport("last-sung", all.slice(0, 2), options)).toBe(
            "2 songs linked to Planning Center"
        );
    });

    test("not sung since names the date, in the short form the tables use", () => {
        const rows = selectReportRows(data, { report: "not-sung", period: "all-time" }, "2026-01-01");
        expect(describeReport("not-sung", rows, { ...options, since: "2026-01-01" })).toBe(
            "3 songs not sung since 1/1/26, 1 of them never sung"
        );
        expect(describeReport("not-sung", rows.slice(1), { ...options, since: "2026-01-01" })).toBe(
            "2 songs not sung since 1/1/26"
        );
    });

    test("never sung says how many, where it looked, and how many of them are scheduled", () => {
        const rows = (scope: string) => neverSungRows(data.neverSung, scope);
        expect(describeReport("never-sung", rows(ANYWHERE), options)).toBe(
            "3 songs never sung, 1 of them scheduled"
        );
        expect(
            describeReport("never-sung", rows(IN_PLANNING_CENTER), { ...options, scopeName: "Planning Center" })
        ).toBe("2 songs in Planning Center never sung, 1 of them scheduled");
        expect(describeReport("never-sung", rows("G"), { ...options, scopeName: "Great Hymns" })).toBe(
            "1 song in Great Hymns never sung"
        );
        expect(describeReport("never-sung", [], options)).toBe("0 songs never sung");
    });

    test("counts in thousands with a comma", () => {
        const many = Array.from({ length: 1247 }, (_, index) => ({ ...all[0], key: `song-${index}` }));
        expect(describeReport("last-sung", many, options)).toBe("1,247 songs linked to Planning Center");
    });
});

describe("describeRowUse", () => {
    const row = (overrides: Partial<ReportRow>): ReportRow => ({
        key: "song-1",
        songId: 1,
        title: "Amazing Grace",
        tuneName: null,
        numbers: "",
        times: 14,
        lastSungOn: "2026-09-27",
        nextScheduledOn: null,
        inPlanningCenter: null,
        ...overrides,
    });

    test("most sung: how many times, and when last", () => {
        expect(describeRowUse("most-sung", row({ times: 11 }))).toBe("Sung 11 times, last 9/27/26");
        expect(describeRowUse("most-sung", row({ times: 1 }))).toBe("Sung 1 time, last 9/27/26");
    });

    test("last sung: when last, how many times and when next, each only when there is one", () => {
        expect(describeRowUse("last-sung", row({ nextScheduledOn: "2026-10-11" }))).toBe(
            "Last sung 9/27/26, 14 times, next 10/11/26"
        );
        expect(describeRowUse("last-sung", row({}))).toBe("Last sung 9/27/26, 14 times");
        expect(describeRowUse("last-sung", row({ lastSungOn: null, times: 0 }))).toBe("Never sung");
        expect(
            describeRowUse("last-sung", row({ lastSungOn: null, times: 0, nextScheduledOn: "2026-10-11" }))
        ).toBe("Never sung, next 10/11/26");
    });

    test("not sung since: when last, or that it never was", () => {
        expect(describeRowUse("not-sung", row({}))).toBe("Last sung 9/27/26");
        expect(describeRowUse("not-sung", row({ lastSungOn: null, times: 0 }))).toBe("Never sung");
    });

    test("never sung: that it never was, when it is next scheduled, or that it is not in Planning Center", () => {
        const never = { lastSungOn: null, times: 0 };
        expect(describeRowUse("never-sung", row({ ...never, inPlanningCenter: true }))).toBe("Never sung");
        expect(
            describeRowUse("never-sung", row({ ...never, inPlanningCenter: true, nextScheduledOn: "2026-10-11" }))
        ).toBe("Never sung, next 10/11/26");
        expect(describeRowUse("never-sung", row({ ...never, inPlanningCenter: false }))).toBe(
            "Never sung, not in Planning Center"
        );
    });
});

describe("describeHistory", () => {
    const counts = (overrides: Partial<HistoryCounts>): HistoryCounts => ({
        plans: 216,
        plansRead: 216,
        occurrences: 1386,
        firstPlanDate: "2023-09-03",
        lastPlanDate: "2026-12-27",
        ...overrides,
    });

    test("says how many plans and song items it holds, and the dates they span", () => {
        expect(describeHistory(counts({}))).toBe("216 plans, with 1,386 song items, from 9/3/23 to 12/27/26");
        expect(describeHistory(counts({ plans: 1, occurrences: 1 }))).toBe(
            "1 plan, with 1 song item, from 9/3/23 to 12/27/26"
        );
    });

    test("says it is empty before the first sync", () => {
        expect(
            describeHistory(counts({ plans: 0, plansRead: 0, occurrences: 0, firstPlanDate: null, lastPlanDate: null }))
        ).toBe("Nothing yet: no plan has been read.");
    });

    test("leaves out the dates when it has none", () => {
        expect(describeHistory(counts({ firstPlanDate: null, lastPlanDate: null }))).toBe(
            "216 plans, with 1,386 song items"
        );
    });
});

describe("CSV", () => {
    const rows = {
        "most-sung": mostSungRows(data.mostSung["last-12-months"]),
        "last-sung": lastSungRows(data.lastSung),
        "not-sung": lastSungRows(data.lastSung.slice(2)),
        "never-sung": neverSungRows(data.neverSung, ANYWHERE),
    } as const;

    test("never sung: whether the song is in Planning Center and in the catalog, and its next date", () => {
        expect(reportCsvRecords("never-sung", rows["never-sung"])).toEqual([
            ["Title", "Tune", "Numbers", "In Planning Center", "In catalog", "Next scheduled"],
            ["Build My Life", "", "", "yes", "no", "2026-10-11"],
            ["Come, Thou Fount", "NETTLETON", "G-12 / G-13", "no", "yes", ""],
            ["Never Sung", "TUNE", "R-40", "yes", "yes", ""],
        ]);
    });

    test("most sung: the title, tune, numbers, times, last date and whether the song is in the catalog", () => {
        expect(reportCsvRecords("most-sung", rows["most-sung"])).toEqual([
            ["Title", "Tune", "Numbers", "Times sung", "Last sung", "In catalog"],
            ["Amazing Grace", "NEW BRITAIN", "R-396 / G-317", "11", "2026-09-27", "yes"],
            ["10,000 Reasons", "", "", "6", "2026-09-20", "no"],
        ]);
    });

    test("last sung: the last date, the times and the next date, blank when there is none", () => {
        expect(reportCsvRecords("last-sung", rows["last-sung"])).toEqual([
            ["Title", "Tune", "Numbers", "Last sung", "Times sung", "Next scheduled"],
            ["Amazing Grace", "NEW BRITAIN", "R-396 / G-317", "2026-09-27", "14", "2026-10-11"],
            ["Blessed Assurance", "ASSURANCE", "R-12", "2025-03-02", "2", ""],
            ["Holy, Holy, Holy", "", "", "2024-12-22", "9", ""],
            ["Never Sung", "TUNE", "R-40", "", "0", ""],
        ]);
    });

    test("not sung since: the last date, blank for a song never sung", () => {
        expect(reportCsvRecords("not-sung", rows["not-sung"])).toEqual([
            ["Title", "Tune", "Numbers", "Last sung"],
            ["Holy, Holy, Holy", "", "", "2024-12-22"],
            ["Never Sung", "TUNE", "R-40", ""],
        ]);
    });

    test("a report with no rows is its header alone", () => {
        for (const report of REPORTS) {
            expect(reportCsvRecords(report, [])).toHaveLength(1);
        }
    });

    test("is CSV text a spreadsheet opens: a comma in a title is quoted, and every record ends with CRLF", () => {
        const text = reportCsv("not-sung", rows["not-sung"]);
        expect(text).toBe(
            'Title,Tune,Numbers,Last sung\r\n"Holy, Holy, Holy",,,2024-12-22\r\nNever Sung,TUNE,R-40,\r\n'
        );
    });

    test("a title that would start a formula is neutralized", () => {
        const [row] = rows["not-sung"];
        expect(reportCsv("not-sung", [{ ...row, title: "=SUM(A1)" }])).toContain("'=SUM(A1)");
    });

    describe("file names", () => {
        // Noon by the clock of the machine the tests run on, so the day is the same in every time zone.
        const now = new Date(2026, 9, 4, 12, 0, 0);

        test("name the report, its period or date, and the day it was saved", () => {
            expect(reportCsvFilename("most-sung", { period: "last-12-months", since: "2025-10-04" }, now)).toBe(
                "most-sung-last-12-months-2026-10-04.csv"
            );
            expect(reportCsvFilename("most-sung", { period: "this-year", since: "2025-10-04" }, now)).toBe(
                "most-sung-this-year-2026-10-04.csv"
            );
            expect(reportCsvFilename("last-sung", { period: "all-time", since: "2025-10-04" }, now)).toBe(
                "last-sung-2026-10-04.csv"
            );
            expect(reportCsvFilename("not-sung", { period: "all-time", since: "2025-06-30" }, now)).toBe(
                "not-sung-since-2025-06-30.csv"
            );
        });

        test("name where never sung looked, when it was not anywhere", () => {
            const options = { period: "all-time", since: "2025-10-04" } as const;
            expect(reportCsvFilename("never-sung", options, now)).toBe("never-sung-2026-10-04.csv");
            expect(reportCsvFilename("never-sung", { ...options, scope: ANYWHERE }, now)).toBe(
                "never-sung-2026-10-04.csv"
            );
            expect(reportCsvFilename("never-sung", { ...options, scope: IN_PLANNING_CENTER }, now)).toBe(
                "never-sung-planning-center-2026-10-04.csv"
            );
            expect(reportCsvFilename("never-sung", { ...options, scope: "R" }, now)).toBe(
                "never-sung-R-2026-10-04.csv"
            );
        });
    });
});
