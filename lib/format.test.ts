import { afterAll, beforeEach, describe, expect, test } from "vitest";
import {
    addDaysToYmd,
    addMonthsToYmd,
    daysBetweenYmd,
    formatMonthDay,
    formatPlanDateHeading,
    formatShortDate,
    planDateFromSortDate,
} from "./format";

/** Every `YYYY-MM-DD` from `start` to `end`, inclusive. Built with UTC math, so no DST gaps. */
function daysBetween(start: string, end: string): string[] {
    const days: string[] = [];
    const last = Date.parse(`${end}T00:00:00Z`);
    for (let t = Date.parse(`${start}T00:00:00Z`); t <= last; t += 86_400_000) {
        days.push(new Date(t).toISOString().slice(0, 10));
    }
    return days;
}

// Fixed texts for dates that stress the formatting: the start and end of every
// month of a leap year, year boundaries, a century that is not a leap year, the
// lowest and highest years accepted, and days a clock changed somewhere in the
// world. They were written out with Python's datetime, not computed by the code
// under test, and every time zone below must reproduce them exactly.
// [YYYY-MM-DD, formatPlanDateHeading(...), formatShortDate(...)]
const FIXED_DATES: [ymd: string, heading: string, short: string][] = [
    ["1000-01-01", "Wednesday, January 1, 1000", "1/1/00"], // lowest year accepted
    ["1999-12-31", "Friday, December 31, 1999", "12/31/99"],
    ["2000-01-01", "Saturday, January 1, 2000", "1/1/00"],
    ["2000-02-29", "Tuesday, February 29, 2000", "2/29/00"],
    ["2018-11-04", "Sunday, November 4, 2018", "11/4/18"], // Brazil's DST began at midnight, so local 00:00 did not exist
    ["2023-12-31", "Sunday, December 31, 2023", "12/31/23"],
    ["2024-01-01", "Monday, January 1, 2024", "1/1/24"],
    ["2024-01-31", "Wednesday, January 31, 2024", "1/31/24"],
    ["2024-02-01", "Thursday, February 1, 2024", "2/1/24"],
    ["2024-02-29", "Thursday, February 29, 2024", "2/29/24"],
    ["2024-03-01", "Friday, March 1, 2024", "3/1/24"],
    ["2024-03-31", "Sunday, March 31, 2024", "3/31/24"],
    ["2024-04-01", "Monday, April 1, 2024", "4/1/24"],
    ["2024-04-30", "Tuesday, April 30, 2024", "4/30/24"],
    ["2024-05-01", "Wednesday, May 1, 2024", "5/1/24"],
    ["2024-05-31", "Friday, May 31, 2024", "5/31/24"],
    ["2024-06-01", "Saturday, June 1, 2024", "6/1/24"],
    ["2024-06-30", "Sunday, June 30, 2024", "6/30/24"],
    ["2024-07-01", "Monday, July 1, 2024", "7/1/24"],
    ["2024-07-31", "Wednesday, July 31, 2024", "7/31/24"],
    ["2024-08-01", "Thursday, August 1, 2024", "8/1/24"],
    ["2024-08-31", "Saturday, August 31, 2024", "8/31/24"],
    ["2024-09-01", "Sunday, September 1, 2024", "9/1/24"],
    ["2024-09-30", "Monday, September 30, 2024", "9/30/24"],
    ["2024-10-01", "Tuesday, October 1, 2024", "10/1/24"],
    ["2024-10-31", "Thursday, October 31, 2024", "10/31/24"],
    ["2024-11-01", "Friday, November 1, 2024", "11/1/24"],
    ["2024-11-30", "Saturday, November 30, 2024", "11/30/24"],
    ["2024-12-01", "Sunday, December 1, 2024", "12/1/24"],
    ["2024-12-31", "Tuesday, December 31, 2024", "12/31/24"],
    ["2025-01-01", "Wednesday, January 1, 2025", "1/1/25"],
    ["2025-02-28", "Friday, February 28, 2025", "2/28/25"],
    ["2025-03-01", "Saturday, March 1, 2025", "3/1/25"],
    ["2025-03-09", "Sunday, March 9, 2025", "3/9/25"], // US clocks forward
    ["2025-03-30", "Sunday, March 30, 2025", "3/30/25"], // EU clocks forward
    ["2025-06-15", "Sunday, June 15, 2025", "6/15/25"],
    ["2025-09-28", "Sunday, September 28, 2025", "9/28/25"], // Chatham clocks forward
    ["2025-10-26", "Sunday, October 26, 2025", "10/26/25"], // EU clocks back
    ["2025-11-02", "Sunday, November 2, 2025", "11/2/25"], // US clocks back
    ["2025-12-31", "Wednesday, December 31, 2025", "12/31/25"],
    ["2026-01-01", "Thursday, January 1, 2026", "1/1/26"],
    ["2026-10-04", "Sunday, October 4, 2026", "10/4/26"],
    ["2026-12-31", "Thursday, December 31, 2026", "12/31/26"],
    ["2100-02-28", "Sunday, February 28, 2100", "2/28/00"],
    ["2100-03-01", "Monday, March 1, 2100", "3/1/00"],
    ["9999-12-31", "Friday, December 31, 9999", "12/31/99"], // highest 4-digit year
];

