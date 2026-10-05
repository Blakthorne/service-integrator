import { describe, expect, test } from "vitest";
import { parsePcoId } from "@/lib/pco";
import { IDLE_FORM, formError, formSuccess } from "./forms";
import {
    CREDIT_PAIR_PHRASE_FIELD,
    creditFormValues,
    creditPhraseField,
    creditRoleField,
} from "./creditRows";
import {
    CATEGORY_NAME_FIELD,
    CCLI_LICENSE_NUMBER_FIELD,
    CREDIT_PHRASES_FIELD,
    CREDIT_ROLES_CONFIRM_FIELD,
    CREDIT_ROLES_FIELD,
    EMAIL_RECIPIENTS_FIELD,
    EMAIL_SUBJECT_FIELD,
    INCLUDES_TUNE_FIELD,
    NUMBER_SEPARATOR_FIELD,
    REPEAT_WARNING_WEEKS_FIELD,
    creditRolesOf,
    headerLabelField,
    isSaved,
    readCopyrightForm,
    readCreditRolesConfirmation,
    readCreditsForm,
    readEmailForm,
    readHymnalNotesForm,
    readRepeatWarningsForm,
    readScheduleTextForm,
    sameValues,
    splitRecipients,
    valuesAfterSave,
} from "./settingsForms";
import {
    CREDIT_PHRASE_MAX_LENGTH,
    CREDIT_ROLES_MAX,
    DEFAULT_SETTINGS,
    EMAIL_RECIPIENTS_MAX,
    HEADER_LABEL_MAX_LENGTH,
    NUMBER_SEPARATOR_MAX_LENGTH,
    SETTING_KEYS,
    parseSetting,
} from "./settings";

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
            CREDIT_ROLES_FIELD,
            CREDIT_PHRASES_FIELD,
            EMAIL_RECIPIENTS_FIELD,
            EMAIL_SUBJECT_FIELD,
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
            posted: { ccliLicenseNumber: " 7654321 " },
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

