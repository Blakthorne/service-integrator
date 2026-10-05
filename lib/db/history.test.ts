import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
    bookCoverage,
    countHistory,
    countSongsSung,
    deleteHistoryPlan,
    deleteUnlistedPlans,
    listHistoryPlans,
    listOccurrences,
    lastPastOccurrences,
    listSongOccurrences,
    replacePlanOccurrences,
    upsertListedPlans,
    type ListedPlan,
} from "./history";
import {
    openTestDb,
    seedBook,
    seedEntry,
    seedHistoryPlan,
    seedHymn,
    seedOccurrence,
    seedSong,
} from "./testing";

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

describe("bookCoverage", () => {
    const TODAY = "2026-10-04";
    const SINCE = "2021-10-04";

    /** A catalog song linked to Planning Center song `pcoSongId` (or none), sung on each of `dates`. */
    function song(pcoSongId: string | null, dates: string[] = []): number {
        for (const date of dates) {
            seedOccurrence(db, { planId: seedHistoryPlan(db, { planDate: date }), pcoSongId: pcoSongId! });
        }
        return seedSong(db, { hymnId: seedHymn(db), pcoSongId });
    }

    test("is empty without books, and zero for a book with no entries", () => {
        expect(bookCoverage(db, SINCE, TODAY)).toEqual([]);
        const book = seedBook(db, { code: "R", name: "Rejoice Hymns", shortName: "Rejoice" });
        expect(bookCoverage(db, SINCE, TODAY)).toEqual([
            { bookId: book, code: "R", name: "Rejoice Hymns", shortName: "Rejoice", entries: 0, sungRecently: 0, sungEver: 0 },
        ]);
    });

    test("counts the entries whose song was sung in the period, and ever, in each active book in book order", () => {
        const great = seedBook(db, { code: "G", name: "Great Hymns", sortOrder: 2 });
        const rejoice = seedBook(db, { code: "R", name: "Rejoice Hymns", sortOrder: 1 });
        const inactive = seedBook(db, { code: "X", name: "Old Book", sortOrder: 3, active: false });
        const sungLately = song("1001", ["2026-09-27", "2025-01-05"]);
        const sungLongAgo = song("1002", ["2019-01-06"]);
        const onlyScheduled = song("1003", ["2026-10-04", "2026-10-11"]);
        const neverSung = song("1004");
        const notLinked = song(null);
        for (const songId of [sungLately, sungLongAgo, onlyScheduled, neverSung, notLinked]) {
            seedEntry(db, { bookId: rejoice, songId });
        }
        seedEntry(db, { bookId: great, songId: sungLately });
        seedEntry(db, { bookId: inactive, songId: sungLately });

        expect(bookCoverage(db, SINCE, TODAY).map(({ code, entries, sungRecently, sungEver }) => [code, entries, sungRecently, sungEver])).toEqual([
            ["R", 5, 1, 2],
            ["G", 1, 1, 1],
        ]);
    });

    test("counts a song's entries in a book each, its variants included", () => {
        const book = seedBook(db, { code: "R" });
        const songId = song("1001", ["2026-09-27"]);
        seedEntry(db, { bookId: book, songId, number: 108 });
        seedEntry(db, { bookId: book, songId, number: 109, variantNote: "Descant" });
        expect(bookCoverage(db, SINCE, TODAY)[0]).toMatchObject({ entries: 2, sungRecently: 2, sungEver: 2 });
    });

    test("starts the period on the day given, and counts only plans before today", () => {
        const book = seedBook(db, { code: "R" });
        seedEntry(db, { bookId: book, songId: song("1001", ["2021-10-04"]) });
        seedEntry(db, { bookId: book, songId: song("1002", ["2021-10-03"]) });
        seedEntry(db, { bookId: book, songId: song("1003", ["2026-10-03"]) });
        seedEntry(db, { bookId: book, songId: song("1004", ["2026-10-04"]) });

        expect(bookCoverage(db, SINCE, TODAY)[0]).toMatchObject({ entries: 4, sungRecently: 2, sungEver: 3 });
        // A day later, today's plan has been sung.
        expect(bookCoverage(db, SINCE, "2026-10-05")[0]).toMatchObject({ sungRecently: 3, sungEver: 4 });
    });

    test("counts an entry once however often its song was sung", () => {
        const book = seedBook(db, { code: "R" });
        seedEntry(db, { bookId: book, songId: song("1001", ["2026-09-27", "2026-09-20", "2026-09-13"]) });
        expect(bookCoverage(db, SINCE, TODAY)[0]).toMatchObject({ entries: 1, sungRecently: 1, sungEver: 1 });
    });

    test("counts the entry of a linked song that is in no plan as never sung", () => {
        const book = seedBook(db, { code: "R" });
        seedEntry(db, { bookId: book, songId: song("1001") });
        expect(bookCoverage(db, SINCE, TODAY)[0]).toMatchObject({ entries: 1, sungRecently: 0, sungEver: 0 });
    });
});

