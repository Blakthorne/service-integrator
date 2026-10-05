import { describe, expect, test } from "vitest";
import type { HistoryOccurrence } from "./db/history";
import type { LabelledEntry } from "./domain";
import {
    MOST_SUNG_PERIODS,
    MOST_SUNG_PERIOD_LABELS,
    buildLastSung,
    buildMostSung,
    buildSongHistory,
    defaultNotSince,
    isPastPlan,
    notSungSince,
    parseReportDate,
    periodStart,
    summarizeUse,
    type ReportSong,
} from "./reports";

const TODAY = "2026-10-04";
const MORNING = "1405391";
const EVENING = "1486055";

let nextItem = 0;

/** A song item of a plan: `planId` on `planDate` holding `pcoSongId`. */
function occurrence(
    planId: string,
    planDate: string,
    pcoSongId: string,
    serviceTypeId = MORNING
): HistoryOccurrence {
    nextItem += 1;
    return { planId, itemId: String(nextItem), pcoSongId, sequence: nextItem, planDate, serviceTypeId };
}

function entry(label: string, bookCode = "R"): LabelledEntry {
    return {
        id: 1,
        bookId: 1,
        songId: 1,
        number: null,
        position: null,
        locationLabel: null,
        variantNote: null,
        bookCode,
        label,
    };
}

function song(
    id: number,
    title: string,
    pcoSongId: string | null,
    tuneName: string | null = null,
    labels: string[] = []
): ReportSong {
    return { id, title, tuneName, pcoSongId, entries: labels.map((label) => entry(label)) };
}

describe("periods", () => {
    test("are the last 12 months, this year and all time", () => {
        expect(MOST_SUNG_PERIODS).toEqual(["last-12-months", "this-year", "all-time"]);
        expect(MOST_SUNG_PERIOD_LABELS).toEqual({
            "last-12-months": "Last 12 months",
            "this-year": "This year",
            "all-time": "All time",
        });
    });

    test("start a year back, on January 1, or never", () => {
        expect(periodStart("last-12-months", "2026-10-04")).toBe("2025-10-04");
        expect(periodStart("last-12-months", "2024-02-29")).toBe("2023-02-28");
        expect(periodStart("this-year", "2026-10-04")).toBe("2026-01-01");
        expect(periodStart("this-year", "2026-01-01")).toBe("2026-01-01");
        expect(periodStart("all-time", "2026-10-04")).toBeNull();
    });

    test("a plan is past before today, and a plan dated today is upcoming", () => {
        expect(isPastPlan("2026-10-03", TODAY)).toBe(true);
        expect(isPastPlan("2026-10-04", TODAY)).toBe(false);
        expect(isPastPlan("2026-10-05", TODAY)).toBe(false);
    });
});

describe("summarizeUse", () => {
    test("counts the past plans a song was in, its last date, and its next scheduled date", () => {
        const uses = summarizeUse(
            [
                occurrence("1", "2026-09-06", "5001"),
                occurrence("2", "2026-09-27", "5001"),
                occurrence("3", "2026-09-20", "5001"),
                occurrence("4", "2026-10-18", "5001"),
                occurrence("5", "2026-10-11", "5001"),
                occurrence("6", "2026-09-27", "5002"),
            ],
            TODAY
        );
        expect(uses.get("5001")).toEqual({ times: 3, lastSungOn: "2026-09-27", nextScheduledOn: "2026-10-11" });
        expect(uses.get("5002")).toEqual({ times: 1, lastSungOn: "2026-09-27", nextScheduledOn: null });
        expect(uses.size).toBe(2);
    });

    test("counts a song twice in one plan once, and one in a morning and an evening plan of a day twice", () => {
        const uses = summarizeUse(
            [
                occurrence("1", "2026-09-27", "5001", MORNING),
                occurrence("1", "2026-09-27", "5001", MORNING),
                occurrence("2", "2026-09-27", "5001", EVENING),
            ],
            TODAY
        );
        expect(uses.get("5001")?.times).toBe(2);
    });

    test("calls a song in today's plan scheduled, not sung, and one only in upcoming plans never sung", () => {
        const uses = summarizeUse(
            [occurrence("1", "2026-10-04", "5001"), occurrence("2", "2026-10-11", "5002")],
            TODAY
        );
        expect(uses.get("5001")).toEqual({ times: 0, lastSungOn: null, nextScheduledOn: "2026-10-04" });
        expect(uses.get("5002")).toEqual({ times: 0, lastSungOn: null, nextScheduledOn: "2026-10-11" });
    });

    test("is empty for no occurrences", () => {
        expect(summarizeUse([], TODAY).size).toBe(0);
    });
});

