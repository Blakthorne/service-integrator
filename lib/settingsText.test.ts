import { describe, expect, test } from "vitest";
import { HYMN_NOTE_TUNE_SEPARATOR } from "./hymnNotes";
import {
    DEFAULT_SETTINGS,
    SETTING_KEYS,
    type SettingIssue,
    type SettingKey,
} from "./settings";
import {
    SETTINGS_CARD_TITLES,
    SETTING_DESCRIPTIONS,
    categoryLookupIntro,
    describeCategoryLookup,
    describeSettingIssue,
    headerLabelHint,
    headerLabelRows,
    PCO_WAIT_MS,
    missingCategoryHelp,
    pcoTimedOutReason,
    previewCopyrightFooter,
    previewHymnNote,
    previewNumbers,
} from "./settingsText";

function issue(key: SettingKey, stored: string, message = "It is not valid."): SettingIssue {
    return { key, stored, message };
}

describe("SETTING_DESCRIPTIONS", () => {
    test("names every setting, and the card that edits it", () => {
        expect(Object.keys(SETTING_DESCRIPTIONS).sort()).toEqual([...SETTING_KEYS].sort());
        const cards = new Set<string>(Object.values(SETTINGS_CARD_TITLES));
        for (const { label, card } of Object.values(SETTING_DESCRIPTIONS)) {
            expect(label).not.toBe("");
            expect(cards).toContain(card);
        }
    });
});

describe("describeSettingIssue", () => {
    test("names the setting, its card, what is stored, why it is refused and what is used", () => {
        expect(describeSettingIssue(issue("ccliLicenseNumber", '"abc"', "Digits only."))).toEqual({
            label: "CCLI license number",
            card: "Copyright",
            stored: '"abc"',
            message: "Digits only.",
            usingDefault: 'The default is in use: "1564484".',
        });
    });

    test("says the default of each setting in words", () => {
        const usingDefault = (key: SettingKey) => describeSettingIssue(issue(key, "1")).usingDefault;
        expect(usingDefault("numberSeparator")).toBe('The default is in use: " / ".');
        expect(usingDefault("hymnNoteCategoryName")).toBe('The default is in use: "Hymnal".');
        expect(usingDefault("hymnNoteIncludesTune")).toBe("The default is in use: no.");
        expect(usingDefault("scheduleHeaderLabels")).toBe(
            "The default is in use: no labels of its own, so each service type gets its default header."
        );
    });

    test("has a default to name for every setting", () => {
        for (const key of SETTING_KEYS) {
            const { usingDefault } = describeSettingIssue(issue(key, "null"));
            expect(usingDefault).toMatch(/^The default is in use: .+\.$/);
            expect(usingDefault).not.toContain("undefined");
        }
        expect(Object.keys(DEFAULT_SETTINGS)).toEqual([...SETTING_KEYS]);
    });

    test("cuts a long stored value short", () => {
        const stored = JSON.stringify("x".repeat(500));
        const { stored: shown } = describeSettingIssue(issue("numberSeparator", stored));
        expect(shown).toHaveLength(121);
        expect(shown.endsWith("…")).toBe(true);
        expect(stored.startsWith(shown.slice(0, -1))).toBe(true);
    });

    test("leaves a short stored value as it is", () => {
        const stored = JSON.stringify("y".repeat(100));
        expect(describeSettingIssue(issue("numberSeparator", stored)).stored).toBe(stored);
    });
});

describe("previewNumbers", () => {
    test("joins a song's numbers with the separator as typed, spaces included", () => {
        expect(previewNumbers(" / ")).toBe("R-396 / G-317");
        expect(previewNumbers("/")).toBe("R-396/G-317");
        expect(previewNumbers(", ")).toBe("R-396, G-317");
        expect(previewNumbers("  ")).toBe("R-396  G-317");
    });

    test("has nothing to show for a separator the setting refuses", () => {
        expect(previewNumbers("")).toBeNull();
        expect(previewNumbers("x".repeat(11))).toBeNull();
        expect(previewNumbers("a\nb")).toBeNull();
    });
});

describe("previewHymnNote", () => {
    test("is the numbers alone, with the tune when the setting says so", () => {
        const base = { numberSeparator: " / ", hymnNoteIncludesTune: false };
        expect(previewHymnNote(base)).toBe("R-396 / G-317");
        expect(previewHymnNote({ ...base, hymnNoteIncludesTune: true })).toBe(
            `R-396 / G-317${HYMN_NOTE_TUNE_SEPARATOR}ST. ANNE`
        );
    });

    test("follows the separator", () => {
        expect(previewHymnNote({ numberSeparator: " | ", hymnNoteIncludesTune: false })).toBe(
            "R-396 | G-317"
        );
    });
});