describe("countSongsSung", () => {
    test("counts the different songs sung in past plans from the date, up to yesterday", () => {
        const sing = (pcoSongId: string, planDate: string) =>
            seedOccurrence(db, { planId: seedHistoryPlan(db, { planDate }), pcoSongId });
        sing("1001", "2026-01-01");
        sing("1001", "2026-09-27");
        sing("1002", "2026-09-27");
        sing("1003", "2025-12-31");
        sing("1004", "2026-10-04");
        sing("1005", "2026-10-11");
        sing("1006", "2026-10-03");

        expect(countSongsSung(db, "2026-01-01", "2026-10-04")).toBe(3);
        expect(countSongsSung(db, "2026-01-02", "2026-10-04")).toBe(3);
        expect(countSongsSung(db, "2026-09-28", "2026-10-04")).toBe(1);
        expect(countSongsSung(db, "2026-01-01", "2026-10-05")).toBe(4);
        expect(countSongsSung(db, "2020-01-01", "2026-10-04")).toBe(4);
    });

    test("is zero for a history never synced", () => {
        expect(countSongsSung(db, "2026-01-01", "2026-10-04")).toBe(0);
    });
});

describe("lastPastOccurrences", () => {
    const TODAY = "2026-10-04";
    const FROM = "2026-08-23";

    function sing(pcoSongId: string, planDate: string, planId?: string, serviceTypeId = MORNING): string {
        const id = seedHistoryPlan(db, { planDate, serviceTypeId, ...(planId === undefined ? {} : { planId }) });
        seedOccurrence(db, { planId: id, pcoSongId });
        return id;
    }

    test("gives each song the latest past plan it was in, as a map by song id", () => {
        sing("5001", "2026-09-06");
        const latest = sing("5001", "2026-09-27", undefined, EVENING);
        sing("5001", "2026-09-20");
        const other = sing("5002", "2026-09-13");
        sing("5003", "2026-01-01");

        expect(lastPastOccurrences(db, ["5001", "5002", "5003", "5004"], { from: FROM, today: TODAY })).toEqual(
            new Map([
                ["5001", { pcoSongId: "5001", planId: latest, serviceTypeId: EVENING, planDate: "2026-09-27" }],
                ["5002", { pcoSongId: "5002", planId: other, serviceTypeId: MORNING, planDate: "2026-09-13" }],
            ])
        );
    });

    test("leaves out a plan dated today or later, and one dated before the window, and counts the first day of it", () => {
        sing("5001", "2026-10-04");
        sing("5001", "2026-10-11");
        sing("5002", "2026-08-22");
        const onTheFirstDay = sing("5003", "2026-08-23");

        const latest = lastPastOccurrences(db, ["5001", "5002", "5003"], { from: FROM, today: TODAY });
        expect([...latest.keys()]).toEqual(["5003"]);
        expect(latest.get("5003")?.planId).toBe(onTheFirstDay);
    });

    test("leaves out the plan it is asked to, and gives the one before it", () => {
        const before = sing("5001", "2026-09-20");
        const excluded = sing("5001", "2026-09-27");

        expect(lastPastOccurrences(db, ["5001"], { from: FROM, today: TODAY }).get("5001")?.planId).toBe(excluded);
        expect(
            lastPastOccurrences(db, ["5001"], { from: FROM, today: TODAY, excludePlanId: excluded }).get("5001")?.planId
        ).toBe(before);
        expect(
            lastPastOccurrences(db, ["5001"], { from: FROM, today: TODAY, excludePlanId: before }).get("5001")?.planId
        ).toBe(excluded);
    });

    test("gives the plan with the greater id when two share the latest date, numerically", () => {
        sing("5001", "2026-09-27", "99");
        sing("5001", "2026-09-27", "100");
        expect(lastPastOccurrences(db, ["5001"], { from: FROM, today: TODAY }).get("5001")?.planId).toBe("100");
    });

    test("gives a song in a plan twice once, and asks for no song at no cost", () => {
        const planId = sing("5001", "2026-09-27");
        seedOccurrence(db, { planId, pcoSongId: "5001" });
        expect(lastPastOccurrences(db, ["5001", "5001"], { from: FROM, today: TODAY }).size).toBe(1);
        expect(lastPastOccurrences(db, [], { from: FROM, today: TODAY }).size).toBe(0);
    });

    test("asks one query", () => {
        sing("5001", "2026-09-27");
        const prepare = vi.spyOn(db, "prepare");
        lastPastOccurrences(db, ["5001", "5002"], { from: FROM, today: TODAY });
        expect(prepare).toHaveBeenCalledTimes(1);
    });
});
