import { describe, expect, test } from "vitest";
import { parsePcoId } from "@/lib/pco";
import {
    CATEGORY_NAME_MAX_LENGTH,
    DEFAULT_SETTINGS,
    HEADER_LABEL_MAX_LENGTH,
    NUMBER_SEPARATOR_MAX_LENGTH,
    SETTINGS,
    SETTING_KEYS,
    defaultScheduleHeaderLabel,
    isSettingKey,
    parseHeaderLabel,
    parseSetting,
    planTextSettings,
    resolveSettings,
    scheduleHeaderLabel,
    type SettingKey,
} from "./settings";

const MORNING = { id: "1405391", name: "Sunday Morning" };
const EVENING = { id: "1486055", name: "Sunday Evening" };
const MIDWEEK = { id: "1500000", name: "Midweek" };

/** The value a parse gives, or its message. */
function parsed(key: SettingKey, value: unknown): unknown {
    const result = parseSetting(key, value);
    return result.ok ? { value: result.value } : { message: result.message };
}

function refused(key: SettingKey, value: unknown): boolean {
    return !parseSetting(key, value).ok;
}

describe("the registry", () => {
    test("has the phase 3 keys, each with a default and a parser", () => {
        expect(SETTING_KEYS).toEqual([
            "ccliLicenseNumber",
            "scheduleHeaderLabels",
            "numberSeparator",
            "hymnNoteCategoryName",
            "hymnNoteIncludesTune",
        ]);
        for (const key of SETTING_KEYS) {
            expect(SETTINGS[key].defaultValue).toEqual(DEFAULT_SETTINGS[key]);
        }
    });

    test("the defaults reproduce the text as it was before settings", () => {
        expect(DEFAULT_SETTINGS).toEqual({
            ccliLicenseNumber: "1564484",
            scheduleHeaderLabels: {},
            numberSeparator: " / ",
            hymnNoteCategoryName: "Hymnal",
            hymnNoteIncludesTune: false,
        });
    });

    test("every default parses as itself", () => {
        for (const key of SETTING_KEYS) {
            expect(parsed(key, DEFAULT_SETTINGS[key])).toEqual({ value: DEFAULT_SETTINGS[key] });
        }
    });

    test("the defaults cannot be changed by accident", () => {
        expect(Object.isFrozen(DEFAULT_SETTINGS)).toBe(true);
        expect(Object.isFrozen(DEFAULT_SETTINGS.scheduleHeaderLabels)).toBe(true);
    });

    test("isSettingKey knows the keys and nothing else", () => {
        for (const key of SETTING_KEYS) {
            expect(isSettingKey(key)).toBe(true);
        }
        for (const value of ["creditRoles", "constructor", "__proto__", "toString", "", null, 1]) {
            expect(isSettingKey(value)).toBe(false);
        }
    });
});

describe("ccliLicenseNumber", () => {
    test("is the digits, trimmed", () => {
        expect(parsed("ccliLicenseNumber", "1564484")).toEqual({ value: "1564484" });
        expect(parsed("ccliLicenseNumber", "  7654321 ")).toEqual({ value: "7654321" });
        expect(parsed("ccliLicenseNumber", "1".repeat(20))).toEqual({ value: "1".repeat(20) });
    });

    test("refuses anything but digits, and a number that is not text", () => {
        for (const value of ["", "   ", "CCLI 1564484", "1564-484", "1.5", "-1", "1".repeat(21), 1564484, null, undefined]) {
            expect(refused("ccliLicenseNumber", value)).toBe(true);
        }
        expect(parsed("ccliLicenseNumber", "")).toEqual({ message: "Enter the CCLI license number." });
    });
});