describe("previewCopyrightFooter", () => {
    test("is the last line of the copyright text, with the license number", () => {
        expect(previewCopyrightFooter("1564484")).toBe(
            "Used by permission. CCLI Streaming License 1564484."
        );
        expect(previewCopyrightFooter("  7654321 ")).toBe(
            "Used by permission. CCLI Streaming License 7654321."
        );
    });

    test("has nothing to show for a number the setting refuses", () => {
        expect(previewCopyrightFooter("")).toBeNull();
        expect(previewCopyrightFooter("12-34")).toBeNull();
    });
});

describe("headerLabelRows", () => {
    const MORNING = { id: "1405391", name: "Sunday Morning" };
    const EVENING = { id: "1486055", name: "Sunday Evening" };
    const MIDWEEK = { id: "1500000", name: "Midweek" };

    test("gives each service type its saved label and the default it gets without one", () => {
        expect(
            headerLabelRows([MORNING, EVENING, MIDWEEK], { [EVENING.id]: "Evening service" })
        ).toEqual([
            {
                serviceTypeId: "1405391",
                serviceTypeName: "Sunday Morning",
                label: "",
                defaultLabel: "Sunday AM",
            },
            {
                serviceTypeId: "1486055",
                serviceTypeName: "Sunday Evening",
                label: "Evening service",
                defaultLabel: "Sunday PM",
            },
            {
                serviceTypeId: "1500000",
                serviceTypeName: "Midweek",
                label: "",
                defaultLabel: null,
            },
        ]);
    });

    test("keeps the order given, and ignores labels of types it was not given", () => {
        const rows = headerLabelRows([EVENING, MORNING], { [MIDWEEK.id]: "Midweek" });
        expect(rows.map((row) => row.serviceTypeId)).toEqual([EVENING.id, MORNING.id]);
        expect(rows.every((row) => row.label === "")).toBe(true);
    });

    test("lists nothing for no service types", () => {
        expect(headerLabelRows([], { [MORNING.id]: "Sunday AM" })).toEqual([]);
    });

    test("does not take a label from the prototype", () => {
        const [row] = headerLabelRows([{ id: "constructor", name: "Odd" }], {});
        expect(row.label).toBe("");
    });
});

describe("headerLabelHint", () => {
    test("says what a blank label does", () => {
        expect(headerLabelHint("Sunday AM")).toBe('Left blank, the header is "Sunday AM".');
        expect(headerLabelHint(null)).toBe("Left blank, the text has no header.");
    });
});

describe("describeCategoryLookup", () => {
    test("a category found shows as Planning Center spells it", () => {
        expect(
            describeCategoryLookup({ status: "found", category: { name: "hymnal" } })
        ).toEqual({ tone: "ok", status: 'Found as "hymnal"', detail: null });
    });

    test("a category missing is a warning with the data layer's sentence", () => {
        const message = 'Create an item note category named "Hymnal" in Planning Center for Sunday Morning.';
        expect(describeCategoryLookup({ status: "missing", message })).toEqual({
            tone: "warning",
            status: "Missing",
            detail: message,
        });
    });

    test("categories that could not be read are an error with the reason, ending in a full stop", () => {
        expect(
            describeCategoryLookup({
                status: "unavailable",
                error: "Planning Center API responded with status: 500 (/service_types/1/item_note_categories)",
            })
        ).toEqual({
            tone: "error",
            status: "Could not be checked",
            detail:
                "Its item note categories could not be read: Planning Center API responded with status: 500 (/service_types/1/item_note_categories).",
        });
        expect(
            describeCategoryLookup({ status: "unavailable", error: "Timed out." }).detail
        ).toBe("Its item note categories could not be read: Timed out.");
    });
});

describe("missingCategoryHelp", () => {
    test("names the category and says it is made in Planning Center's web app", () => {
        const help = missingCategoryHelp("Hymn Numbers");
        expect(help).toContain('"Hymn Numbers"');
        expect(help).toContain("Planning Center's web app");
        expect(help).toContain("Services › Plans › item notes");
        expect(help).toContain("marked Missing");
    });
});

describe("categoryLookupIntro", () => {
    test("names the category being looked for", () => {
        expect(categoryLookupIntro("Hymnal")).toBe(
            'Looking for an item note category named "Hymnal" in each service type.'
        );
    });
});

describe("pcoTimedOutReason", () => {
    test("says how many seconds the page waited", () => {
        expect(pcoTimedOutReason(5000)).toBe("Planning Center did not answer within 5 seconds.");
        expect(pcoTimedOutReason(PCO_WAIT_MS)).toBe(
            `Planning Center did not answer within ${PCO_WAIT_MS / 1000} seconds.`
        );
    });

    test("waits less than one of Planning Center's own timeouts, which the client sets at 15 s", () => {
        expect(PCO_WAIT_MS).toBeLessThan(15_000);
    });
});
