import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { parsePcoId } from "@/lib/pco";
import { openTestDb } from "../testing";

let db: DatabaseSync;

beforeEach(() => {
    db = openTestDb();
});

afterEach(() => {
    db.close();
});

function columns(table: string): string[] {
    return db
        .prepare("SELECT name FROM pragma_table_info(?) ORDER BY cid")
        .all(table)
        .map((row) => String(row.name));
}

function count(table: string): number {
    return Number(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n);
}

const AT = "2026-10-04T12:00:00.000Z";

type PlanColumns = "planId" | "serviceTypeId" | "planDate" | "updatedAt" | "itemsSyncedAt";

/** List a plan, each column given or a valid default. */
function plan({
    planId = "81234567",
    serviceTypeId = "1405391",
    planDate = "2026-10-04",
    updatedAt = AT,
    itemsSyncedAt = null,
}: Partial<Record<PlanColumns, SQLInputValue>> = {}) {
    db.prepare(
        "INSERT INTO history_plans (plan_id, service_type_id, plan_date, updated_at, items_synced_at) VALUES (?, ?, ?, ?, ?)"
    ).run(planId, serviceTypeId, planDate, updatedAt, itemsSyncedAt);
}

type OccurrenceColumns =
    | "planId"
    | "itemId"
    | "pcoSongId"
    | "sequence"
    | "planDate"
    | "serviceTypeId"
    | "syncedAt";

