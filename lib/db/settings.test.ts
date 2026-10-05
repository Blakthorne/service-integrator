import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { listStoredSettings, writeSettings } from "./settings";
import { openTestDb, seedSetting } from "./testing";

const T0 = new Date("2026-10-04T12:00:00.000Z");
const T1 = new Date("2026-10-04T13:00:00.000Z");

let db: DatabaseSync;

beforeEach(() => {
    db = openTestDb();
});

afterEach(() => {
    db.close();
});

describe("listStoredSettings", () => {
    test("is empty before anything is saved", () => {
        expect(listStoredSettings(db)).toEqual([]);
    });

    test("gives every stored row by key, as JSON text, keys this build does not know included", () => {
        seedSetting(db, "numberSeparator", ", ");
        seedSetting(db, "creditRoles", ["Words", "Music"]);
        seedSetting(db, "ccliLicenseNumber", "7654321", T1.toISOString());
        expect(listStoredSettings(db)).toEqual([
            { key: "ccliLicenseNumber", value: '"7654321"', updatedAt: T1.toISOString() },
            { key: "creditRoles", value: '["Words","Music"]', updatedAt: T0.toISOString() },
            { key: "numberSeparator", value: '", "', updatedAt: T0.toISOString() },
        ]);
    });
});

describe("writeSettings", () => {
    test("stores each value as JSON under its key", () => {
        writeSettings(
            db,
            { ccliLicenseNumber: "7654321", hymnNoteIncludesTune: true, scheduleHeaderLabels: { "1": "AM" } },
            T0
        );
        expect(listStoredSettings(db)).toEqual([
            { key: "ccliLicenseNumber", value: '"7654321"', updatedAt: T0.toISOString() },
            { key: "hymnNoteIncludesTune", value: "true", updatedAt: T0.toISOString() },
            { key: "scheduleHeaderLabels", value: '{"1":"AM"}', updatedAt: T0.toISOString() },
        ]);
    });

    test("replaces what was stored, and leaves the other keys alone", () => {
        writeSettings(db, { ccliLicenseNumber: "1", numberSeparator: ", " }, T0);
        writeSettings(db, { ccliLicenseNumber: "2" }, T1);
        expect(listStoredSettings(db)).toEqual([
            { key: "ccliLicenseNumber", value: '"2"', updatedAt: T1.toISOString() },
            { key: "numberSeparator", value: '", "', updatedAt: T0.toISOString() },
        ]);
    });

    test("writes all or nothing: a value JSON cannot hold refuses the lot", () => {
        expect(() =>
            writeSettings(db, { ccliLicenseNumber: "1", numberSeparator: undefined }, T0)
        ).toThrow('Setting "numberSeparator" must be JSON-serializable');
        expect(listStoredSettings(db)).toEqual([]);
    });

    test("does nothing with no values", () => {
        writeSettings(db, {}, T0);
        expect(listStoredSettings(db)).toEqual([]);
    });
});
