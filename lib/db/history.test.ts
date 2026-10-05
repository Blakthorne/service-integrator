import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
    countHistory,
    deleteHistoryPlan,
    deleteUnlistedPlans,
    listHistoryPlans,
    listOccurrences,
    listSongOccurrences,
    replacePlanOccurrences,
    upsertListedPlans,
    type ListedPlan,
} from "./history";
import { openTestDb, seedHistoryPlan, seedOccurrence } from "./testing";

let db: DatabaseSync;

beforeEach(() => {
    db = openTestDb();
});

afterEach(() => {
    db.close();
});

const T1 = new Date("2026-10-04T13:00:00.000Z");
const T2 = new Date("2026-10-05T09:30:00.000Z");

const MORNING = "1405391";
const EVENING = "1486055";

/** A plan as a listing gives it: Sunday Morning, September 27, updated that morning. */
function listed(planId: string, fields: Partial<ListedPlan> = {}): ListedPlan {
    return {
        planId,
        serviceTypeId: MORNING,
        planDate: "2026-09-27",
        updatedAt: "2026-09-27T12:00:00Z",
        ...fields,
    };
}

function occurrences(planId: string) {
    return db
        .prepare(
            `SELECT item_id, pco_song_id, sequence, plan_date, service_type_id, synced_at
             FROM plan_occurrences WHERE plan_id = ? ORDER BY sequence, item_id`
        )
        .all(planId);
}

describe("upsertListedPlans", () => {
    test("adds the plans the history lacks, with their items unread", () => {
        const result = upsertListedPlans(db, [
            listed("101"),
            listed("102", { serviceTypeId: EVENING, planDate: "2026-10-04" }),
        ]);
        expect(result).toEqual({ added: ["101", "102"], changed: [] });
        expect(listHistoryPlans(db)).toEqual([
            {
                planId: "102",
                serviceTypeId: EVENING,
                planDate: "2026-10-04",
                updatedAt: "2026-09-27T12:00:00Z",
                itemsSyncedAt: null,
            },
            {
                planId: "101",
                serviceTypeId: MORNING,
                planDate: "2026-09-27",
                updatedAt: "2026-09-27T12:00:00Z",
                itemsSyncedAt: null,
            },
        ]);
    });

    test("leaves a plan the listing shows as it was alone, its read time included", () => {
        upsertListedPlans(db, [listed("101")]);
        replacePlanOccurrences(db, "101", [{ itemId: "1", pcoSongId: "5001", sequence: 1 }], T1);

        expect(upsertListedPlans(db, [listed("101")])).toEqual({ added: [], changed: [] });
        expect(listHistoryPlans(db)[0].itemsSyncedAt).toBe(T1.toISOString());
        expect(occurrences("101")).toHaveLength(1);
    });

    test.each([
        ["a new update time", { updatedAt: "2026-10-01T09:00:00Z" }],
        ["a moved date", { planDate: "2026-10-04" }],
        ["a moved service type", { serviceTypeId: EVENING }],
    ])("gives a plan with %s its new values and unreads its items, keeping what it holds", (_, change) => {
        upsertListedPlans(db, [listed("101")]);
        replacePlanOccurrences(db, "101", [{ itemId: "1", pcoSongId: "5001", sequence: 1 }], T1);

        expect(upsertListedPlans(db, [listed("101", change)])).toEqual({
            added: [],
            changed: ["101"],
        });
        expect(listHistoryPlans(db)).toEqual([
            { ...listed("101", change), itemsSyncedAt: null },
        ]);
        // Its occurrences stay until its items are read again.
        expect(occurrences("101")).toHaveLength(1);
    });

    test("counts each plan by what it did, in one listing", () => {
        upsertListedPlans(db, [listed("101"), listed("102")]);
        replacePlanOccurrences(db, "101", [], T1);
        replacePlanOccurrences(db, "102", [], T1);
        expect(
            upsertListedPlans(db, [
                listed("101"),
                listed("102", { updatedAt: "2026-10-02T00:00:00Z" }),
                listed("103"),
            ])
        ).toEqual({ added: ["103"], changed: ["102"] });
    });

    test("stores nothing of a listing that fails part-way", () => {
        upsertListedPlans(db, [listed("101")]);
        expect(() =>
            upsertListedPlans(db, [listed("102"), listed("103", { planDate: "not a date" })])
        ).toThrow(/CHECK constraint failed/);
        expect(listHistoryPlans(db).map(({ planId }) => planId)).toEqual(["101"]);
    });
});

describe("listHistoryPlans", () => {
    test("lists the plans by date, the latest first, then by id", () => {
        seedHistoryPlan(db, { planId: "5", planDate: "2026-09-20" });
        seedHistoryPlan(db, { planId: "7", planDate: "2026-10-04" });
        seedHistoryPlan(db, { planId: "6", planDate: "2026-10-04" });
        expect(listHistoryPlans(db).map(({ planId }) => planId)).toEqual(["7", "6", "5"]);
    });

    test("is empty for a new history", () => {
        expect(listHistoryPlans(db)).toEqual([]);
    });
});

