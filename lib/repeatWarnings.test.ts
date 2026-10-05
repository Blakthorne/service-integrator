import { describe, expect, test } from "vitest";
import {
    describeDaysAgo,
    describeRepeatWarning,
    repeatWarningFor,
    repeatWindowStart,
    warningsToShow,
    type RepeatWarning,
} from "./repeatWarnings";

describe("repeatWindowStart", () => {
    test("is the date that many weeks before today, which a plan on that day is within", () => {
        expect(repeatWindowStart("2026-10-04", 6)).toBe("2026-08-23");
        expect(repeatWindowStart("2026-10-04", 1)).toBe("2026-09-27");
        expect(repeatWindowStart("2026-10-04", 52)).toBe("2025-10-05");
        expect(repeatWindowStart("2026-02-01", 6)).toBe("2025-12-21");
    });

    test("is null when the warnings are off", () => {
        expect(repeatWindowStart("2026-10-04", 0)).toBeNull();
    });
});

describe("repeatWarningFor", () => {
    test("names the plan and says how many days before today it was", () => {
        expect(
            repeatWarningFor({ planId: "81234567", serviceTypeId: "1405391", planDate: "2026-09-20" }, "2026-10-04")
        ).toEqual({ planId: "81234567", serviceTypeId: "1405391", planDate: "2026-09-20", daysAgo: 14 });
        expect(
            repeatWarningFor({ planId: "1", serviceTypeId: "2", planDate: "2026-10-03" }, "2026-10-04").daysAgo
        ).toBe(1);
    });
});

describe("describeDaysAgo", () => {
    test.each([
        [0, "today"],
        [1, "yesterday"],
        [2, "2 days ago"],
        [6, "6 days ago"],
        [7, "1 week ago"],
        [13, "1 week ago"],
        [14, "2 weeks ago"],
        [20, "2 weeks ago"],
        [21, "3 weeks ago"],
        [42, "6 weeks ago"],
        [364, "52 weeks ago"],
    ])("%i days is %s", (days, words) => {
        expect(describeDaysAgo(days)).toBe(words);
    });
});

describe("describeRepeatWarning", () => {
    test("says when the song was sung and how long ago", () => {
        expect(describeRepeatWarning({ planDate: "2026-09-20", daysAgo: 14 })).toBe("Sung Sep 20 (2 weeks ago)");
        expect(describeRepeatWarning({ planDate: "2026-10-03", daysAgo: 1 })).toBe("Sung Oct 3 (yesterday)");
        expect(describeRepeatWarning({ planDate: "2026-09-29", daysAgo: 5 })).toBe("Sung Sep 29 (5 days ago)");
    });
});

describe("warningsToShow", () => {
    // Worked out on 2026-10-04: the first sung two weeks before, the second a week before.
    const warnings: Record<string, RepeatWarning> = {
        "2": { planId: "501", serviceTypeId: "1405391", planDate: "2026-09-20", daysAgo: 14 },
        "3": { planId: "502", serviceTypeId: "1405391", planDate: "2026-09-27", daysAgo: 7 },
    };

    test("keeps them all on a plan dated after the day they were made for", () => {
        expect(warningsToShow(warnings, "2026-10-11")).toEqual(warnings);
    });

    test("keeps them on a plan dated that very day, which is upcoming all day", () => {
        expect(warningsToShow(warnings, "2026-10-04")).toEqual(warnings);
    });

    test("drops them all from a plan that is over", () => {
        expect(warningsToShow(warnings, "2026-10-03")).toEqual({});
        expect(warningsToShow(warnings, "2026-01-01")).toEqual({});
    });

    test("drops them when the plan's date is not known", () => {
        expect(warningsToShow(warnings, null)).toEqual({});
    });

    test("judges each by the day it was made for", () => {
        const mixed: Record<string, RepeatWarning> = {
            ...warnings,
            "4": { planId: "503", serviceTypeId: "1405391", planDate: "2026-10-01", daysAgo: 20 },
        };
        // The third was made for the 21st (the 1st and 20 days); the first two for the 4th.
        expect(Object.keys(warningsToShow(mixed, "2026-10-10"))).toEqual(["2", "3"]);
        expect(Object.keys(warningsToShow(mixed, "2026-10-21"))).toEqual(["2", "3", "4"]);
    });

    test("drops a warning whose plan date is not a date, rather than throw", () => {
        const broken: Record<string, RepeatWarning> = {
            "2": { planId: "501", serviceTypeId: "1405391", planDate: "not a date", daysAgo: 14 },
            "3": warnings["3"],
        };
        expect(Object.keys(warningsToShow(broken, "2026-10-11"))).toEqual(["3"]);
    });

    test("has none for none, and does not change the warnings it is given", () => {
        expect(warningsToShow({}, "2026-10-11")).toEqual({});
        const before = structuredClone(warnings);
        warningsToShow(warnings, "2026-09-01");
        expect(warnings).toEqual(before);
    });
});
