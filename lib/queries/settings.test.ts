import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { listStoredSettings } from "@/lib/db/settings";
import { openTestDb, seedSetting, seedWriteLog } from "@/lib/db/testing";
import { DEFAULT_SETTINGS } from "@/lib/settings";

const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/lib/db", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/db")>()),
    getDb,
}));

import {
    INVALID_SETTINGS_MESSAGE,
    getRecentWrites,
    getSettings,
    getSettingsIssues,
    saveSettings,
} from "./settings";

const T0 = new Date("2026-10-04T12:00:00.000Z");

let db: DatabaseSync;

beforeEach(() => {
    db = openTestDb();
    getDb.mockReturnValue(db);
});

afterEach(() => {
    db.close();
    getDb.mockReset();
    vi.restoreAllMocks();
});

/** Make getDb fail as it does when the file cannot be opened. */
function breakDatabase(): Error {
    const cause = new Error("Could not open the database at /srv/data/x: denied");
    getDb.mockImplementation(() => {
        throw cause;
    });
    return cause;
}

describe("getSettings", () => {
    test("is the defaults before anything is saved", () => {
        expect(getSettings()).toEqual({ settings: DEFAULT_SETTINGS, error: null });
    });

    test("takes what is stored, and the default for a value that no longer parses", () => {
        seedSetting(db, "ccliLicenseNumber", "7654321");
        seedSetting(db, "numberSeparator", 3);
        seedSetting(db, "hymnNoteIncludesTune", true);
        expect(getSettings()).toEqual({
            settings: { ...DEFAULT_SETTINGS, ccliLicenseNumber: "7654321", hymnNoteIncludesTune: true },
            error: null,
        });
    });

    test("never throws: without a database it logs and gives the defaults, and why", () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        const cause = breakDatabase();
        expect(getSettings()).toEqual({
            settings: DEFAULT_SETTINGS,
            error: "Could not open the database at /srv/data/x: denied",
        });
        expect(consoleError).toHaveBeenCalledWith(
            "Settings unavailable, so the defaults are in use:",
            cause
        );
    });

    test("asks one query", () => {
        const prepare = vi.spyOn(db, "prepare");
        getSettings();
        expect(prepare).toHaveBeenCalledTimes(1);
    });
});

describe("getSettingsIssues", () => {
    test("lists the stored values that no longer parse", () => {
        seedSetting(db, "ccliLicenseNumber", "CCLI 1");
        seedSetting(db, "numberSeparator", ", ");
        seedSetting(db, "reportPeriod", 1);
        expect(getSettingsIssues()).toEqual([
            {
                key: "ccliLicenseNumber",
                stored: '"CCLI 1"',
                message: "A CCLI license number is digits only, at most 20 of them, such as 1564484.",
            },
        ]);
    });

    test("never throws: without a database it logs and lists none", () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        breakDatabase();
        expect(getSettingsIssues()).toEqual([]);
    });
});

describe("saveSettings", () => {
    test("saves each value as it parses, and says which", () => {
        expect(
            saveSettings(
                {
                    ccliLicenseNumber: " 7654321 ",
                    numberSeparator: ", ",
                    scheduleHeaderLabels: { "1405391": " Morning Worship ", "1486055": "" },
                    hymnNoteCategoryName: " Hymn Numbers ",
                    hymnNoteIncludesTune: true,
                },
                T0
            )
        ).toEqual({
            ok: true,
            saved: [
                "ccliLicenseNumber",
                "numberSeparator",
                "scheduleHeaderLabels",
                "hymnNoteCategoryName",
                "hymnNoteIncludesTune",
            ],
        });
        expect(getSettings().settings).toEqual({
            ccliLicenseNumber: "7654321",
            numberSeparator: ", ",
            scheduleHeaderLabels: { "1405391": "Morning Worship", "1486055": "" },
            hymnNoteCategoryName: "Hymn Numbers",
            hymnNoteIncludesTune: true,
            creditRoles: DEFAULT_SETTINGS.creditRoles,
            creditPhrases: DEFAULT_SETTINGS.creditPhrases,
            emailRecipients: DEFAULT_SETTINGS.emailRecipients,
            emailSubjectTemplate: DEFAULT_SETTINGS.emailSubjectTemplate,
        });
        expect(listStoredSettings(db)[0]).toMatchObject({ updatedAt: T0.toISOString() });
    });

    test("saves the credit and email settings, lists and phrases included, as they parse", () => {
        expect(
            saveSettings({
                creditRoles: ["Words", "Music", " Descant "],
                creditPhrases: { Words: "Text by", "Words&Music": "Text and tune by" },
                emailRecipients: [" pastor@example.org "],
                emailSubjectTemplate: " {service}: {date} ",
            })
        ).toEqual({
            ok: true,
            saved: ["creditRoles", "creditPhrases", "emailRecipients", "emailSubjectTemplate"],
        });
        expect(getSettings().settings).toMatchObject({
            creditRoles: ["Words", "Music", "Descant"],
            creditPhrases: { Words: "Text by", "Words & Music": "Text and tune by" },
            emailRecipients: ["pastor@example.org"],
            emailSubjectTemplate: "{service}: {date}",
        });
        expect(getSettingsIssues()).toEqual([]);
    });

    test("refuses every invalid value at once, each by its key, and saves nothing", () => {
        expect(
            saveSettings({ ccliLicenseNumber: "", numberSeparator: ", ", hymnNoteIncludesTune: "on" })
        ).toEqual({
            ok: false,
            message: INVALID_SETTINGS_MESSAGE,
            fieldErrors: {
                ccliLicenseNumber: "Enter the CCLI license number.",
                hymnNoteIncludesTune: "Whether the note names the tune must be yes or no.",
            },
        });
        expect(listStoredSettings(db)).toEqual([]);
    });

    test("refuses a key that is not a setting, and saves nothing", () => {
        expect(saveSettings({ numberSeparator: ", ", reportPeriod: "weekly" })).toEqual({
            ok: false,
            message: 'There is no setting named "reportPeriod", so nothing was saved.',
            fieldErrors: {},
        });
        expect(listStoredSettings(db)).toEqual([]);
    });

    test("leaves the settings it is not given as they were", () => {
        saveSettings({ ccliLicenseNumber: "1", numberSeparator: ", " });
        saveSettings({ ccliLicenseNumber: "2" });
        expect(getSettings().settings).toMatchObject({ ccliLicenseNumber: "2", numberSeparator: ", " });
    });

    test("with nothing to save, saves nothing and does not need the database", () => {
        breakDatabase();
        expect(saveSettings({})).toEqual({ ok: true, saved: [] });
    });

    test("throws when the database cannot be written", () => {
        const cause = breakDatabase();
        expect(() => saveSettings({ ccliLicenseNumber: "1" })).toThrow(cause);
    });
});

describe("getRecentWrites", () => {
    test("gives the latest writes, newest first", () => {
        const first = seedWriteLog(db, { target: "plan 1 item 1" });
        const second = seedWriteLog(db, { target: "plan 1 item 2", ok: false });
        const result = getRecentWrites();
        expect(result.ok && result.writes.map(({ id, ok }) => [id, ok])).toEqual([
            [second, false],
            [first, true],
        ]);
    });

    test("lists 20 by default", () => {
        for (let i = 0; i < 25; i++) {
            seedWriteLog(db);
        }
        const result = getRecentWrites();
        expect(result.ok && result.writes).toHaveLength(20);
    });

    test("never throws: without a database it logs and says why", () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        breakDatabase();
        expect(getRecentWrites()).toEqual({
            ok: false,
            error: "Could not open the database at /srv/data/x: denied",
        });
    });
});