describe("deleteUnlistedPlans", () => {
    test("deletes the plans a complete listing lacks, with their occurrences, and says which", () => {
        const kept = seedHistoryPlan(db, { planId: "101" });
        const dropped = seedHistoryPlan(db, { planId: "102" });
        const alsoDropped = seedHistoryPlan(db, { planId: "103" });
        seedOccurrence(db, { planId: kept, pcoSongId: "5001" });
        seedOccurrence(db, { planId: dropped, pcoSongId: "5001" });
        seedOccurrence(db, { planId: alsoDropped, pcoSongId: "5002" });

        expect(deleteUnlistedPlans(db, ["101", "999"]).sort()).toEqual(["102", "103"]);
        expect(listHistoryPlans(db).map(({ planId }) => planId)).toEqual(["101"]);
        expect(occurrences("101")).toHaveLength(1);
        expect(occurrences("102")).toEqual([]);
        expect(countHistory(db).occurrences).toBe(1);
    });

    test("deletes nothing when the listing has every plan", () => {
        seedHistoryPlan(db, { planId: "101" });
        seedHistoryPlan(db, { planId: "102" });
        expect(deleteUnlistedPlans(db, ["102", "101", "101"])).toEqual([]);
        expect(listHistoryPlans(db)).toHaveLength(2);
    });
});

describe("deleteHistoryPlan", () => {
    test("deletes a plan and its occurrences, and says whether it was there", () => {
        seedHistoryPlan(db, { planId: "101" });
        seedHistoryPlan(db, { planId: "102" });
        seedOccurrence(db, { planId: "101", pcoSongId: "5001" });
        seedOccurrence(db, { planId: "102", pcoSongId: "5001" });

        expect(deleteHistoryPlan(db, "101")).toBe(true);
        expect(deleteHistoryPlan(db, "101")).toBe(false);
        expect(occurrences("101")).toEqual([]);
        expect(occurrences("102")).toHaveLength(1);
    });
});

describe("replacePlanOccurrences", () => {
    test("stores the items with the plan's date and service type, and marks its items read", () => {
        upsertListedPlans(db, [listed("101", { serviceTypeId: EVENING, planDate: "2026-10-04" })]);

        expect(
            replacePlanOccurrences(
                db,
                "101",
                [
                    { itemId: "12", pcoSongId: "5002", sequence: 4 },
                    { itemId: "11", pcoSongId: "5001", sequence: 2 },
                ],
                T1
            )
        ).toBe(2);

        expect(occurrences("101")).toEqual([
            {
                item_id: "11",
                pco_song_id: "5001",
                sequence: 2,
                plan_date: "2026-10-04",
                service_type_id: EVENING,
                synced_at: T1.toISOString(),
            },
            {
                item_id: "12",
                pco_song_id: "5002",
                sequence: 4,
                plan_date: "2026-10-04",
                service_type_id: EVENING,
                synced_at: T1.toISOString(),
            },
        ]);
        expect(listHistoryPlans(db)[0].itemsSyncedAt).toBe(T1.toISOString());
    });

    test("replaces what the plan held, and nothing of another plan", () => {
        upsertListedPlans(db, [listed("101"), listed("102")]);
        replacePlanOccurrences(
            db,
            "101",
            [
                { itemId: "1", pcoSongId: "5001", sequence: 1 },
                { itemId: "2", pcoSongId: "5002", sequence: 2 },
            ],
            T1
        );
        replacePlanOccurrences(db, "102", [{ itemId: "1", pcoSongId: "5003", sequence: 1 }], T1);

        // The second song was replaced by a third in the same place, and the first moved.
        replacePlanOccurrences(
            db,
            "101",
            [
                { itemId: "2", pcoSongId: "5004", sequence: 1 },
                { itemId: "3", pcoSongId: "5001", sequence: 2 },
            ],
            T2
        );

        expect(occurrences("101").map((row) => [row.item_id, row.pco_song_id, row.synced_at])).toEqual([
            ["2", "5004", T2.toISOString()],
            ["3", "5001", T2.toISOString()],
        ]);
        expect(occurrences("102").map((row) => [row.item_id, row.pco_song_id, row.synced_at])).toEqual([
            ["1", "5003", T1.toISOString()],
        ]);
    });

    test("a plan whose items hold no song has none stored, and is still read", () => {
        upsertListedPlans(db, [listed("101")]);
        replacePlanOccurrences(db, "101", [{ itemId: "1", pcoSongId: "5001", sequence: 1 }], T1);
        expect(replacePlanOccurrences(db, "101", [], T2)).toBe(0);
        expect(occurrences("101")).toEqual([]);
        expect(listHistoryPlans(db)[0].itemsSyncedAt).toBe(T2.toISOString());
    });

    test("stores an item given twice once, the first", () => {
        upsertListedPlans(db, [listed("101")]);
        expect(
            replacePlanOccurrences(db, "101", [
                { itemId: "1", pcoSongId: "5001", sequence: 1 },
                { itemId: "1", pcoSongId: "5002", sequence: 2 },
            ])
        ).toBe(1);
        expect(occurrences("101").map((row) => row.pco_song_id)).toEqual(["5001"]);
    });

    test("stores a song the song mirror lacks", () => {
        upsertListedPlans(db, [listed("101")]);
        replacePlanOccurrences(db, "101", [{ itemId: "1", pcoSongId: "26000099", sequence: 1 }]);
        expect(occurrences("101")).toHaveLength(1);
    });

    test("throws for a plan not in the history, storing nothing", () => {
        expect(() =>
            replacePlanOccurrences(db, "101", [{ itemId: "1", pcoSongId: "5001", sequence: 1 }])
        ).toThrow("Plan 101 is not in the history");
        expect(countHistory(db).occurrences).toBe(0);
    });

    test("keeps what the plan held when the new items cannot be stored", () => {
        upsertListedPlans(db, [listed("101")]);
        replacePlanOccurrences(db, "101", [{ itemId: "1", pcoSongId: "5001", sequence: 1 }], T1);
        expect(() =>
            replacePlanOccurrences(
                db,
                "101",
                [
                    { itemId: "2", pcoSongId: "5002", sequence: 1 },
                    { itemId: "not an id", pcoSongId: "5003", sequence: 2 },
                ],
                T2
            )
        ).toThrow(/CHECK constraint failed/);
        expect(occurrences("101").map((row) => row.item_id)).toEqual(["1"]);
        expect(listHistoryPlans(db)[0].itemsSyncedAt).toBe(T1.toISOString());
    });
});