// Three years, every day, so every month boundary, weekday and DST change is hit.
const SWEEP_DATES = daysBetween("2024-01-01", "2026-12-31");

describe("planDateFromSortDate", () => {
    test("takes the date part of a sort_date", () => {
        expect(planDateFromSortDate("2026-10-04T08:00:00Z")).toBe("2026-10-04");
        expect(planDateFromSortDate("2025-06-15T18:00:00Z")).toBe("2025-06-15");
    });

    test("takes the date as written, whatever the time and offset", () => {
        expect(planDateFromSortDate("2025-06-15T23:30:00-04:00")).toBe(
            "2025-06-15"
        );
        expect(planDateFromSortDate("2025-06-15T00:00:00+14:00")).toBe(
            "2025-06-15"
        );
        expect(planDateFromSortDate("2025-06-15T00:00:00")).toBe("2025-06-15");
        expect(planDateFromSortDate("2025-06-15T")).toBe("2025-06-15");
    });

    test("accepts a bare date", () => {
        expect(planDateFromSortDate("2025-06-15")).toBe("2025-06-15");
    });

    test("accepts the last day of each kind of month, and a leap day", () => {
        expect(planDateFromSortDate("2025-01-31")).toBe("2025-01-31");
        expect(planDateFromSortDate("2025-04-30")).toBe("2025-04-30");
        expect(planDateFromSortDate("2024-02-29")).toBe("2024-02-29");
        expect(planDateFromSortDate("2025-02-28")).toBe("2025-02-28");
    });

    test.each([
        ["an empty string", ""],
        ["a year only", "2025"],
        ["an unpadded month", "2025-6-15"],
        ["an unpadded day", "2025-06-1"],
        ["month 13", "2025-13-01"],
        ["month 00", "2025-00-10"],
        ["day 00", "2025-06-00"],
        ["day 32", "2025-06-32"],
        ["February 30", "2025-02-30"],
        ["April 31", "2025-04-31"],
        ["February 29 in a common year", "2023-02-29"],
        ["February 29 in 2100, which is not a leap year", "2100-02-29"],
        ["a year before 1000", "0999-12-31"],
        ["year 0000", "0000-01-01"],
        ["a two-digit year", "25-06-15"],
        ["text", "garbage"],
        ["a time with no date", "T08:00:00Z"],
        ["a leading space", " 2025-06-15"],
        ["a space instead of the T", "2025-06-15 08:00:00"],
        ["a slash-separated date", "2025/06/15"],
        ["a basic-format date", "20250615"],
        ["a longer digit run", "2025-06-155"],
        ["text after the date", "2025-06-15garbage"],
        ["a non-ASCII digit", "2025-06-1٥"],
    ])("rejects %s", (_name, value) => {
        expect(planDateFromSortDate(value)).toBeNull();
    });

    test("rejects values that are not strings", () => {
        for (const value of [null, undefined, 20250615, {}, ["2025-06-15"]]) {
            expect(planDateFromSortDate(value as unknown as string)).toBeNull();
        }
    });
});

describe("formatPlanDateHeading", () => {
    test("formats a date as weekday, month day, year", () => {
        expect(formatPlanDateHeading("2025-06-15")).toBe(
            "Sunday, June 15, 2025"
        );
        expect(formatPlanDateHeading("2026-10-04")).toBe(
            "Sunday, October 4, 2026"
        );
    });

    test("uses the calendar date it was given, at the start and end of a month or year", () => {
        expect(formatPlanDateHeading("2025-01-01")).toBe(
            "Wednesday, January 1, 2025"
        );
        expect(formatPlanDateHeading("2025-12-31")).toBe(
            "Wednesday, December 31, 2025"
        );
        expect(formatPlanDateHeading("2024-02-29")).toBe(
            "Thursday, February 29, 2024"
        );
        expect(formatPlanDateHeading("2000-01-01")).toBe(
            "Saturday, January 1, 2000"
        );
    });

    test("returns input that is not a real calendar date unchanged", () => {
        for (const value of ["", "garbage", "2025-02-30", "2025-6-15"]) {
            expect(formatPlanDateHeading(value)).toBe(value);
        }
        // Only a bare date is accepted, not a full sort_date.
        expect(formatPlanDateHeading("2025-06-15T08:00:00Z")).toBe(
            "2025-06-15T08:00:00Z"
        );
    });
});

