import { describe, expect, test } from "vitest";
import { parsePcoId } from "@/lib/pco";
import {
    CATEGORY_NAME_FIELD,
    CCLI_LICENSE_NUMBER_FIELD,
    INCLUDES_TUNE_FIELD,
    NUMBER_SEPARATOR_FIELD,
    headerLabelField,
    readCopyrightForm,
    readHymnalNotesForm,
    readScheduleTextForm,
    sameValues,
} from "./settingsForms";
import { HEADER_LABEL_MAX_LENGTH, NUMBER_SEPARATOR_MAX_LENGTH, SETTING_KEYS } from "./settings";

const MORNING = "1405391";
const EVENING = "1486055";
const MIDWEEK = "1500000";

/** A form as the browser would post it. */
function formWith(fields: Record<string, string | File> = {}): FormData {
    const formData = new FormData();
    for (const [name, value] of Object.entries(fields)) {
        formData.set(name, value);
    }
    return formData;
}

/** The Schedule text form, with the labels of these service types and this separator. */
function scheduleForm(
    labels: Record<string, string>,
    separator: string | null = " / "
): FormData {
    const formData = new FormData();
    for (const [id, label] of Object.entries(labels)) {
        formData.set(headerLabelField(id), label);
    }
    if (separator !== null) {
        formData.set(NUMBER_SEPARATOR_FIELD, separator);
    }
    return formData;
}

describe("the forms' field names", () => {
    test("each is named for the setting it holds", () => {
        const settingFields = [
            CCLI_LICENSE_NUMBER_FIELD,
            NUMBER_SEPARATOR_FIELD,
            CATEGORY_NAME_FIELD,
            INCLUDES_TUNE_FIELD,
        ];
        for (const field of settingFields) {
            expect(SETTING_KEYS).toContain(field);
        }
    });

    test("a header label's field names its service type", () => {
        expect(headerLabelField(MORNING)).toBe("headerLabel-1405391");
    });
});

describe("readCopyrightForm", () => {
    test("reads the number trimmed, and shows it trimmed", () => {
        expect(readCopyrightForm(formWith({ ccliLicenseNumber: " 7654321 " }))).toEqual({
            ok: true,
            values: { ccliLicenseNumber: "7654321" },
            shown: { ccliLicenseNumber: "7654321" },
        });
    });

    test.each([
        ["blank", "   ", "Enter the CCLI license number."],
        [
            "not digits",
            "12-34",
            "A CCLI license number is digits only, at most 20 of them, such as 1564484.",
        ],
        [
            "too long",
            "1".repeat(21),
            "A CCLI license number is digits only, at most 20 of them, such as 1564484.",
        ],
    ])("refuses a number that is %s, with what was posted", (_name, posted, message) => {
        expect(readCopyrightForm(formWith({ ccliLicenseNumber: posted }))).toEqual({
            ok: false,
            fieldErrors: { ccliLicenseNumber: { message } },
            posted: { ccliLicenseNumber: posted },
        });
    });

    test("takes a field that is missing, or a file, as blank", () => {
        const blank = {
            ok: false,
            fieldErrors: { ccliLicenseNumber: { message: "Enter the CCLI license number." } },
            posted: { ccliLicenseNumber: "" },
        };
        expect(readCopyrightForm(formWith())).toEqual(blank);
        expect(readCopyrightForm(formWith({ ccliLicenseNumber: new File(["1"], "1.txt") }))).toEqual(
            blank
        );
    });
});