describe("countHistory", () => {
    test("is all zero and dateless for a new history", () => {
        expect(countHistory(db)).toEqual({
            plans: 0,
            plansRead: 0,
            occurrences: 0,
            firstPlanDate: null,
            lastPlanDate: null,
        });
    });

    test("counts the plans, those read, the song items and the dates they span", () => {
        const first = seedHistoryPlan(db, { planDate: "2025-01-05" });
        const second = seedHistoryPlan(db, { planDate: "2026-10-04" });
        seedHistoryPlan(db, { planDate: "2026-10-11", itemsSyncedAt: null });
        seedOccurrence(db, { planId: first, pcoSongId: "5001" });
        seedOccurrence(db, { planId: first, pcoSongId: "5002" });
        seedOccurrence(db, { planId: second, pcoSongId: "5001" });

        expect(countHistory(db)).toEqual({
            plans: 3,
            plansRead: 2,
            occurrences: 3,
            firstPlanDate: "2025-01-05",
            lastPlanDate: "2026-10-11",
        });
    });
});

describe("listOccurrences", () => {
    test("is empty for a new history", () => {
        expect(listOccurrences(db)).toEqual([]);
        expect(listSongOccurrences(db, "5001")).toEqual([]);
    });

    test("lists every song item, the latest plan first, then in the order of the plan's items", () => {
        const older = seedHistoryPlan(db, { planId: "101", planDate: "2026-09-20" });
        const newer = seedHistoryPlan(db, { planId: "102", planDate: "2026-09-27", serviceTypeId: EVENING });
        seedOccurrence(db, { planId: older, pcoSongId: "5001", itemId: "9", sequence: 1 });
        seedOccurrence(db, { planId: newer, pcoSongId: "5002", itemId: "4", sequence: 2 });
        seedOccurrence(db, { planId: newer, pcoSongId: "5001", itemId: "3", sequence: 1 });

        expect(listOccurrences(db)).toEqual([
            { planId: "102", itemId: "3", pcoSongId: "5001", sequence: 1, planDate: "2026-09-27", serviceTypeId: EVENING },
            { planId: "102", itemId: "4", pcoSongId: "5002", sequence: 2, planDate: "2026-09-27", serviceTypeId: EVENING },
            { planId: "101", itemId: "9", pcoSongId: "5001", sequence: 1, planDate: "2026-09-20", serviceTypeId: MORNING },
        ]);
    });

    test("lists one song's items only, upcoming plans too", () => {
        const sung = seedHistoryPlan(db, { planDate: "2026-09-27" });
        const scheduled = seedHistoryPlan(db, { planDate: "2026-10-11" });
        seedOccurrence(db, { planId: sung, pcoSongId: "5001" });
        seedOccurrence(db, { planId: sung, pcoSongId: "5002" });
        seedOccurrence(db, { planId: scheduled, pcoSongId: "5001" });

        expect(listSongOccurrences(db, "5001").map(({ planId, planDate }) => [planId, planDate])).toEqual([
            [scheduled, "2026-10-11"],
            [sung, "2026-09-27"],
        ]);
        expect(listSongOccurrences(db, "5003")).toEqual([]);
    });
});
