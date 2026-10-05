import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { listScheduleSelections } from "@/lib/db/selections";
import { openTestDb, seedScheduleSelection } from "@/lib/db/testing";

const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/lib/db", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/db")>()),
    getDb,
}));

import {
    CUSTOM_TEXT_MAX_LENGTH,
    SELECTION_NOT_SAVED_MESSAGE,
    getScheduleSelections,
    saveScheduleSelection,
} from "./selections";

const PLAN = "81234567";
const T0 = new Date("2026-10-04T12:00:00.000Z");
const T1 = new Date("2026-10-04T12:01:00.000Z");

let db: DatabaseSync;

beforeEach(() => {
    db = openTestDb();
    getDb.mockReturnValue(db);
});

afterEach(() => {
    db.close();
    getDb.mockReset();
});

/** The plan's stored rows, as [item, option, custom text]. */
function stored(planId = PLAN) {
    return listScheduleSelections(db, planId).map(({ itemId, option, customText }) => [
        itemId,
        option,
        customText,
    ]);
}

describe("saveScheduleSelection", () => {
    test("saves each option, keeping custom text as typed only with Custom", () => {
        expect(saveScheduleSelection(PLAN, "1", "numbers", undefined, T0)).toEqual({ ok: true });
        expect(saveScheduleSelection(PLAN, "2", "blank", "left over", T0)).toEqual({ ok: true });
        expect(saveScheduleSelection(PLAN, "3", "custom", " vv. 1, 4 ", T0)).toEqual({ ok: true });
        expect(saveScheduleSelection(PLAN, "4", "custom", undefined, T0)).toEqual({ ok: true });
        expect(stored()).toEqual([
            ["1", "numbers", null],
            ["2", "blank", null],
            ["3", "custom", " vv. 1, 4 "],
            ["4", "custom", ""],
        ]);
        expect(listScheduleSelections(db, PLAN)[0].updatedAt).toBe(T0.toISOString());
    });

    test("replaces the choice saved before", () => {
        saveScheduleSelection(PLAN, "1", "custom", "x", T0);
        saveScheduleSelection(PLAN, "1", "numbers", undefined, T1);
        expect(listScheduleSelections(db, PLAN)).toEqual([
            { planId: PLAN, itemId: "1", option: "numbers", customText: null, updatedAt: T1.toISOString() },
        ]);
    });

    test("refuses ids that are not Planning Center ids, and saves nothing", () => {
        for (const [planId, itemId] of [
            ["x", "1"],
            [PLAN, "01"],
            ["", "1"],
            [PLAN, "../1"],
        ]) {
            expect(saveScheduleSelection(planId, itemId, "numbers")).toEqual({
                ok: false,
                message: SELECTION_NOT_SAVED_MESSAGE,
            });
        }
        expect(db.prepare("SELECT count(*) AS n FROM schedule_selections").get()).toEqual({ n: 0 });
    });

    test("refuses an option that is not one of the three, and custom text that is not text", () => {
        for (const option of ["version", "Numbers", "", null, undefined, 1]) {
            expect(saveScheduleSelection(PLAN, "1", option)).toEqual({
                ok: false,
                message: SELECTION_NOT_SAVED_MESSAGE,
            });
        }
        expect(saveScheduleSelection(PLAN, "1", "custom", 42)).toEqual({
            ok: false,
            message: SELECTION_NOT_SAVED_MESSAGE,
        });
        expect(stored()).toEqual([]);
    });

    test(`takes custom text of up to ${CUSTOM_TEXT_MAX_LENGTH} characters`, () => {
        expect(saveScheduleSelection(PLAN, "1", "custom", "x".repeat(CUSTOM_TEXT_MAX_LENGTH))).toEqual({
            ok: true,
        });
        expect(saveScheduleSelection(PLAN, "2", "custom", "x".repeat(CUSTOM_TEXT_MAX_LENGTH + 1))).toEqual({
            ok: false,
            message: `Custom text is at most ${CUSTOM_TEXT_MAX_LENGTH} characters.`,
        });
        expect(stored().map(([itemId]) => itemId)).toEqual(["1"]);
    });

    test("does not care how long the text is for an option that drops it", () => {
        expect(saveScheduleSelection(PLAN, "1", "blank", "x".repeat(CUSTOM_TEXT_MAX_LENGTH + 1))).toEqual({
            ok: true,
        });
    });

    test("throws when the database cannot be written", () => {
        const cause = new Error("Could not open the database at /srv/data/x: denied");
        getDb.mockImplementation(() => {
            throw cause;
        });
        expect(() => saveScheduleSelection(PLAN, "1", "numbers")).toThrow(cause);
    });
});

describe("getScheduleSelections", () => {
    test("gives the plan's choices by item id, Custom with its text", () => {
        seedScheduleSelection(db, { planId: PLAN, itemId: "1", option: "numbers" });
        seedScheduleSelection(db, { planId: PLAN, itemId: "2", option: "custom", customText: "v. 3" });
        seedScheduleSelection(db, { planId: PLAN, itemId: "3", option: "custom", customText: null });
        seedScheduleSelection(db, { planId: PLAN, itemId: "4", option: "blank" });
        seedScheduleSelection(db, { planId: "999", itemId: "1", option: "blank" });
        expect(getScheduleSelections(PLAN)).toEqual({
            "1": { option: "numbers" },
            "2": { option: "custom", customText: "v. 3" },
            "3": { option: "custom", customText: "" },
            "4": { option: "blank" },
        });
    });

    test("leaves out a choice a newer build saved", () => {
        seedScheduleSelection(db, { planId: PLAN, itemId: "1", option: "newer-option" });
        expect(getScheduleSelections(PLAN)).toEqual({});
    });

    test("gives nothing for an id that is not a Planning Center id, without asking", () => {
        const prepare = vi.spyOn(db, "prepare");
        expect(getScheduleSelections("01")).toEqual({});
        expect(prepare).not.toHaveBeenCalled();
    });

    test("throws when the database cannot be read", () => {
        const cause = new Error("Could not open the database at /srv/data/x: denied");
        getDb.mockImplementation(() => {
            throw cause;
        });
        expect(() => getScheduleSelections(PLAN)).toThrow(cause);
    });
});