describe("formatShortDate", () => {
    test.each([
        ["2025-06-15", "6/15/25"],
        ["2026-10-04", "10/4/26"],
        ["2025-01-05", "1/5/25"],
        ["2024-02-29", "2/29/24"],
        ["2000-01-01", "1/1/00"],
        ["2099-12-31", "12/31/99"],
    ])("%s is %s", (ymd, expected) => {
        expect(formatShortDate(ymd)).toBe(expected);
    });

    test("returns input that is not a real calendar date unchanged", () => {
        for (const value of ["", "garbage", "2025-02-30", "2025-6-15"]) {
            expect(formatShortDate(value)).toBe(value);
        }
    });
});

describe("formatMonthDay", () => {
    test.each([
        ["2026-09-20", "Sep 20"],
        ["2026-10-04", "Oct 4"],
        ["2024-02-29", "Feb 29"],
        ["2025-12-31", "Dec 31"],
    ])("%s is %s", (ymd, expected) => {
        expect(formatMonthDay(ymd)).toBe(expected);
    });

    test("returns input that is not a real calendar date unchanged", () => {
        for (const value of ["", "garbage", "2025-02-30", "2025-6-15"]) {
            expect(formatMonthDay(value)).toBe(value);
        }
    });
});

describe("addDaysToYmd", () => {
    test.each([
        ["2026-10-04", 0, "2026-10-04"],
        ["2026-10-04", 1, "2026-10-05"],
        ["2026-10-04", -56, "2026-08-09"],
        ["2026-10-04", 7 * 52, "2027-10-03"],
        ["2026-12-31", 1, "2027-01-01"],
        ["2027-01-01", -1, "2026-12-31"],
        ["2024-02-28", 1, "2024-02-29"],
        ["2025-02-28", 1, "2025-03-01"],
        ["2000-03-01", -1, "2000-02-29"],
        ["1900-03-01", -1, "1900-02-28"],
        ["2026-11-01", 1, "2026-11-02"],
    ])("%s plus %i days is %s", (ymd, days, expected) => {
        expect(addDaysToYmd(ymd, days)).toBe(expected);
    });

    test("throws for a date that does not exist, and for a fraction of a day", () => {
        for (const value of ["", "garbage", "2025-02-30", "2025-6-15"]) {
            expect(() => addDaysToYmd(value, 1)).toThrow(RangeError);
        }
        expect(() => addDaysToYmd("2026-10-04", 1.5)).toThrow(RangeError);
        expect(() => addDaysToYmd("2026-10-04", Number.NaN)).toThrow(RangeError);
    });
});

describe("addMonthsToYmd", () => {
    test.each([
        ["2026-10-04", -12, "2025-10-04"],
        ["2026-10-04", -60, "2021-10-04"],
        ["2026-10-04", 1, "2026-11-04"],
        ["2026-10-04", 3, "2027-01-04"],
        ["2026-01-15", -1, "2025-12-15"],
        ["2026-03-31", -1, "2026-02-28"],
        ["2024-03-31", -1, "2024-02-29"],
        ["2024-02-29", -12, "2023-02-28"],
        ["2024-02-29", 48, "2028-02-29"],
        ["2026-08-31", 1, "2026-09-30"],
        ["2026-10-31", -1, "2026-09-30"],
        ["2026-10-04", 0, "2026-10-04"],
    ])("%s plus %i months is %s", (ymd, months, expected) => {
        expect(addMonthsToYmd(ymd, months)).toBe(expected);
    });

    test("throws for a date that does not exist, and for a fraction of a month", () => {
        expect(() => addMonthsToYmd("2025-02-30", 1)).toThrow(RangeError);
        expect(() => addMonthsToYmd("2026-10-04", 0.5)).toThrow(RangeError);
    });
});