describe("scheduleHeaderLabels", () => {
    test("is a trimmed label for each service type id; an empty label means no header", () => {
        expect(
            parsed("scheduleHeaderLabels", { [MORNING.id]: " Morning Worship ", [EVENING.id]: "" })
        ).toEqual({ value: { [MORNING.id]: "Morning Worship", [EVENING.id]: "" } });
        expect(parsed("scheduleHeaderLabels", {})).toEqual({ value: {} });
    });

    test("refuses a key that is not a service type id, exactly as parsePcoId does", () => {
        for (const id of ["1405391", "0", "01", "x", "", " 1", "1".repeat(20), "1".repeat(21), "__proto__"]) {
            expect([id, refused("scheduleHeaderLabels", { [id]: "Label" })]).toEqual([
                id,
                parsePcoId(id) === null,
            ]);
        }
    });

    test("refuses a label that is not text, spans lines, or is too long", () => {
        for (const label of [1, null, ["Sunday AM"], "Sunday\nAM", "Sunday\tAM", "x".repeat(HEADER_LABEL_MAX_LENGTH + 1)]) {
            expect(refused("scheduleHeaderLabels", { [MORNING.id]: label })).toBe(true);
        }
        expect(parsed("scheduleHeaderLabels", { [MORNING.id]: "x".repeat(HEADER_LABEL_MAX_LENGTH) })).toEqual({
            value: { [MORNING.id]: "x".repeat(HEADER_LABEL_MAX_LENGTH) },
        });
    });

    test("refuses anything but an object", () => {
        for (const value of [null, [], "Sunday AM", 1, true]) {
            expect(refused("scheduleHeaderLabels", value)).toBe(true);
        }
    });

    test("parseHeaderLabel checks one label the same way", () => {
        expect(parseHeaderLabel("  Sunday AM ")).toEqual({ ok: true, value: "Sunday AM" });
        expect(parseHeaderLabel("")).toEqual({ ok: true, value: "" });
        // A C1 control character, such as NEXT LINE, is a line break too.
        expect(parseHeaderLabel(`a${String.fromCharCode(0x85)}b`).ok).toBe(false);
    });
});

describe("numberSeparator", () => {
    test("is kept exactly as typed, spaces included", () => {
        for (const value of [" / ", ", ", " ", "/", " · ", "x".repeat(NUMBER_SEPARATOR_MAX_LENGTH)]) {
            expect(parsed("numberSeparator", value)).toEqual({ value });
        }
    });

    test("refuses nothing at all, a line break, a long one, or one that is not text", () => {
        for (const value of ["", "\n", " /\t", "x".repeat(NUMBER_SEPARATOR_MAX_LENGTH + 1), 1, null]) {
            expect(refused("numberSeparator", value)).toBe(true);
        }
    });
});

describe("hymnNoteCategoryName", () => {
    test("is the name, trimmed", () => {
        expect(parsed("hymnNoteCategoryName", "  Hymnal ")).toEqual({ value: "Hymnal" });
        expect(parsed("hymnNoteCategoryName", "Hymn Numbers")).toEqual({ value: "Hymn Numbers" });
    });

    test("refuses a blank name, a line break, a long one, or one that is not text", () => {
        for (const value of ["", "  ", "Hym\nnal", "x".repeat(CATEGORY_NAME_MAX_LENGTH + 1), 1, null]) {
            expect(refused("hymnNoteCategoryName", value)).toBe(true);
        }
    });
});

describe("hymnNoteIncludesTune", () => {
    test("is true or false, and nothing else", () => {
        expect(parsed("hymnNoteIncludesTune", true)).toEqual({ value: true });
        expect(parsed("hymnNoteIncludesTune", false)).toEqual({ value: false });
        for (const value of ["true", "on", 1, 0, null]) {
            expect(refused("hymnNoteIncludesTune", value)).toBe(true);
        }
    });
});

