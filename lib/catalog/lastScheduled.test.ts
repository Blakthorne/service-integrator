import { describe, expect, test } from "vitest";
import { formatLastScheduled, lastScheduledDate } from "./lastScheduled";

describe("lastScheduledDate", () => {
    test("gives the date part of Planning Center's timestamp, as written", () => {
        expect(lastScheduledDate("2026-09-27T08:00:00Z")).toBe("2026-09-27");
        // Late in the day, labelled Z, is still that day: the time is never shifted.
        expect(lastScheduledDate("2026-09-27T23:59:59Z")).toBe("2026-09-27");
        expect(lastScheduledDate("2026-09-27T00:00:00-07:00")).toBe("2026-09-27");
    });

    test("takes a bare date", () => {
        expect(lastScheduledDate("2026-09-27")).toBe("2026-09-27");
    });

    test("gives null when there is no date", () => {
        expect(lastScheduledDate(null)).toBeNull();
    });

    test("gives a value that is not a calendar date as it was written", () => {
        expect(lastScheduledDate("sometime")).toBe("sometime");
        expect(lastScheduledDate("2026-02-30T08:00:00Z")).toBe("2026-02-30T08:00:00Z");
    });
});

describe("formatLastScheduled", () => {
    test("writes the date short, from its date part", () => {
        expect(formatLastScheduled("2026-09-27T08:00:00Z")).toBe("9/27/26");
        expect(formatLastScheduled("2026-01-04T23:30:00Z")).toBe("1/4/26");
        expect(formatLastScheduled("2026-09-27")).toBe("9/27/26");
    });

    test("gives null when there is no date", () => {
        expect(formatLastScheduled(null)).toBeNull();
    });

    test("gives a value that is not a calendar date as it was written", () => {
        expect(formatLastScheduled("sometime")).toBe("sometime");
    });
});
