import { describe, expect, test } from "vitest";
import { groupPlansByDate, sortPlanDates } from "./plansByDate";

// Characterization tests: they pin how /api/all-plans orders and groups plans
// and how PlansTable orders its date headings. (The heading text itself is
// lib/format's formatPlanDateHeading, tested in format.test.ts.)

interface TestPlan {
    id: string;
    sortDate: string;
    serviceType: string;
}

function plan(
    id: string,
    sortDate: string,
    serviceType = "Sunday Morning"
): TestPlan {
    return { id, sortDate, serviceType };
}

const ids = (plans: TestPlan[]): string[] => plans.map((p) => p.id);

describe("groupPlansByDate", () => {
    test("returns an empty object for no plans", () => {
        expect(groupPlansByDate([])).toEqual({});
    });

    test("groups plans by the date part of sortDate", () => {
        const morning = plan("a", "2025-06-15T08:00:00Z");
        const evening = plan("b", "2025-06-15T18:00:00Z", "Sunday Evening");
        const earlier = plan("c", "2025-06-08T08:00:00Z");

        const result = groupPlansByDate([morning, evening, earlier]);

        expect(Object.keys(result).sort()).toEqual([
            "2025-06-08",
            "2025-06-15",
        ]);
        expect(ids(result["2025-06-15"])).toEqual(["b", "a"]);
        expect(ids(result["2025-06-08"])).toEqual(["c"]);
        // The plans themselves are grouped, not copied.
        expect(result["2025-06-08"][0]).toBe(earlier);
    });

    test("orders dates newest first by string compare, across months and years", () => {
        const result = groupPlansByDate([
            plan("a", "2024-12-29T08:00:00Z"),
            plan("b", "2025-06-15T08:00:00Z"),
            plan("c", "2025-01-05T08:00:00Z"),
            plan("d", "2025-06-08T08:00:00Z"),
        ]);

        // Keys are inserted newest first, which is also the JSON key order of
        // the all-plans response.
        expect(Object.keys(result)).toEqual([
            "2025-06-15",
            "2025-06-08",
            "2025-01-05",
            "2024-12-29",
        ]);
    });

    test("within one date, the later time comes first", () => {
        const result = groupPlansByDate([
            plan("early", "2025-06-15T08:00:00Z"),
            plan("late", "2025-06-15T18:00:00Z"),
            plan("middle", "2025-06-15T13:00:00Z"),
        ]);

        expect(ids(result["2025-06-15"])).toEqual(["late", "middle", "early"]);
    });

    test("plans with identical sortDate keep their input order (service-type order)", () => {
        const morning = plan("m", "2025-06-15T08:00:00Z", "Sunday Morning");
        const evening = plan("e", "2025-06-15T08:00:00Z", "Sunday Evening");
        const midweek = plan("w", "2025-06-15T08:00:00Z", "Wednesday");

        expect(
            ids(groupPlansByDate([morning, evening, midweek])["2025-06-15"])
        ).toEqual(["m", "e", "w"]);
        // Input order wins over any alphabetical or id order.
        expect(
            ids(groupPlansByDate([midweek, morning, evening])["2025-06-15"])
        ).toEqual(["w", "m", "e"]);
    });

    test("compares sortDate as text, not as an instant", () => {
        // 23:00 at -04:00 is 03:00Z on the 16th, later than 01:00Z on the 16th,
        // but as text "2025-06-15..." sorts before "2025-06-16...".
        const result = groupPlansByDate([
            plan("a", "2025-06-15T23:00:00-04:00"),
            plan("b", "2025-06-16T01:00:00Z"),
        ]);

        expect(Object.keys(result)).toEqual(["2025-06-16", "2025-06-15"]);
    });

    test("a sortDate with no time part groups under the whole string, after timed plans of that date", () => {
        expect(groupPlansByDate([plan("a", "2025-06-15")])).toEqual({
            "2025-06-15": [plan("a", "2025-06-15")],
        });

        // "2025-06-15" is a prefix of "2025-06-15T08:00:00Z", so it sorts as the older one.
        const result = groupPlansByDate([
            plan("a", "2025-06-15"),
            plan("b", "2025-06-15T08:00:00Z"),
        ]);
        expect(Object.keys(result)).toEqual(["2025-06-15"]);
        expect(ids(result["2025-06-15"])).toEqual(["b", "a"]);
    });

    test("does not mutate the input array", () => {
        const input = [
            plan("a", "2025-06-08T08:00:00Z"),
            plan("b", "2025-06-15T08:00:00Z"),
            plan("c", "2025-06-01T08:00:00Z"),
        ];

        groupPlansByDate(input);

        // Still in its original, unsorted order.
        expect(ids(input)).toEqual(["a", "b", "c"]);
    });
});

describe("sortPlanDates", () => {
    test("puts the newest date first", () => {
        expect(
            sortPlanDates({
                "2025-06-08": [],
                "2025-06-22": [],
                "2024-12-29": [],
                "2025-06-15": [],
            })
        ).toEqual(["2025-06-22", "2025-06-15", "2025-06-08", "2024-12-29"]);
    });

    test("does not depend on key insertion order", () => {
        const ascending = { "2025-06-08": 1, "2025-06-15": 2, "2025-06-22": 3 };
        const descending = { "2025-06-22": 3, "2025-06-15": 2, "2025-06-08": 1 };

        expect(sortPlanDates(ascending)).toEqual(sortPlanDates(descending));
        expect(sortPlanDates(ascending)).toEqual([
            "2025-06-22",
            "2025-06-15",
            "2025-06-08",
        ]);
    });

    test("returns an empty list for an empty map", () => {
        expect(sortPlanDates({})).toEqual([]);
    });

    test("agrees with the key order groupPlansByDate produces", () => {
        const grouped = groupPlansByDate([
            plan("a", "2025-06-01T08:00:00Z"),
            plan("b", "2025-06-15T08:00:00Z"),
            plan("c", "2025-06-08T08:00:00Z"),
        ]);

        expect(sortPlanDates(grouped)).toEqual(Object.keys(grouped));
    });
});