/** Store an occurrence, each column given or a valid default. */
function occurrence({
    planId = "81234567",
    itemId = "1",
    pcoSongId = "26000001",
    sequence = 1,
    planDate = "2026-10-04",
    serviceTypeId = "1405391",
    syncedAt = AT,
}: Partial<Record<OccurrenceColumns, SQLInputValue>> = {}) {
    db.prepare(
        `INSERT INTO plan_occurrences (plan_id, item_id, pco_song_id, sequence, plan_date, service_type_id, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(planId, itemId, pcoSongId, sequence, planDate, serviceTypeId, syncedAt);
}

/** What `parsePcoId` accepts and refuses, and a few more that a loose check would let through. */
const IDS = [
    "1",
    "81234567",
    "12345678901234567890",
    "",
    "0",
    "01",
    "-1",
    "1.5",
    " 1",
    "1a",
    "../1",
    "123456789012345678901",
];

/** Whether `store` (an insert that takes `id`) is accepted, rather than refused by a CHECK. */
function accepted(store: (id: string) => void, id: string): boolean {
    try {
        store(id);
        return true;
    } catch (error) {
        if (!/CHECK constraint failed/.test(String(error))) {
            throw error;
        }
        return false;
    }
}

describe("0007_history: history_plans", () => {
    test("holds each plan with its service type, date, update time and when its items were read", () => {
        expect(columns("history_plans")).toEqual([
            "plan_id",
            "service_type_id",
            "plan_date",
            "updated_at",
            "items_synced_at",
        ]);
    });

    test("has each plan once", () => {
        plan();
        expect(() => plan({ serviceTypeId: "1486055" })).toThrow(
            /UNIQUE constraint failed: history_plans.plan_id/
        );
        plan({ planId: "81234568" });
        expect(count("history_plans")).toBe(2);
    });

    test("has not read the items of a plan until it says so", () => {
        plan();
        plan({ planId: "2", itemsSyncedAt: "2026-10-04T13:00:00.000Z" });
        expect(
            db.prepare("SELECT plan_id, items_synced_at FROM history_plans ORDER BY plan_id").all()
        ).toEqual([
            { plan_id: "2", items_synced_at: "2026-10-04T13:00:00.000Z" },
            { plan_id: "81234567", items_synced_at: null },
        ]);
    });

    test("holds a plan's and a service type's id to exactly what parsePcoId accepts", () => {
        let n = 0;
        for (const id of IDS) {
            const expected = parsePcoId(id) !== null;
            n += 1;
            expect(accepted((value) => plan({ planId: value }), id), `plan id ${JSON.stringify(id)}`).toBe(
                expected
            );
            expect(
                accepted((value) => plan({ planId: `9${n}`, serviceTypeId: value }), id),
                `service type id ${JSON.stringify(id)}`
            ).toBe(expected);
        }
    });

    test("holds a plan's date to the shape YYYY-MM-DD", () => {
        plan({ planDate: "2026-10-04" });
        for (const [i, planDate] of ["", "2026-10-4", "10/04/2026", "2026-10-04T08:00:00Z", "20261004"].entries()) {
            expect(() => plan({ planId: String(i + 2), planDate })).toThrow(/CHECK constraint failed/);
        }
    });

    test("needs a service type, a date and an update time", () => {
        for (const column of ["serviceTypeId", "planDate", "updatedAt"] as const) {
            expect(() => plan({ [column]: null })).toThrow(/NOT NULL constraint failed/);
        }
    });
});

describe("0007_history: plan_occurrences", () => {
    test("holds each song item of a plan with the song, its place, and the plan's date and service type", () => {
        expect(columns("plan_occurrences")).toEqual([
            "plan_id",
            "item_id",
            "pco_song_id",
            "sequence",
            "plan_date",
            "service_type_id",
            "synced_at",
        ]);
    });

    test("has each item of a plan once, and the same item id may be in another plan", () => {
        plan();
        plan({ planId: "81234568" });
        occurrence();
        expect(() => occurrence({ pcoSongId: "26000002" })).toThrow(
            /UNIQUE constraint failed: plan_occurrences.plan_id, plan_occurrences.item_id/
        );
        occurrence({ itemId: "2" });
        occurrence({ planId: "81234568" });
        expect(count("plan_occurrences")).toBe(3);
    });

    test("belongs to a listed plan", () => {
        expect(() => occurrence()).toThrow(/FOREIGN KEY constraint failed/);
        plan();
        occurrence();
    });

    test("goes when its plan does, and no other occurrence does", () => {
        plan();
        plan({ planId: "81234568" });
        occurrence();
        occurrence({ itemId: "2" });
        occurrence({ planId: "81234568" });
        db.prepare("DELETE FROM history_plans WHERE plan_id = ?").run("81234567");
        expect(db.prepare("SELECT plan_id FROM plan_occurrences").all()).toEqual([
            { plan_id: "81234568" },
        ]);
    });

    test("names a song the song mirror may not have yet", () => {
        plan();
        expect(count("pco_songs")).toBe(0);
        occurrence({ pcoSongId: "26000099" });
        expect(count("plan_occurrences")).toBe(1);
    });

    test("holds each id to exactly what parsePcoId accepts", () => {
        plan();
        let n = 0;
        for (const id of IDS) {
            const expected = parsePcoId(id) !== null;
            n += 1;
            expect(accepted((value) => occurrence({ itemId: value }), id), `item id ${JSON.stringify(id)}`).toBe(
                expected
            );
            expect(
                accepted((value) => occurrence({ itemId: `9${n}`, pcoSongId: value }), id),
                `song id ${JSON.stringify(id)}`
            ).toBe(expected);
            expect(
                accepted((value) => occurrence({ itemId: `8${n}`, serviceTypeId: value }), id),
                `service type id ${JSON.stringify(id)}`
            ).toBe(expected);
        }
    });

    test("holds a date to the shape YYYY-MM-DD", () => {
        plan();
        expect(() => occurrence({ planDate: "2026-10-4" })).toThrow(/CHECK constraint failed/);
        expect(() => occurrence({ planDate: "2026-10-04T08:00:00Z" })).toThrow(/CHECK constraint failed/);
    });

    test("needs a song, a sequence, a date, a service type and a time", () => {
        plan();
        for (const column of ["pcoSongId", "sequence", "planDate", "serviceTypeId", "syncedAt"] as const) {
            expect(() => occurrence({ [column]: null })).toThrow(/NOT NULL constraint failed/);
        }
    });

    test("is indexed by song and by date", () => {
        const indexes = db
            .prepare("SELECT name FROM pragma_index_list('plan_occurrences') WHERE origin = 'c' ORDER BY name")
            .all()
            .map((row) => String(row.name));
        expect(indexes).toEqual(["plan_occurrences_pco_song_id", "plan_occurrences_plan_date"]);
        const indexed = (name: string) =>
            db
                .prepare("SELECT name FROM pragma_index_info(?)")
                .all(name)
                .map((row) => String(row.name));
        expect(indexed("plan_occurrences_pco_song_id")).toEqual(["pco_song_id"]);
        expect(indexed("plan_occurrences_plan_date")).toEqual(["plan_date"]);
    });
});