describe("readScheduleTextForm", () => {
    const NO_LABELS = {};

    test("reads each service type's label and the separator, as typed", () => {
        const read = readScheduleTextForm(
            scheduleForm({ [MORNING]: "Sunday Morning", [EVENING]: "PM" }, " | "),
            NO_LABELS,
            parsePcoId
        );
        expect(read).toEqual({
            ok: true,
            values: {
                scheduleHeaderLabels: { [MORNING]: "Sunday Morning", [EVENING]: "PM" },
                numberSeparator: " | ",
            },
            shown: {
                "headerLabel-1405391": "Sunday Morning",
                "headerLabel-1486055": "PM",
                numberSeparator: " | ",
            },
        });
    });

    test("keeps the spaces around the separator", () => {
        const read = readScheduleTextForm(scheduleForm({}, " / "), NO_LABELS, parsePcoId);
        expect(read).toMatchObject({ ok: true, values: { numberSeparator: " / " } });
        const tight = readScheduleTextForm(scheduleForm({}, "/"), NO_LABELS, parsePcoId);
        expect(tight).toMatchObject({ ok: true, values: { numberSeparator: "/" } });
    });

    test("trims a label, and shows it trimmed", () => {
        const read = readScheduleTextForm(
            scheduleForm({ [MORNING]: "  Sunday AM  " }),
            NO_LABELS,
            parsePcoId
        );
        expect(read).toMatchObject({
            ok: true,
            values: { scheduleHeaderLabels: { [MORNING]: "Sunday AM" } },
            shown: { "headerLabel-1405391": "Sunday AM" },
        });
    });

    test("drops a blank label, so its service type gets the default and not no header", () => {
        const read = readScheduleTextForm(
            scheduleForm({ [MORNING]: "   ", [EVENING]: "" }),
            { [MORNING]: "Old label", [EVENING]: "Another" },
            parsePcoId
        );
        expect(read).toMatchObject({
            ok: true,
            values: { scheduleHeaderLabels: {} },
            shown: { "headerLabel-1405391": "", "headerLabel-1486055": "" },
        });
    });

    test("keeps the labels of service types the form did not list", () => {
        const stored = { [MIDWEEK]: "Midweek", [MORNING]: "Old" };
        const read = readScheduleTextForm(scheduleForm({ [MORNING]: "New" }), stored, parsePcoId);
        expect(read).toMatchObject({
            ok: true,
            values: { scheduleHeaderLabels: { [MIDWEEK]: "Midweek", [MORNING]: "New" } },
        });
        expect(stored).toEqual({ [MIDWEEK]: "Midweek", [MORNING]: "Old" });
    });

    test("with no label fields, as when Planning Center could not be reached, keeps every label", () => {
        const stored = { [MORNING]: "Sunday AM", [EVENING]: "Sunday PM" };
        const read = readScheduleTextForm(scheduleForm({}, " / "), stored, parsePcoId);
        expect(read).toEqual({
            ok: true,
            values: { scheduleHeaderLabels: stored, numberSeparator: " / " },
            shown: { numberSeparator: " / " },
        });
    });

    test("reports every field that is wrong at once, each on its own field", () => {
        const tooLong = "x".repeat(HEADER_LABEL_MAX_LENGTH + 1);
        const read = readScheduleTextForm(
            scheduleForm({ [MORNING]: tooLong, [EVENING]: "Fine", [MIDWEEK]: "Two\nlines" }, ""),
            NO_LABELS,
            parsePcoId
        );
        expect(read).toEqual({
            ok: false,
            fieldErrors: {
                "headerLabel-1405391": {
                    message: `A header label is at most ${HEADER_LABEL_MAX_LENGTH} characters.`,
                },
                "headerLabel-1500000": { message: "A header label must be on one line." },
                numberSeparator: {
                    message: 'Enter what goes between a song\'s numbers, such as " / ".',
                },
            },
            posted: {
                numberSeparator: "",
                "headerLabel-1405391": tooLong,
                "headerLabel-1486055": "Fine",
                "headerLabel-1500000": "Two\nlines",
            },
        });
    });

    test("refuses a separator that is too long", () => {
        const read = readScheduleTextForm(
            scheduleForm({}, "x".repeat(NUMBER_SEPARATOR_MAX_LENGTH + 1)),
            NO_LABELS,
            parsePcoId
        );
        expect(read).toMatchObject({
            ok: false,
            fieldErrors: {
                numberSeparator: {
                    message: `The number separator is at most ${NUMBER_SEPARATOR_MAX_LENGTH} characters.`,
                },
            },
        });
    });

    test("takes a separator that is missing as empty, and refuses it", () => {
        const read = readScheduleTextForm(scheduleForm({}, null), NO_LABELS, parsePcoId);
        expect(read).toMatchObject({
            ok: false,
            fieldErrors: { numberSeparator: expect.objectContaining({ message: expect.any(String) }) },
            posted: { numberSeparator: "" },
        });
    });

    test.each(["abc", "0", "01", "1e3", "../1", ""])(
        "refuses a field named for %j, which is not a service type's id",
        (id) => {
            const formData = scheduleForm({});
            formData.set(`headerLabel-${id}`, "Sunday");
            const read = readScheduleTextForm(formData, NO_LABELS, parsePcoId);
            expect(read).toMatchObject({
                ok: false,
                fieldErrors: {
                    [`headerLabel-${id}`]: { message: "That is not a service type's id." },
                },
            });
        }
    );

    test("reads a field posted twice once, as the first says", () => {
        const formData = scheduleForm({ [MORNING]: "First" });
        formData.append(headerLabelField(MORNING), "Second");
        expect(readScheduleTextForm(formData, NO_LABELS, parsePcoId)).toMatchObject({
            ok: true,
            values: { scheduleHeaderLabels: { [MORNING]: "First" } },
        });
    });

    test("ignores fields that are not its own", () => {
        const formData = scheduleForm({ [MORNING]: "Sunday AM" });
        formData.set("somethingElse", "x");
        expect(readScheduleTextForm(formData, NO_LABELS, parsePcoId)).toMatchObject({
            ok: true,
            values: { scheduleHeaderLabels: { [MORNING]: "Sunday AM" } },
        });
    });
});