describe("buildMostSung", () => {
    const grace = song(1, "Amazing Grace", "5001", "NEW BRITAIN", ["R-12"]);
    const help = song(2, "O God, Our Help in Ages Past", "5002", "ST. ANNE", ["R-396", "G-317"]);
    const catalog = [grace, help, song(3, "Never Sung", "5009")];
    const titles = new Map([
        ["5001", "Amazing Grace (PCO)"],
        ["5002", "O God Our Help (PCO)"],
        ["5003", "Shout to the Lord"],
    ]);

    const occurrences = [
        // Grace: 3 plans in the last 12 months (one this year), and 2 before.
        occurrence("1", "2026-09-27", "5001"),
        occurrence("2", "2026-03-01", "5001"),
        occurrence("3", "2025-10-04", "5001"),
        occurrence("4", "2025-10-03", "5001"),
        occurrence("5", "2024-02-04", "5001"),
        // Our Help: 3 in the last 12 months, 2 of them this year.
        occurrence("6", "2026-09-27", "5002"),
        occurrence("7", "2026-01-01", "5002"),
        occurrence("8", "2025-12-31", "5002"),
        // Shout: not in the catalog, once this year; scheduled again next week.
        occurrence("9", "2026-09-20", "5003"),
        occurrence("10", "2026-10-11", "5003"),
        // A song the mirror has never heard of, sung once, a long time ago.
        occurrence("11", "2020-05-03", "5777"),
        // Never Sung is only scheduled.
        occurrence("12", "2026-10-04", "5009"),
    ];

    function rows(period: (typeof MOST_SUNG_PERIODS)[number]) {
        return buildMostSung(occurrences, TODAY, period, catalog, titles).map(
            ({ pcoSongId, title, times, lastSungOn }) => [pcoSongId, title, times, lastSungOn]
        );
    }

    test("counts the last 12 months from the same day a year before, up to yesterday", () => {
        expect(rows("last-12-months")).toEqual([
            ["5001", "Amazing Grace", 3, "2026-09-27"],
            ["5002", "O God, Our Help in Ages Past", 3, "2026-09-27"],
            ["5003", "Shout to the Lord", 1, "2026-09-20"],
        ]);
    });

    test("counts this year from January 1", () => {
        expect(rows("this-year")).toEqual([
            ["5001", "Amazing Grace", 2, "2026-09-27"],
            ["5002", "O God, Our Help in Ages Past", 2, "2026-09-27"],
            ["5003", "Shout to the Lord", 1, "2026-09-20"],
        ]);
    });

    test("counts all time, every song ever sung, in the catalog or not", () => {
        expect(rows("all-time")).toEqual([
            ["5001", "Amazing Grace", 5, "2026-09-27"],
            ["5002", "O God, Our Help in Ages Past", 3, "2026-09-27"],
            ["5003", "Shout to the Lord", 1, "2026-09-20"],
            ["5777", "Song 5777", 1, "2020-05-03"],
        ]);
    });

    test("leaves out a song only scheduled, and a plan dated today", () => {
        for (const period of MOST_SUNG_PERIODS) {
            expect(rows(period).map(([id]) => id)).not.toContain("5009");
        }
        const [mostSungOnce] = buildMostSung(
            [occurrence("1", "2026-10-04", "5001")],
            TODAY,
            "all-time",
            catalog,
            titles
        );
        expect(mostSungOnce).toBeUndefined();
    });

    test("gives each row its catalog song, with its numbers, or null when the song is in no catalog song", () => {
        const [first, second, third] = buildMostSung(occurrences, TODAY, "last-12-months", catalog, titles);
        expect(first.song).toBe(grace);
        expect(first.song?.entries.map(({ label }) => label)).toEqual(["R-12"]);
        expect(second.song).toBe(help);
        expect(third.song).toBeNull();
    });

    test("orders equal counts by the latest date, then by title, then by id", () => {
        const tied = buildMostSung(
            [
                occurrence("1", "2026-09-06", "5010"),
                occurrence("2", "2026-09-13", "5011"),
                occurrence("3", "2026-09-13", "5009"),
                occurrence("4", "2026-09-13", "5012"),
            ],
            TODAY,
            "all-time",
            [],
            new Map([
                ["5009", "zeal"],
                ["5010", "Alpha"],
                ["5011", "Beta"],
                ["5012", "beta"],
            ])
        );
        // 5011, 5009 and 5012 were sung last on the 13th: by title (case aside, then as written), 5010 on the 6th.
        expect(tied.map(({ pcoSongId }) => pcoSongId)).toEqual(["5011", "5012", "5009", "5010"]);
    });

    test("is empty when nothing was sung", () => {
        expect(buildMostSung([], TODAY, "all-time", catalog, titles)).toEqual([]);
    });
});