describe("daysBetweenYmd", () => {
    test.each([
        ["2026-09-20", "2026-10-04", 14],
        ["2026-10-04", "2026-10-04", 0],
        ["2026-10-04", "2026-09-20", -14],
        ["2025-12-31", "2026-01-01", 1],
        ["2024-02-28", "2024-03-01", 2],
        ["2025-02-28", "2025-03-01", 1],
        ["2025-10-04", "2026-10-04", 365],
        ["2025-03-08", "2025-03-10", 2],
    ])("from %s to %s is %i days", (from, to, expected) => {
        expect(daysBetweenYmd(from, to)).toBe(expected);
    });

    test("throws unless both are real calendar dates", () => {
        expect(() => daysBetweenYmd("2026-02-30", "2026-10-04")).toThrow(RangeError);
        expect(() => daysBetweenYmd("2026-10-04", "")).toThrow(RangeError);
    });
});

// The output must not depend on the time zone of the machine. Each case below
// runs in zones that cover UTC-11 to UTC+14, a half-hour zone, a quarter-hour
// zone, and one with DST that skipped local midnight.
const ZONES: [zone: string, utcOffsetMinutes: number][] = [
    ["UTC", 0],
    ["America/New_York", 240],
    ["America/Sao_Paulo", 180],
    ["Pacific/Pago_Pago", 660], // UTC-11, the last place to reach a date
    ["Asia/Kolkata", -330],
    ["Pacific/Chatham", -765],
    ["Pacific/Kiritimati", -840], // UTC+14, the first place to reach a date
];

const originalTimeZone = process.env.TZ;

function setTimeZone(zone: string, utcOffsetMinutes: number): void {
    process.env.TZ = zone;
    // Guard: if this runtime ignored the change, the zone tests would pass
    // without testing anything.
    expect(new Date(Date.UTC(2025, 5, 15, 12)).getTimezoneOffset()).toBe(
        utcOffsetMinutes
    );
}

afterAll(() => {
    if (originalTimeZone === undefined) {
        delete process.env.TZ;
    } else {
        process.env.TZ = originalTimeZone;
    }
});

describe.each(ZONES)("in the %s time zone", (zone, utcOffsetMinutes) => {
    beforeEach(() => {
        setTimeZone(zone, utcOffsetMinutes);
    });

    test("formatPlanDateHeading and formatShortDate give the fixed texts", () => {
        const mismatches = FIXED_DATES.flatMap(([ymd, heading, short]) => {
            const got = [formatPlanDateHeading(ymd), formatShortDate(ymd)];
            return got[0] === heading && got[1] === short
                ? []
                : [{ ymd, got, expected: [heading, short] }];
        });
        expect(mismatches).toEqual([]);
    });

    test("formatShortDate gives the text of a local-time en-US short date", () => {
        const localShortDate = (ymd: string): string =>
            new Date(`${ymd}T00:00:00`).toLocaleDateString("en-US", {
                month: "numeric",
                day: "numeric",
                year: "2-digit",
            });
        const mismatches = [
            ...FIXED_DATES.map(([ymd]) => ymd),
            ...SWEEP_DATES,
        ].filter((ymd) => formatShortDate(ymd) !== localShortDate(ymd));
        expect(mismatches).toEqual([]);
    });

    test("a sort_date shows its own calendar date, early or late in the day", () => {
        for (const sortDate of [
            "2025-06-15T00:00:00Z",
            "2025-06-15T08:00:00Z",
            "2025-06-15T18:00:00Z",
            "2025-06-15T23:59:59Z",
        ]) {
            const ymd = planDateFromSortDate(sortDate) as string;
            expect(formatShortDate(ymd)).toBe("6/15/25");
            expect(formatPlanDateHeading(ymd)).toBe("Sunday, June 15, 2025");
        }
    });
});

describe("why sort_date is not formatted as an instant", () => {
    const instantShortDate = (iso: string): string =>
        new Date(iso).toLocaleDateString("en-US", {
            month: "numeric",
            day: "numeric",
            year: "2-digit",
        });

    test("formatting the instant in local time moves an early service to the previous day", () => {
        // The old code did this, so a viewer at UTC-11 saw June 14.
        setTimeZone("Pacific/Pago_Pago", 660);
        expect(instantShortDate("2025-06-15T08:00:00Z")).toBe("6/14/25");
        expect(
            formatShortDate(planDateFromSortDate("2025-06-15T08:00:00Z") ?? "")
        ).toBe("6/15/25");
    });

    test("and a late service to the next day", () => {
        setTimeZone("Pacific/Kiritimati", -840);
        expect(instantShortDate("2025-06-15T18:00:00Z")).toBe("6/16/25");
        expect(
            formatShortDate(planDateFromSortDate("2025-06-15T18:00:00Z") ?? "")
        ).toBe("6/15/25");
    });
});
