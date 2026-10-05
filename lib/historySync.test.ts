import { describe, expect, test } from "vitest";
import type { HistoryPlan } from "./db/history";
import {
    FULL_PASS_DAYS,
    HISTORY_SYNC_INTERVAL_MS,
    RECENT_PLAN_WEEKS,
    choosePlansToRead,
    isHistorySyncDue,
} from "./historySync";

const NOW = new Date("2026-10-04T12:00:00.000Z");
const TODAY = "2026-10-04";
const DAY_MS = 24 * 60 * 60 * 1000;

/** `days` days before NOW, as an ISO time. */
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS).toISOString();

/** A plan read an hour ago, unless said otherwise. */
function plan(planId: string, planDate: string, itemsSyncedAt: string | null = daysAgo(1 / 24)): HistoryPlan {
    return {
        planId,
        serviceTypeId: "1405391",
        planDate,
        updatedAt: "2026-01-01T00:00:00Z",
        itemsSyncedAt,
    };
}

function chosen(plans: HistoryPlan[]): [string, string][] {
    return choosePlansToRead(plans, NOW, TODAY).map((read) => [read.plan.planId, read.reason]);
}

describe("the rules' constants", () => {
    test("read the last 8 weeks every time, and every plan once a week; run daily", () => {
        expect(RECENT_PLAN_WEEKS).toBe(8);
        expect(FULL_PASS_DAYS).toBe(7);
        expect(HISTORY_SYNC_INTERVAL_MS).toBe(DAY_MS);
    });
});

describe("choosePlansToRead", () => {
    test("reads a plan that was never read, however old it is", () => {
        expect(chosen([plan("1", "2019-03-03", null)])).toEqual([["1", "unread"]]);
    });

    test("reads every upcoming plan, however far ahead, though it was read an hour ago", () => {
        expect(
            chosen([
                plan("1", "2026-10-04"),
                plan("2", "2026-10-11"),
                plan("3", "2027-06-06"),
            ])
        ).toEqual([
            ["3", "recent"],
            ["2", "recent"],
            ["1", "recent"],
        ]);
    });

    test("reads every plan from the last 8 weeks, up to and including the day 8 weeks ago", () => {
        const eightWeeksAgo = "2026-08-09";
        expect(
            chosen([
                plan("1", "2026-09-27"),
                plan("2", eightWeeksAgo),
                plan("3", "2026-08-08"),
            ])
        ).toEqual([
            ["1", "recent"],
            ["2", "recent"],
        ]);
    });

    test("leaves an older plan alone while its last reading is under a week old", () => {
        expect(
            chosen([
                plan("1", "2026-01-04", daysAgo(0)),
                plan("2", "2026-01-04", daysAgo(3)),
                plan("3", "2026-01-04", daysAgo(6.99)),
            ])
        ).toEqual([]);
    });

    test("reads an older plan again once its last reading is a week old: the weekly pass", () => {
        expect(
            chosen([
                plan("1", "2026-01-04", daysAgo(7)),
                plan("2", "2025-03-02", daysAgo(30)),
            ])
        ).toEqual([
            ["1", "weekly"],
            ["2", "weekly"],
        ]);
    });

    test("gives each plan the first reason that applies: unread, then recent, then weekly", () => {
        expect(
            chosen([
                plan("1", "2026-09-27", null),
                plan("2", "2026-09-20", daysAgo(30)),
                plan("3", "2026-01-11", daysAgo(30)),
                plan("4", "2026-01-04", null),
            ])
        ).toEqual([
            ["1", "unread"],
            ["2", "recent"],
            ["3", "weekly"],
            ["4", "unread"],
        ]);
    });

    test("lists the plans by date, the latest first, so that a sync that stops early has read what matters most", () => {
        const plans = [
            plan("5", "2026-01-04", null),
            plan("12", "2026-10-11"),
            plan("30", "2026-10-04"),
            plan("9", "2026-10-04"),
            plan("7", "2025-05-04", null),
        ];
        expect(choosePlansToRead(plans, NOW, TODAY).map((read) => read.plan.planId)).toEqual([
            "12",
            "9",
            "30",
            "5",
            "7",
        ]);
    });

    test("is empty when there are no plans, or none needs reading", () => {
        expect(chosen([])).toEqual([]);
        expect(chosen([plan("1", "2025-01-05", daysAgo(2))])).toEqual([]);
    });

    test("counts the window from today's date, across a month and a year", () => {
        const plans = [plan("1", "2025-12-14"), plan("2", "2025-12-13")];
        // Eight weeks before 2026-02-07 is 2025-12-13.
        expect(
            choosePlansToRead(plans, new Date("2026-02-07T10:00:00.000Z"), "2026-02-07").map(
                (read) => read.plan.planId
            )
        ).toEqual(["1", "2"]);
        expect(
            choosePlansToRead(plans, new Date("2026-02-08T10:00:00.000Z"), "2026-02-08").map(
                (read) => read.plan.planId
            )
        ).toEqual(["1"]);
    });
});

describe("isHistorySyncDue", () => {
    const run = (ok: boolean | null, finishedAgoMs: number | null) => ({
        ok,
        startedAt: new Date(NOW.getTime() - (finishedAgoMs ?? 0) - 60_000).toISOString(),
        finishedAt: finishedAgoMs === null ? null : new Date(NOW.getTime() - finishedAgoMs).toISOString(),
    });

    test("is due when it never ran", () => {
        expect(isHistorySyncDue(null, NOW)).toBe(true);
    });

    test("is due when the latest run failed, or a restart interrupted it, however recent", () => {
        expect(isHistorySyncDue(run(false, 60_000), NOW)).toBe(true);
    });

    test("is not due while a run is in progress", () => {
        expect(isHistorySyncDue(run(null, null), NOW)).toBe(false);
    });

    test("is not due for a day after the latest success finished, and due from then on", () => {
        expect(isHistorySyncDue(run(true, 0), NOW)).toBe(false);
        expect(isHistorySyncDue(run(true, DAY_MS - 1), NOW)).toBe(false);
        expect(isHistorySyncDue(run(true, DAY_MS), NOW)).toBe(true);
        expect(isHistorySyncDue(run(true, 3 * DAY_MS), NOW)).toBe(true);
    });
});