describe("resolveSettings", () => {
    test("is the defaults when nothing is stored", () => {
        expect(resolveSettings([])).toEqual({ settings: DEFAULT_SETTINGS, issues: [] });
    });

    test("takes each stored value that parses", () => {
        const { settings, issues } = resolveSettings([
            { key: "ccliLicenseNumber", value: '"7654321"' },
            { key: "numberSeparator", value: '", "' },
            { key: "hymnNoteIncludesTune", value: "true" },
            { key: "scheduleHeaderLabels", value: JSON.stringify({ [MIDWEEK.id]: "Wednesday PM" }) },
        ]);
        expect(settings).toEqual({
            ...DEFAULT_SETTINGS,
            ccliLicenseNumber: "7654321",
            numberSeparator: ", ",
            hymnNoteIncludesTune: true,
            scheduleHeaderLabels: { [MIDWEEK.id]: "Wednesday PM" },
        });
        expect(issues).toEqual([]);
    });

    test("falls back to the default for a stored value that no longer parses, and reports it", () => {
        const { settings, issues } = resolveSettings([
            { key: "ccliLicenseNumber", value: "1564484" },
            { key: "hymnNoteCategoryName", value: '""' },
            { key: "numberSeparator", value: "not json" },
        ]);
        expect(settings).toEqual(DEFAULT_SETTINGS);
        expect(issues).toEqual([
            {
                key: "ccliLicenseNumber",
                stored: "1564484",
                message: "The CCLI license number must be text.",
            },
            {
                key: "hymnNoteCategoryName",
                stored: '""',
                message: "Enter the name of the item note category, such as Hymnal.",
            },
            { key: "numberSeparator", stored: "not json", message: "It is not JSON." },
        ]);
    });

    test("leaves alone a key this build does not know", () => {
        expect(
            resolveSettings([
                { key: "creditRoles", value: '["Words"]' },
                { key: "toString", value: '"x"' },
            ])
        ).toEqual({ settings: DEFAULT_SETTINGS, issues: [] });
    });

    test("gives a new object each time, never the defaults themselves", () => {
        const { settings } = resolveSettings([]);
        expect(settings).not.toBe(DEFAULT_SETTINGS);
        settings.numberSeparator = ", ";
        expect(DEFAULT_SETTINGS.numberSeparator).toBe(" / ");
    });
});

describe("defaultScheduleHeaderLabel", () => {
    test("keeps the labels the two Sunday services always had, by exact name", () => {
        expect(defaultScheduleHeaderLabel("Sunday Morning")).toBe("Sunday AM");
        expect(defaultScheduleHeaderLabel("Sunday Evening")).toBe("Sunday PM");
        for (const name of ["sunday morning", "Sunday Morning ", "Midweek", "", "constructor", "toString"]) {
            expect(defaultScheduleHeaderLabel(name)).toBeNull();
        }
    });
});

describe("scheduleHeaderLabel", () => {
    test("is a service type's own label when it has one", () => {
        const labels = { [MORNING.id]: "Morning Worship", [MIDWEEK.id]: "Wednesday PM" };
        expect(scheduleHeaderLabel(labels, MORNING)).toBe("Morning Worship");
        expect(scheduleHeaderLabel(labels, MIDWEEK)).toBe("Wednesday PM");
    });

    test("an empty label means no header, even for a Sunday service", () => {
        expect(scheduleHeaderLabel({ [MORNING.id]: "" }, MORNING)).toBeNull();
    });

    test("without a label of its own, a type gets the default for its name", () => {
        expect(scheduleHeaderLabel({}, MORNING)).toBe("Sunday AM");
        expect(scheduleHeaderLabel({ [MORNING.id]: "Morning Worship" }, EVENING)).toBe("Sunday PM");
        expect(scheduleHeaderLabel({}, MIDWEEK)).toBeNull();
    });

    test("reads only the labels' own keys", () => {
        expect(scheduleHeaderLabel({}, { id: "constructor", name: "Midweek" })).toBeNull();
    });
});

describe("planTextSettings", () => {
    test("resolves the header label for the plan's service type", () => {
        expect(planTextSettings(DEFAULT_SETTINGS, MORNING)).toEqual({
            headerLabel: "Sunday AM",
            numberSeparator: " / ",
            ccliLicenseNumber: "1564484",
        });
        expect(
            planTextSettings(
                {
                    ...DEFAULT_SETTINGS,
                    ccliLicenseNumber: "7654321",
                    numberSeparator: ", ",
                    scheduleHeaderLabels: { [MIDWEEK.id]: "Wednesday PM" },
                },
                MIDWEEK
            )
        ).toEqual({ headerLabel: "Wednesday PM", numberSeparator: ", ", ccliLicenseNumber: "7654321" });
    });
});