describe("readRepeatWarningsForm", () => {
    const MESSAGE = "Enter a whole number of weeks from 0 to 52; 0 turns the warnings off.";

    test("is named for its setting", () => {
        expect(REPEAT_WARNING_WEEKS_FIELD).toBe("repeatWarningWeeks");
    });

    test("reads the weeks as a number, and shows them trimmed", () => {
        expect(readRepeatWarningsForm(formWith({ repeatWarningWeeks: " 8 " }))).toEqual({
            ok: true,
            values: { repeatWarningWeeks: 8 },
            shown: { repeatWarningWeeks: "8" },
            posted: { repeatWarningWeeks: " 8 " },
        });
    });

    test("takes 0, which turns the warnings off, and 52, a year", () => {
        for (const weeks of ["0", "52"]) {
            expect(readRepeatWarningsForm(formWith({ repeatWarningWeeks: weeks }))).toMatchObject({
                ok: true,
                values: { repeatWarningWeeks: Number(weeks) },
            });
        }
    });

    test.each(["", "   ", "six", "1.5", "-1", "53", "1e1", "99999999999999999999"])(
        "refuses %j, with what was posted",
        (posted) => {
            expect(readRepeatWarningsForm(formWith({ repeatWarningWeeks: posted }))).toEqual({
                ok: false,
                fieldErrors: { repeatWarningWeeks: { message: MESSAGE } },
                posted: { repeatWarningWeeks: posted },
            });
        }
    );

    test("takes a field that is missing, or a file, as blank", () => {
        const blank = {
            ok: false,
            fieldErrors: { repeatWarningWeeks: { message: MESSAGE } },
            posted: { repeatWarningWeeks: "" },
        };
        expect(readRepeatWarningsForm(formWith())).toEqual(blank);
        expect(readRepeatWarningsForm(formWith({ repeatWarningWeeks: new File(["6"], "6.txt") }))).toEqual(
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
            posted: {
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
            posted: { numberSeparator: " / " },
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
            posted: { hymnNoteCategoryName: "  Hymn Numbers ", hymnNoteIncludesTune: "yes" },
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

/** The Credits form with these rows (role, phrase) and the phrase for the first two roles together. */
function creditsForm(
    rows: readonly (readonly [string, string])[],
    pair = "Words and Music by"
): FormData {
    const formData = new FormData();
    rows.forEach(([role, phrase], index) => {
        formData.set(creditRoleField(index), role);
        formData.set(creditPhraseField(index), phrase);
    });
    formData.set(CREDIT_PAIR_PHRASE_FIELD, pair);
    return formData;
}

const DEFAULT_ROWS = [
    ["Words", "Words by"],
    ["Music", "Music by"],
    ["Arr.", "Arr. by"],
    ["Trans.", "Trans. by"],
] as const;

describe("readCreditsForm", () => {
    test("reads the roles in order, and a phrase for each and for words and music together", () => {
        const read = readCreditsForm(creditsForm(DEFAULT_ROWS));
        expect(read).toMatchObject({
            ok: true,
            values: {
                creditRoles: ["Words", "Music", "Arr.", "Trans."],
                creditPhrases: {
                    Words: "Words by",
                    Music: "Music by",
                    "Arr.": "Arr. by",
                    "Trans.": "Trans. by",
                    "Words & Music": "Words and Music by",
                },
            },
        });
    });

    test("reads back the defaults as they are", () => {
        const form = creditsForm(DEFAULT_ROWS);
        const read = readCreditsForm(form);
        expect(read.ok && read.values).toEqual({
            creditRoles: [...DEFAULT_SETTINGS.creditRoles],
            creditPhrases: { ...DEFAULT_SETTINGS.creditPhrases },
        });
        // The form of the defaults is the one it shows (lib/creditRows.ts).
        const shown = creditFormValues(DEFAULT_SETTINGS.creditRoles, DEFAULT_SETTINGS.creditPhrases);
        expect(read.ok && read.shown).toEqual(shown);
    });

    test("trims the roles and the phrases, and keeps the order typed", () => {
        const read = readCreditsForm(
            creditsForm(
                [
                    ["  Lyrics ", " Text by  "],
                    ["Tune", "Tune by"],
                    ["Setting", "Set by"],
                ],
                "  Text and tune by "
            )
        );
        expect(read).toMatchObject({
            ok: true,
            values: {
                creditRoles: ["Lyrics", "Tune", "Setting"],
                creditPhrases: {
                    Lyrics: "Text by",
                    Tune: "Tune by",
                    Setting: "Set by",
                    "Lyrics & Tune": "Text and tune by",
                },
            },
            shown: {
                "creditRole-0": "Lyrics",
                "creditPhrase-0": "Text by",
                "creditRole-2": "Setting",
                creditPairPhrase: "Text and tune by",
            },
        });
    });

    test("takes a blank phrase as no phrase of its own, and shows what the text prints for it", () => {
        const read = readCreditsForm(
            creditsForm(
                [
                    ["Words", "  "],
                    ["Music", ""],
                    ["Arr.", "Arr. by"],
                ],
                ""
            )
        );
        expect(read).toMatchObject({
            ok: true,
            values: { creditPhrases: { "Arr.": "Arr. by" } },
            shown: {
                "creditPhrase-0": "Words by",
                "creditPhrase-1": "Music by",
                creditPairPhrase: "Words and Music by",
            },
        });
        expect(read.ok && Object.keys(read.values.creditPhrases as object)).toEqual(["Arr."]);
    });

    test("drops a phrase saved for a role that is gone: only what the form holds is saved", () => {
        const read = readCreditsForm(
            creditsForm([
                ["Lyrics", "Lyrics by"],
                ["Music", "Music by"],
            ])
        );
        const phrases = read.ok ? (read.values.creditPhrases as Record<string, string>) : {};
        expect(Object.keys(phrases).sort()).toEqual(["Lyrics", "Lyrics & Music", "Music"]);
    });

    test("reads the rows in the order of their numbers, whatever order they were posted in", () => {
        const formData = new FormData();
        formData.set(creditPhraseField(1), "Music by");
        formData.set(creditRoleField(1), "Music");
        formData.set(creditPhraseField(0), "Words by");
        formData.set(creditRoleField(0), "Words");
        formData.set(CREDIT_PAIR_PHRASE_FIELD, "");
        const read = readCreditsForm(formData);
        expect(read.ok && read.values.creditRoles).toEqual(["Words", "Music"]);
    });

    test("saves what the registry accepts", () => {
        const read = readCreditsForm(creditsForm(DEFAULT_ROWS));
        if (!read.ok) {
            throw new Error("the form was refused");
        }
        expect(parseSetting("creditRoles", read.values.creditRoles).ok).toBe(true);
        expect(parseSetting("creditPhrases", read.values.creditPhrases).ok).toBe(true);
    });

    test.each([
        ["blank", "  ", "A role cannot be blank."],
        [
            "with a separator",
            "Words, Music",
            'The role "Words, Music" has a colon, semicolon, comma or "&" in it, which separate the credits in Planning Center.',
        ],
        ["too long", "x".repeat(31), "A role is at most 30 characters."],
    ])("refuses a role that is %s, on its field, with what was posted", (_name, role, message) => {
        const posted = creditsForm([
            ["Words", "Words by"],
            [role, "Music by"],
        ]);
        expect(readCreditsForm(posted)).toEqual({
            ok: false,
            fieldErrors: { [creditRoleField(1)]: { message } },
            posted: {
                "creditRole-0": "Words",
                "creditPhrase-0": "Words by",
                "creditRole-1": role,
                "creditPhrase-1": "Music by",
                creditPairPhrase: "Words and Music by",
            },
        });
    });

    test("marks the later row of a role listed twice, without regard to case", () => {
        const read = readCreditsForm(
            creditsForm([
                ["Words", "Words by"],
                ["Music", "Music by"],
                ["words", "More words by"],
            ])
        );
        expect(read).toMatchObject({
            ok: false,
            fieldErrors: { [creditRoleField(2)]: { message: 'The role "words" is listed twice.' } },
        });
        expect(read.ok ? [] : Object.keys(read.fieldErrors)).toEqual([creditRoleField(2)]);
    });

    test("refuses a phrase that is too long, on its field, and the pair's on its own", () => {
        const long = "x".repeat(CREDIT_PHRASE_MAX_LENGTH + 1);
        const read = readCreditsForm(
            creditsForm(
                [
                    ["Words", long],
                    ["Music", "Music by"],
                ],
                long
            )
        );
        const message = `A phrase is at most ${CREDIT_PHRASE_MAX_LENGTH} characters.`;
        expect(read).toMatchObject({
            ok: false,
            fieldErrors: {
                [creditPhraseField(0)]: { message },
                [CREDIT_PAIR_PHRASE_FIELD]: { message },
            },
        });
    });

    test("marks every field that is wrong at once, and checks the list only when they are all fine", () => {
        const read = readCreditsForm(
            creditsForm([
                ["", "Words by"],
                ["Music", "x".repeat(60)],
            ])
        );
        expect(read.ok ? [] : Object.keys(read.fieldErrors).sort()).toEqual([
            creditPhraseField(1),
            creditRoleField(0),
        ]);
    });

    test("refuses fewer than two roles, on the list as a whole", () => {
        const read = readCreditsForm(creditsForm([["Words", "Words by"]]));
        expect(read).toMatchObject({
            ok: false,
            fieldErrors: {
                [CREDIT_ROLES_FIELD]: {
                    message: "List at least two roles: the words' and the music's, in that order.",
                },
            },
        });
        expect(readCreditsForm(new FormData())).toMatchObject({
            ok: false,
            fieldErrors: { [CREDIT_ROLES_FIELD]: { message: expect.stringContaining("at least two") } },
        });
    });

    test("refuses more than the most roles, on the list as a whole", () => {
        const rows = Array.from({ length: CREDIT_ROLES_MAX + 1 }, (_, i) => [`Role ${i}`, ""] as const);
        expect(readCreditsForm(creditsForm(rows))).toMatchObject({
            ok: false,
            fieldErrors: { [CREDIT_ROLES_FIELD]: { message: `List at most ${CREDIT_ROLES_MAX} roles.` } },
        });
        const most = rows.slice(0, CREDIT_ROLES_MAX);
        expect(readCreditsForm(creditsForm(most)).ok).toBe(true);
    });

    test("does not take a field that is not a row's role, a tampered form's, as a row", () => {
        const formData = creditsForm(DEFAULT_ROWS.slice(0, 2));
        formData.set("creditRole-abc", "Extra");
        formData.set("creditRole-01", "Extra");
        formData.set("creditRole-1000", "Extra");
        formData.set("creditRole-", "Extra");
        const read = readCreditsForm(formData);
        expect(read.ok && read.values.creditRoles).toEqual(["Words", "Music"]);
        expect(Object.keys(read.posted).sort()).toEqual([
            "creditPairPhrase",
            "creditPhrase-0",
            "creditPhrase-1",
            "creditRole-0",
            "creditRole-1",
        ]);
    });

    test("takes a field that is missing, or a file, as blank", () => {
        const formData = new FormData();
        formData.set(creditRoleField(0), new File(["Words"], "words.txt"));
        formData.set(creditRoleField(1), "Music");
        expect(readCreditsForm(formData)).toMatchObject({
            ok: false,
            fieldErrors: { [creditRoleField(0)]: { message: "A role cannot be blank." } },
        });
    });
});

describe("creditRolesOf", () => {
    test("gives the roles a Credits form read, in order, as they would be saved", () => {
        const read = readCreditsForm(
            creditsForm([
                [" Lyrics ", ""],
                ["Tune", "Tune by"],
            ])
        );
        expect(creditRolesOf(read)).toEqual(["Lyrics", "Tune"]);
    });

    test("gives null for a refused form, and for another form's read", () => {
        expect(
            creditRolesOf(
                readCreditsForm(
                    creditsForm([
                        ["Words", ""],
                        ["words", ""],
                    ])
                )
            )
        ).toBeNull();
        const copyright = new FormData();
        copyright.set(CCLI_LICENSE_NUMBER_FIELD, "1564484");
        expect(creditRolesOf(readCopyrightForm(copyright))).toBeNull();
    });
});

describe("readCreditRolesConfirmation", () => {
    function confirmation(value: string | File | null): number | null {
        const formData = creditsForm(DEFAULT_ROWS);
        if (value !== null) {
            formData.set(CREDIT_ROLES_CONFIRM_FIELD, value);
        }
        return readCreditRolesConfirmation(formData);
    }

    test("reads how many songs the ticked box confirmed", () => {
        expect(confirmation("40")).toBe(40);
        expect(confirmation(" 1 ")).toBe(1);
    });

    test("is null when the box was not ticked, or posted what is not a number of songs", () => {
        for (const value of [null, "", "  ", "0", "-3", "4.5", "1e2", "forty", new File(["40"], "x.txt")]) {
            expect(confirmation(value)).toBeNull();
        }
    });

    test("is a field of its own, which holds no setting", () => {
        expect(SETTING_KEYS).not.toContain(CREDIT_ROLES_CONFIRM_FIELD);
        const formData = creditsForm(DEFAULT_ROWS);
        formData.set(CREDIT_ROLES_CONFIRM_FIELD, "40");
        const read = readCreditsForm(formData);
        expect(read.ok && Object.keys(read.shown)).not.toContain(CREDIT_ROLES_CONFIRM_FIELD);
        expect(Object.keys(read.posted)).not.toContain(CREDIT_ROLES_CONFIRM_FIELD);
    });
});

describe("splitRecipients", () => {
    test("splits at line breaks, commas and semicolons, trims, and leaves blanks out", () => {
        expect(
            splitRecipients(" a@x.org\r\nb@x.org ,c@x.org;; d@x.org\n\n  \n,")
        ).toEqual(["a@x.org", "b@x.org", "c@x.org", "d@x.org"]);
        expect(splitRecipients("")).toEqual([]);
        expect(splitRecipients("  \n , ")).toEqual([]);
    });
});

/** The Email form with this recipients text and this subject. */
function emailForm(recipients: string, subject = "Songs for {date} \u00b7 {service}"): FormData {
    const formData = new FormData();
    formData.set(EMAIL_RECIPIENTS_FIELD, recipients);
    formData.set(EMAIL_SUBJECT_FIELD, subject);
    return formData;
}

describe("readEmailForm", () => {
    test("reads the recipients one to a line, and shows them one to a line", () => {
        expect(readEmailForm(emailForm("pastor@example.org\nmusic@example.org"))).toEqual({
            ok: true,
            values: {
                emailRecipients: ["pastor@example.org", "music@example.org"],
                emailSubjectTemplate: "Songs for {date} \u00b7 {service}",
            },
            shown: {
                emailRecipients: "pastor@example.org\nmusic@example.org",
                emailSubjectTemplate: "Songs for {date} \u00b7 {service}",
            },
            posted: {
                emailRecipients: "pastor@example.org\nmusic@example.org",
                emailSubjectTemplate: "Songs for {date} \u00b7 {service}",
            },
        });
    });

    test("reads commas, semicolons, spaces and Windows line breaks too", () => {
        const read = readEmailForm(
            emailForm(" a@example.org, b@example.org;c@example.org\r\n  d@example.org \r\n")
        );
        expect(read.ok && read.values.emailRecipients).toEqual([
            "a@example.org",
            "b@example.org",
            "c@example.org",
            "d@example.org",
        ]);
        expect(read.ok && read.shown.emailRecipients).toBe(
            "a@example.org\nb@example.org\nc@example.org\nd@example.org"
        );
    });

    test("takes a blank field as no recipients: nothing is emailed until there are some", () => {
        const read = readEmailForm(emailForm("  \n "));
        expect(read).toMatchObject({
            ok: true,
            values: { emailRecipients: [] },
            shown: { emailRecipients: "" },
        });
    });

    test("trims the subject", () => {
        const read = readEmailForm(emailForm("a@example.org", "  Songs for {date}  "));
        expect(read.ok && read.values.emailSubjectTemplate).toBe("Songs for {date}");
        expect(read.ok && read.shown.emailSubjectTemplate).toBe("Songs for {date}");
    });

    test("names the one entry that is not an address, as the registry words it", () => {
        expect(readEmailForm(emailForm("a@example.org\npastor@@example"))).toMatchObject({
            ok: false,
            fieldErrors: {
                emailRecipients: {
                    message: '"pastor@@example" is not an email address, such as name@example.org.',
                },
            },
        });
    });

    test("names every entry that is not an address, the first few, all at once", () => {
        const read = readEmailForm(emailForm("a@example.org, one, two, three, four, five"));
        expect(read).toMatchObject({
            ok: false,
            fieldErrors: {
                emailRecipients: {
                    message:
                        '5 entries are not email addresses: "one", "two", "three" and 2 more. Each is like name@example.org.',
                },
            },
        });
    });

    test("cuts a long entry short in the message", () => {
        const read = readEmailForm(emailForm(`${"x".repeat(60)}, y`));
        const message = read.ok ? "" : (read.fieldErrors.emailRecipients?.message ?? "");
        expect(message).toContain(`"${"x".repeat(40)}\u2026"`);
        expect(message).not.toContain("x".repeat(41));
    });

    test("refuses an address listed twice, without regard to case", () => {
        expect(readEmailForm(emailForm("a@example.org\nA@Example.org"))).toMatchObject({
            ok: false,
            fieldErrors: { emailRecipients: { message: '"A@Example.org" is listed twice.' } },
        });
    });

    test("refuses more than the most recipients", () => {
        const many = Array.from({ length: EMAIL_RECIPIENTS_MAX + 1 }, (_, i) => `p${i}@example.org`);
        expect(readEmailForm(emailForm(many.join("\n")))).toMatchObject({
            ok: false,
            fieldErrors: {
                emailRecipients: { message: `List at most ${EMAIL_RECIPIENTS_MAX} recipients.` },
            },
        });
        expect(readEmailForm(emailForm(many.slice(0, EMAIL_RECIPIENTS_MAX).join("\n"))).ok).toBe(true);
    });

    test.each([
        ["blank", "  ", "Enter the subject, such as Songs for {date} \u00b7 {service}."],
        [
            "with a placeholder it does not know",
            "Songs for {when}",
            '"{when}" is not a placeholder the subject can hold: use {date} or {service}.',
        ],
        ["on more than one line", "Songs\nfor {date}", "The subject must be on one line."],
    ])("refuses a subject that is %s, on its field", (_name, subject, message) => {
        expect(readEmailForm(emailForm("a@example.org", subject))).toMatchObject({
            ok: false,
            fieldErrors: { emailSubjectTemplate: { message } },
        });
    });

    test("marks the recipients and the subject at once, with what was posted", () => {
        const read = readEmailForm(emailForm("nope", "  "));
        expect(read.ok).toBe(false);
        expect(read.ok ? [] : Object.keys(read.fieldErrors).sort()).toEqual([
            "emailRecipients",
            "emailSubjectTemplate",
        ]);
        expect(read.posted).toEqual({ emailRecipients: "nope", emailSubjectTemplate: "  " });
    });

    test("takes a field that is missing, or a file, as blank", () => {
        const formData = new FormData();
        formData.set(EMAIL_SUBJECT_FIELD, new File(["x"], "x.txt"));
        const read = readEmailForm(formData);
        expect(read).toMatchObject({
            ok: false,
            fieldErrors: { emailSubjectTemplate: { message: expect.stringContaining("Enter the subject") } },
        });
        expect(read.posted).toEqual({ emailRecipients: "", emailSubjectTemplate: "" });
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

describe("valuesAfterSave", () => {
    const HELD = { "headerLabel-1405391": "Sunday AM", numberSeparator: " | " };

    test("is what the save stored, which is what each field now holds", () => {
        const saved = formSuccess("Saved.", { ccliLicenseNumber: "7654321" });
        expect(valuesAfterSave({ ccliLicenseNumber: "  7654321 " }, saved)).toEqual({
            ccliLicenseNumber: "7654321",
        });
    });

    test("drops a field the form no longer has, so it cannot make the form look unsaved", () => {
        // Planning Center answered, then failed: the labels' fields are gone, the separator's is left.
        expect(valuesAfterSave(HELD, formSuccess("Saved.", { numberSeparator: " | " }))).toEqual({
            numberSeparator: " | ",
        });
    });

    test("leaves what the fields held when the save was refused or has not happened", () => {
        expect(valuesAfterSave(HELD, formError("Nothing was saved."))).toBe(HELD);
        expect(valuesAfterSave(HELD, IDLE_FORM)).toBe(HELD);
    });
});

describe("isSaved", () => {
    test("is true while the form shows what the last save stored", () => {
        const saved = formSuccess("Saved.", { numberSeparator: " | " });
        expect(isSaved({ numberSeparator: " | " }, saved)).toBe(true);
    });

    test("is false once a field is edited, and true again when it is put back", () => {
        const saved = formSuccess("Saved.", { numberSeparator: " | " });
        expect(isSaved({ numberSeparator: " |" }, saved)).toBe(false);
        expect(isSaved({ numberSeparator: " | " }, saved)).toBe(true);
    });

    test("is false when the form has a field the save did not post, as a service type that appeared since", () => {
        const saved = formSuccess("Saved.", { numberSeparator: " | " });
        expect(isSaved({ numberSeparator: " | ", "headerLabel-1486055": "" }, saved)).toBe(false);
    });

    test("is false before a save, and after a refusal", () => {
        expect(isSaved({ numberSeparator: " | " }, IDLE_FORM)).toBe(false);
        expect(isSaved({ numberSeparator: " | " }, formError("Nothing was saved."))).toBe(false);
    });

    test("is true after a save when the fields vanished before it, once the held values were replaced", () => {
        const held = { "headerLabel-1405391": "Sunday AM", numberSeparator: " | " };
        const saved = formSuccess("Saved.", { numberSeparator: " | " });
        expect(isSaved(held, saved)).toBe(false);
        expect(isSaved(valuesAfterSave(held, saved), saved)).toBe(true);
    });
});