describe("buildLastSung", () => {
    const grace = song(1, "Amazing Grace", "5001", "NEW BRITAIN");
    const help = song(2, "O God, Our Help in Ages Past", "5002", "ST. ANNE");
    const unlinked = song(3, "Not In Planning Center", null);
    const scheduled = song(4, "Only Scheduled", "5003");
    const never = song(5, "Never Anywhere", "5004");
    const abbaOne = song(6, "Abba, Father", "5005", "PRITCHARD");
    const abbaTwo = song(7, "Abba, Father", "5006", "ABBA, FATHER");
    const catalog = [help, unlinked, abbaOne, grace, scheduled, never, abbaTwo];

    const occurrences = [
        occurrence("1", "2026-09-27", "5001"),
        occurrence("2", "2026-06-07", "5001"),
        occurrence("3", "2026-08-02", "5002"),
        occurrence("4", "2026-10-11", "5003"),
        occurrence("5", "2026-10-04", "5003"),
    ];

    test("lists every linked song with its last past date, times and next scheduled date, by title then tune", () => {
        expect(
            buildLastSung(occurrences, TODAY, catalog).map(
                ({ song, times, lastSungOn, nextScheduledOn }) => [song.id, times, lastSungOn, nextScheduledOn]
            )
        ).toEqual([
            [7, 0, null, null],
            [6, 0, null, null],
            [1, 2, "2026-09-27", null],
            [5, 0, null, null],
            [2, 1, "2026-08-02", null],
            [4, 0, null, "2026-10-04"],
        ]);
    });

    test("leaves out a song that is not linked", () => {
        expect(buildLastSung(occurrences, TODAY, catalog).map(({ song }) => song.id)).not.toContain(3);
    });

    test("gives the songs themselves", () => {
        expect(buildLastSung(occurrences, TODAY, [grace])[0].song).toBe(grace);
    });

    test("is empty with no linked songs", () => {
        expect(buildLastSung(occurrences, TODAY, [unlinked])).toEqual([]);
        expect(buildLastSung(occurrences, TODAY, [])).toEqual([]);
    });
});

