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

const AT = "2026-10-04T12:00:00.000Z";

/** Save a choice with only the columns that must be given. */
function select(
    planId: SQLInputValue,
    itemId: SQLInputValue,
    option: SQLInputValue = "numbers",
    updatedAt: SQLInputValue = AT
) {
    db.prepare(
        "INSERT INTO schedule_selections (plan_id, item_id, option, updated_at) VALUES (?, ?, ?, ?)"
    ).run(planId, itemId, option, updatedAt);
}

/** Log a write, each column given or a valid default. */
function log({
    at = AT,
    kind = "item-note",
    target = "plan 1 item 2",
    ok = 1,
    payload = "{}",
    result = "{}",
}: Partial<Record<"at" | "kind" | "target" | "ok" | "payload" | "result", SQLInputValue>> = {}) {
    db.prepare(
        "INSERT INTO write_log (at, kind, target, ok, payload, result) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(at, kind, target, ok, payload, result);
}

describe("0004_selections: schedule_selections", () => {
    test("holds a plan's choice for each song item", () => {
        expect(columns("schedule_selections")).toEqual([
            "plan_id",
            "item_id",
            "option",
            "custom_text",
            "updated_at",
        ]);
    });

    test("has one choice per item of a plan", () => {
        select("1", "2");
        select("1", "3");
        select("4", "2");
        expect(() => select("1", "2", "blank")).toThrow(
            /UNIQUE constraint failed: schedule_selections.plan_id, schedule_selections.item_id/
        );
    });

    test("plan and item ids are exactly what parsePcoId accepts", () => {
        const ids = ["1", "81234567", "12345678901234567890", "", "0", "01", "-1", "1.5", " 1", "1a", "../1", "123456789012345678901"];
        for (const id of ids) {
            for (const [planId, itemId] of [
                [id, "7"],
                ["7", id],
            ]) {
                let stored = true;
                try {
                    select(planId, itemId);
                } catch (error) {
                    expect(String(error)).toMatch(/CHECK constraint failed/);
                    stored = false;
                }
                expect([planId, itemId, stored]).toEqual([planId, itemId, parsePcoId(id) !== null]);
                db.prepare("DELETE FROM schedule_selections").run();
            }
        }
    });

    test("an option and the time it was saved are required; the option is not checked here", () => {
        expect(() => select("1", "2", null)).toThrow(
            /NOT NULL constraint failed: schedule_selections.option/
        );
        expect(() => select("1", "2", "numbers", null)).toThrow(
            /NOT NULL constraint failed: schedule_selections.updated_at/
        );
        // A newer build's option is stored; readers skip it (lib/db/selections.ts).
        select("1", "2", "newer-option");
    });
});

describe("0004_selections: write_log", () => {
    test("records each write with what was asked for and what came of it", () => {
        expect(columns("write_log")).toEqual([
            "id",
            "at",
            "kind",
            "target",
            "ok",
            "payload",
            "result",
        ]);
    });

    test("ok is 0 or 1", () => {
        log({ ok: 0 });
        log({ ok: 1 });
        expect(() => log({ ok: 2 })).toThrow(/CHECK constraint failed/);
        expect(() => log({ ok: null })).toThrow(/NOT NULL constraint failed: write_log.ok/);
    });

    test("payload and result must be JSON", () => {
        log({ payload: '{"content":"R-396"}', result: '{"error":"must exist"}' });
        expect(() => log({ payload: "not json" })).toThrow(/CHECK constraint failed/);
        expect(() => log({ result: "{oops" })).toThrow(/CHECK constraint failed/);
        expect(() => log({ payload: null })).toThrow(/NOT NULL constraint failed: write_log.payload/);
        expect(() => log({ result: null })).toThrow(/NOT NULL constraint failed: write_log.result/);
    });

    test("every column but the id is required, and the kind is not checked here", () => {
        for (const column of ["at", "kind", "target"] as const) {
            expect(() => log({ [column]: null })).toThrow(
                new RegExp(`NOT NULL constraint failed: write_log.${column}`)
            );
        }
        log({ kind: "newer-kind" });
    });
});
