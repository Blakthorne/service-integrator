import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
    SCHEDULE_OPTIONS,
    isScheduleOption,
    listScheduleSelections,
    upsertScheduleSelection,
} from "./selections";
import { openTestDb, seedScheduleSelection } from "./testing";

const T0 = new Date("2026-10-04T12:00:00.000Z");
const T1 = new Date("2026-10-04T12:05:00.000Z");

let db: DatabaseSync;

beforeEach(() => {
    db = openTestDb();
});

afterEach(() => {
    db.close();
});

describe("isScheduleOption", () => {
    test("accepts the three options only", () => {
        expect(SCHEDULE_OPTIONS).toEqual(["numbers", "blank", "custom"]);
        for (const option of SCHEDULE_OPTIONS) {
            expect(isScheduleOption(option)).toBe(true);
        }
        for (const value of ["Numbers", "version", "", null, undefined, 0]) {
            expect(isScheduleOption(value)).toBe(false);
        }
    });
});

describe("upsertScheduleSelection", () => {
    test("saves a choice for an item of a plan", () => {
        upsertScheduleSelection(db, { planId: "10", itemId: "1", option: "blank", customText: null }, T0);
        expect(listScheduleSelections(db, "10")).toEqual([
            { planId: "10", itemId: "1", option: "blank", customText: null, updatedAt: T0.toISOString() },
        ]);
    });

    test("replaces the choice saved before for the same item", () => {
        upsertScheduleSelection(db, { planId: "10", itemId: "1", option: "numbers", customText: null }, T0);
        upsertScheduleSelection(db, { planId: "10", itemId: "1", option: "custom", customText: "vv. 1, 4" }, T1);
        expect(listScheduleSelections(db, "10")).toEqual([
            { planId: "10", itemId: "1", option: "custom", customText: "vv. 1, 4", updatedAt: T1.toISOString() },
        ]);
    });

    test("keeps custom text only with Custom, as typed", () => {
        upsertScheduleSelection(db, { planId: "10", itemId: "1", option: "custom", customText: "  R-12, v. 3 " }, T0);
        upsertScheduleSelection(db, { planId: "10", itemId: "2", option: "custom", customText: "" }, T0);
        upsertScheduleSelection(db, { planId: "10", itemId: "3", option: "numbers", customText: "dropped" }, T0);
        upsertScheduleSelection(db, { planId: "10", itemId: "4", option: "blank", customText: "dropped" }, T0);
        expect(
            listScheduleSelections(db, "10").map(({ itemId, option, customText }) => [itemId, option, customText])
        ).toEqual([
            ["1", "custom", "  R-12, v. 3 "],
            ["2", "custom", ""],
            ["3", "numbers", null],
            ["4", "blank", null],
        ]);
    });

    test("refuses an option it does not know, and an id that is not a Planning Center id", () => {
        expect(() =>
            upsertScheduleSelection(db, {
                planId: "10",
                itemId: "1",
                option: "version" as "numbers",
                customText: null,
            })
        ).toThrow('Unknown schedule option: "version"');
        expect(() =>
            upsertScheduleSelection(db, { planId: "10", itemId: "01", option: "numbers", customText: null })
        ).toThrow(/CHECK constraint failed/);
        expect(listScheduleSelections(db, "10")).toEqual([]);
    });
});

describe("listScheduleSelections", () => {
    test("gives one plan's choices, not another's", () => {
        seedScheduleSelection(db, { planId: "10", itemId: "1" });
        seedScheduleSelection(db, { planId: "10", itemId: "2", option: "blank" });
        seedScheduleSelection(db, { planId: "20", itemId: "1", option: "custom", customText: "x" });
        expect(listScheduleSelections(db, "10").map(({ itemId, option }) => [itemId, option])).toEqual([
            ["1", "numbers"],
            ["2", "blank"],
        ]);
        expect(listScheduleSelections(db, "30")).toEqual([]);
    });

    test("skips a choice whose option a newer build wrote, and leaves it stored", () => {
        seedScheduleSelection(db, { planId: "10", itemId: "1", option: "newer-option" });
        seedScheduleSelection(db, { planId: "10", itemId: "2", option: "custom", customText: "x" });
        expect(listScheduleSelections(db, "10").map(({ itemId }) => itemId)).toEqual(["2"]);
        expect(
            db.prepare("SELECT count(*) AS n FROM schedule_selections WHERE plan_id = '10'").get()
        ).toEqual({ n: 2 });
    });
});