describe("notSungSince", () => {
    const catalog = [
        song(1, "Sung Lately", "5001"),
        song(2, "Sung In March", "5002"),
        song(3, "Sung In January", "5003"),
        song(4, "Sung On The Date", "5004"),
        song(5, "Never Sung", "5005"),
        song(6, "Also Never Sung", "5006"),
        song(7, "Only Scheduled", "5007"),
    ];
    const occurrences = [
        occurrence("1", "2026-09-27", "5001"),
        occurrence("2", "2026-03-01", "5002"),
        occurrence("3", "2026-01-04", "5003"),
        occurrence("4", "2026-06-01", "5004"),
        occurrence("5", "2026-10-11", "5007"),
    ];
    const lastSung = buildLastSung(occurrences, TODAY, catalog);

    test("keeps the songs last sung before the date and those never sung, longest unsung first", () => {
        expect(notSungSince(lastSung, "2026-06-01").map(({ song }) => song.title)).toEqual([
            "Also Never Sung",
            "Never Sung",
            "Only Scheduled",
            "Sung In January",
            "Sung In March",
        ]);
    });

    test("counts a song sung on the date as sung since", () => {
        expect(notSungSince(lastSung, "2026-06-01").map(({ song }) => song.id)).not.toContain(4);
        expect(notSungSince(lastSung, "2026-06-02").map(({ song }) => song.id)).toContain(4);
    });

    test("carries each song's use, so a scheduled song can say when", () => {
        const row = notSungSince(lastSung, "2026-06-01").find(({ song }) => song.id === 7);
        expect(row).toMatchObject({ lastSungOn: null, times: 0, nextScheduledOn: "2026-10-11" });
    });

    test("leaves a year ago as the default date, and no song when everything was sung since", () => {
        expect(defaultNotSince("2026-10-04")).toBe("2025-10-04");
        expect(notSungSince(lastSung, "2025-01-01").map(({ song }) => song.id)).toEqual([6, 5, 7]);
        expect(notSungSince([], "2025-01-01")).toEqual([]);
    });

    test("does not change the rows it is given", () => {
        const before = [...lastSung];
        notSungSince(lastSung, "2026-06-01");
        expect(lastSung).toEqual(before);
    });

    test("takes rows that hold only what a page shows of each song, and gives those rows back", () => {
        const lean = lastSung.map((row) => ({
            ...row,
            song: { id: row.song.id, title: row.song.title, tuneName: row.song.tuneName, numbers: "R-1" },
        }));
        const kept = notSungSince(lean, "2026-06-01");
        expect(kept.map(({ song }) => song.id)).toEqual(
            notSungSince(lastSung, "2026-06-01").map(({ song }) => song.id)
        );
        expect(kept[0].song.numbers).toBe("R-1");
    });
});

describe("parseReportDate", () => {
    test("takes a real date written YYYY-MM-DD", () => {
        expect(parseReportDate("2026-10-04")).toBe("2026-10-04");
        expect(parseReportDate("2024-02-29")).toBe("2024-02-29");
    });

    test.each([
        null,
        undefined,
        "",
        "garbage",
        "2026-2-3",
        "2026-02-30",
        "2025-02-29",
        "2026-13-01",
        "2026-10-04T08:00:00Z",
        " 2026-10-04",
        "2026-10-04 ",
        "10/04/2026",
    ])("refuses %j", (value) => {
        expect(parseReportDate(value)).toBeNull();
    });
});

describe("buildSongHistory", () => {
    test("lists every plan the song is in, the latest first, with the upcoming ones marked, and its use", () => {
        const history = buildSongHistory(
            [
                occurrence("101", "2026-09-06", "5001", MORNING),
                occurrence("103", "2026-10-11", "5001", MORNING),
                occurrence("102", "2026-09-27", "5001", EVENING),
                occurrence("104", "2026-10-04", "5001", EVENING),
                occurrence("105", "2026-10-18", "5001", MORNING),
            ],
            TODAY
        );

        expect(history.entries.map(({ planId, planDate, serviceTypeId, upcoming }) => [planId, planDate, serviceTypeId, upcoming])).toEqual([
            ["105", "2026-10-18", MORNING, true],
            ["103", "2026-10-11", MORNING, true],
            ["104", "2026-10-04", EVENING, true],
            ["102", "2026-09-27", EVENING, false],
            ["101", "2026-09-06", MORNING, false],
        ]);
        expect(history).toMatchObject({ times: 2, lastSungOn: "2026-09-27", nextScheduledOn: "2026-10-04" });
    });

    test("lists a song twice in a plan as two items, and counts the plan once", () => {
        const history = buildSongHistory(
            [occurrence("101", "2026-09-27", "5001"), occurrence("101", "2026-09-27", "5001")],
            TODAY
        );
        expect(history.entries).toHaveLength(2);
        expect(history.times).toBe(1);
    });

    test("is empty for a song in no plan", () => {
        expect(buildSongHistory([], TODAY)).toEqual({
            entries: [],
            times: 0,
            lastSungOn: null,
            nextScheduledOn: null,
        });
    });

    test("has a song only scheduled never sung", () => {
        expect(buildSongHistory([occurrence("101", "2026-10-11", "5001")], TODAY)).toMatchObject({
            times: 0,
            lastSungOn: null,
            nextScheduledOn: "2026-10-11",
        });
    });
});