describe("readHymnalNotesForm", () => {
    test("reads the category trimmed and the yes or no", () => {
        expect(
            readHymnalNotesForm(
                formWith({ hymnNoteCategoryName: "  Hymn Numbers ", hymnNoteIncludesTune: "yes" })
            )
        ).toEqual({
            ok: true,
            values: { hymnNoteCategoryName: "Hymn Numbers", hymnNoteIncludesTune: true },
            shown: { hymnNoteCategoryName: "Hymn Numbers", hymnNoteIncludesTune: "yes" },
        });
        expect(
            readHymnalNotesForm(
                formWith({ hymnNoteCategoryName: "Hymnal", hymnNoteIncludesTune: "no" })
            )
        ).toMatchObject({
            ok: true,
            values: { hymnNoteIncludesTune: false },
            shown: { hymnNoteIncludesTune: "no" },
        });
    });

    test("refuses a blank category, and says so on its field", () => {
        expect(
            readHymnalNotesForm(formWith({ hymnNoteCategoryName: "  ", hymnNoteIncludesTune: "no" }))
        ).toEqual({
            ok: false,
            fieldErrors: {
                hymnNoteCategoryName: {
                    message: "Enter the name of the item note category, such as Hymnal.",
                },
            },
            posted: { hymnNoteCategoryName: "  ", hymnNoteIncludesTune: "no" },
        });
    });

    test.each([["maybe"], ["true"], [""]])(
        "refuses %j for the tune, which is neither yes nor no",
        (posted) => {
            expect(
                readHymnalNotesForm(
                    formWith({ hymnNoteCategoryName: "Hymnal", hymnNoteIncludesTune: posted })
                )
            ).toMatchObject({
                ok: false,
                fieldErrors: {
                    hymnNoteIncludesTune: {
                        message: "Whether the note names the tune must be yes or no.",
                    },
                },
            });
        }
    );

    test("reports both fields when both are wrong", () => {
        const read = readHymnalNotesForm(formWith());
        expect(read.ok).toBe(false);
        if (!read.ok) {
            expect(Object.keys(read.fieldErrors).sort()).toEqual([
                "hymnNoteCategoryName",
                "hymnNoteIncludesTune",
            ]);
        }
    });
});

describe("sameValues", () => {
    test("is true for the same fields with the same text", () => {
        expect(sameValues({ a: "1", b: "2" }, { b: "2", a: "1" })).toBe(true);
        expect(sameValues({}, {})).toBe(true);
    });

    test("is false when a value, a field or the number of fields differs", () => {
        expect(sameValues({ a: "1" }, { a: "2" })).toBe(false);
        expect(sameValues({ a: "1" }, { b: "1" })).toBe(false);
        expect(sameValues({ a: "1" }, { a: "1", b: "" })).toBe(false);
        expect(sameValues({ a: "" }, {})).toBe(false);
    });

    test("tells a space from nothing", () => {
        expect(sameValues({ numberSeparator: " / " }, { numberSeparator: "/" })).toBe(false);
    });
});
