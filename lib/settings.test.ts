import { describe, expect, test } from "vitest";
import { parsePcoId } from "@/lib/pco";
import {
    CATEGORY_NAME_MAX_LENGTH,
    CREDIT_PHRASES_MAX,
    CREDIT_PHRASE_MAX_LENGTH,
    CREDIT_ROLES_MAX,
    CREDIT_ROLE_MAX_LENGTH,
    DEFAULT_SETTINGS,
    EMAIL_ADDRESS_MAX_LENGTH,
    EMAIL_RECIPIENTS_MAX,
    EMAIL_SUBJECT_MAX_LENGTH,
    EMAIL_SUBJECT_PLACEHOLDERS,
    HEADER_LABEL_MAX_LENGTH,
    NUMBER_SEPARATOR_MAX_LENGTH,
    SETTINGS,
    SETTING_KEYS,
    defaultScheduleHeaderLabel,
    hasControlCharacter,
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
    test("has the phase 3 and phase 4 keys, each with a default and a parser", () => {
        expect(SETTING_KEYS).toEqual([
            "ccliLicenseNumber",
            "scheduleHeaderLabels",
            "numberSeparator",
            "hymnNoteCategoryName",
            "hymnNoteIncludesTune",
            "creditRoles",
            "creditPhrases",
            "emailRecipients",
            "emailSubjectTemplate",
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
            creditRoles: ["Words", "Music", "Arr.", "Trans."],
            creditPhrases: {
                Words: "Words by",
                Music: "Music by",
                "Words & Music": "Words and Music by",
                "Arr.": "Arr. by",
                "Trans.": "Trans. by",
            },
            emailRecipients: [],
            emailSubjectTemplate: "Songs for {date} · {service}",
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
        expect(Object.isFrozen(DEFAULT_SETTINGS.creditRoles)).toBe(true);
        expect(Object.isFrozen(DEFAULT_SETTINGS.creditPhrases)).toBe(true);
        expect(Object.isFrozen(DEFAULT_SETTINGS.emailRecipients)).toBe(true);
    });

    test("isSettingKey knows the keys and nothing else", () => {
        for (const key of SETTING_KEYS) {
            expect(isSettingKey(key)).toBe(true);
        }
        for (const value of ["reportPeriod", "constructor", "__proto__", "toString", "", null, 1]) {
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

describe("creditRoles", () => {
    test("is the roles in order, each trimmed", () => {
        expect(parsed("creditRoles", [" Words ", "Music", "Arr.", "Trans.", "Descant"])).toEqual({
            value: ["Words", "Music", "Arr.", "Trans.", "Descant"],
        });
        expect(parsed("creditRoles", ["Text", "Tune"])).toEqual({ value: ["Text", "Tune"] });
        const longest = "x".repeat(CREDIT_ROLE_MAX_LENGTH);
        expect(parsed("creditRoles", ["Words", longest])).toEqual({ value: ["Words", longest] });
    });

    test("needs at least two roles, the words' and the music's, and takes at most the limit", () => {
        expect(parsed("creditRoles", ["Words"])).toEqual({
            message: "List at least two roles: the words' and the music's, in that order.",
        });
        expect(refused("creditRoles", [])).toBe(true);
        const many = Array.from({ length: CREDIT_ROLES_MAX }, (_, i) => `Role ${i + 1}`);
        expect(parsed("creditRoles", many)).toEqual({ value: many });
        expect(parsed("creditRoles", [...many, "One more"])).toEqual({
            message: `List at most ${CREDIT_ROLES_MAX} roles.`,
        });
    });

    test("refuses a role listed twice, without regard to case", () => {
        expect(parsed("creditRoles", ["Words", "Music", "words"])).toEqual({
            message: 'The role "words" is listed twice.',
        });
    });

    test("refuses a role with a separator of the credits convention in it", () => {
        for (const role of ["Words:", "Arr;", "A, B", "Words & Music"]) {
            expect([role, parsed("creditRoles", ["Words", role])]).toEqual([
                role,
                {
                    message: `The role ${JSON.stringify(role)} has a colon, semicolon, comma or "&" in it, which separate the credits in Planning Center.`,
                },
            ]);
        }
    });

    test("refuses a blank role, a line break, a long one, one that is not text, or anything but a list", () => {
        for (const role of ["", "  ", "Wo\nrds", "x".repeat(CREDIT_ROLE_MAX_LENGTH + 1), 1, null]) {
            expect(refused("creditRoles", ["Words", role])).toBe(true);
        }
        for (const value of ["Words", { 0: "Words", 1: "Music" }, null, 1]) {
            expect(refused("creditRoles", value)).toBe(true);
        }
    });
});

describe("creditPhrases", () => {
    test("is a trimmed phrase for each role, or pair of roles, each key trimmed", () => {
        expect(
            parsed("creditPhrases", {
                " Words ": " Text by ",
                "Music & Words": "Words and Music by",
                "Arr.&Trans.": "Arranged and translated by",
                Descant: "Descant by",
            })
        ).toEqual({
            value: {
                Words: "Text by",
                "Music & Words": "Words and Music by",
                "Arr. & Trans.": "Arranged and translated by",
                Descant: "Descant by",
            },
        });
        expect(parsed("creditPhrases", {})).toEqual({ value: {} });
    });

    test("keeps a key that names something on Object's prototype as a key of its own", () => {
        const result = parseSetting("creditPhrases", JSON.parse('{"__proto__": "By", "constructor": "Made by"}'));
        expect(result.ok).toBe(true);
        const phrases = result.ok ? result.value : {};
        expect(Object.getPrototypeOf(phrases)).toBe(Object.prototype);
        expect(Object.hasOwn(phrases, "__proto__")).toBe(true);
        expect(Object.entries(phrases)).toEqual([
            ["__proto__", "By"],
            ["constructor", "Made by"],
        ]);
    });

    test("refuses a key given twice, without regard to case or spacing", () => {
        expect(parsed("creditPhrases", { Words: "Words by", " words": "Text by" })).toEqual({
            message: 'There are two phrases for "words".',
        });
        expect(refused("creditPhrases", { "Words & Music": "a", "Words&Music": "b" })).toBe(true);
    });

    test("refuses a key with a separator in it, or more than two roles", () => {
        for (const key of ["Words:", "A; B", "A, B", "", " & Music", "Words & "]) {
            expect([key, refused("creditPhrases", { [key]: "By" })]).toEqual([key, true]);
        }
        expect(parsed("creditPhrases", { "Words & Music & Arr.": "By" })).toEqual({
            message:
                '"Words & Music & Arr." names more than two roles; a phrase is for one role, or two joined with "&".',
        });
    });

    test("refuses a blank phrase, a line break, a long one, or one that is not text", () => {
        for (const phrase of ["", "  ", "Words\nby", "x".repeat(CREDIT_PHRASE_MAX_LENGTH + 1), 1, null]) {
            expect(refused("creditPhrases", { Words: phrase })).toBe(true);
        }
        expect(parsed("creditPhrases", { Words: "" })).toEqual({
            message: 'A phrase cannot be blank: it is what goes before the names, such as "Words by".',
        });
        const longest = "x".repeat(CREDIT_PHRASE_MAX_LENGTH);
        expect(parsed("creditPhrases", { Words: longest })).toEqual({ value: { Words: longest } });
    });

    test("takes at most the limit, and nothing but an object", () => {
        const phrases = (count: number) =>
            Object.fromEntries(Array.from({ length: count }, (_, i) => [`Role ${i}`, "By"]));
        expect(parsed("creditPhrases", phrases(CREDIT_PHRASES_MAX))).toEqual({
            value: phrases(CREDIT_PHRASES_MAX),
        });
        expect(parsed("creditPhrases", phrases(CREDIT_PHRASES_MAX + 1))).toEqual({
            message: `Give at most ${CREDIT_PHRASES_MAX} phrases.`,
        });
        for (const value of [null, [], "Words by", 1, true]) {
            expect(refused("creditPhrases", value)).toBe(true);
        }
    });
});

describe("emailRecipients", () => {
    test("is the addresses in order, each trimmed; none is fine", () => {
        expect(
            parsed("emailRecipients", [" pastor@example.org ", "Music.Director@Example.co.uk", "a+songs@b.c"])
        ).toEqual({ value: ["pastor@example.org", "Music.Director@Example.co.uk", "a+songs@b.c"] });
        expect(parsed("emailRecipients", [])).toEqual({ value: [] });
    });

    test("refuses what is not one plain address", () => {
        const notAddresses = [
            "",
            "pastor",
            "pastor@",
            "@example.org",
            "pastor@example",
            "pastor@example..org",
            "pastor@example.org.",
            "pastor@@example.org",
            "two words@example.org",
            "a@b.org, c@d.org",
            "a@b.org; c@d.org",
            "Pastor <pastor@example.org>",
            '"pastor"@example.org',
            "pastor@example.org\nBcc: x@y.org",
            "pastor@[127.0.0.1]",
            `${"a".repeat(EMAIL_ADDRESS_MAX_LENGTH - 7)}@b.co.uk`,
        ];
        for (const address of notAddresses) {
            expect([address, refused("emailRecipients", [address])]).toEqual([address, true]);
        }
        expect(parsed("emailRecipients", ["pastor"])).toEqual({
            message: '"pastor" is not an email address, such as name@example.org.',
        });
        // "@b.co.uk" is 8 characters, so this is the longest address taken.
        const longest = `${"a".repeat(EMAIL_ADDRESS_MAX_LENGTH - 8)}@b.co.uk`;
        expect(parsed("emailRecipients", [longest])).toEqual({ value: [longest] });
    });

    test("refuses an address listed twice, without regard to case", () => {
        expect(parsed("emailRecipients", ["pastor@example.org", "Pastor@Example.org"])).toEqual({
            message: '"Pastor@Example.org" is listed twice.',
        });
    });

    test("takes at most the limit, and nothing but a list of text", () => {
        const many = Array.from({ length: EMAIL_RECIPIENTS_MAX }, (_, i) => `r${i}@example.org`);
        expect(parsed("emailRecipients", many)).toEqual({ value: many });
        expect(parsed("emailRecipients", [...many, "one@more.org"])).toEqual({
            message: `List at most ${EMAIL_RECIPIENTS_MAX} recipients.`,
        });
        for (const value of ["pastor@example.org", null, {}, [1], [null]]) {
            expect(refused("emailRecipients", value)).toBe(true);
        }
    });
});

describe("emailSubjectTemplate", () => {
    test("is the subject, trimmed, with the placeholders it may hold", () => {
        expect(EMAIL_SUBJECT_PLACEHOLDERS).toEqual(["date", "service"]);
        expect(parsed("emailSubjectTemplate", "  {service} songs, {date} ")).toEqual({
            value: "{service} songs, {date}",
        });
        expect(parsed("emailSubjectTemplate", "This Sunday's songs")).toEqual({
            value: "This Sunday's songs",
        });
        // Only a {name} with both braces is a placeholder.
        expect(parsed("emailSubjectTemplate", "Songs { date")).toEqual({ value: "Songs { date" });
    });

    test("refuses a placeholder it does not know", () => {
        expect(parsed("emailSubjectTemplate", "Songs for {Date}")).toEqual({
            message: '"{Date}" is not a placeholder the subject can hold: use {date} or {service}.',
        });
        for (const value of ["{title}", "Songs {}", "{date} {service} {plan}"]) {
            expect(refused("emailSubjectTemplate", value)).toBe(true);
        }
    });

    test("refuses a blank subject, a line break, a long one, or one that is not text", () => {
        for (const value of ["", "  ", "Songs\r\nBcc: x@y.org", "x".repeat(EMAIL_SUBJECT_MAX_LENGTH + 1), 1, null]) {
            expect(refused("emailSubjectTemplate", value)).toBe(true);
        }
        expect(parsed("emailSubjectTemplate", "x".repeat(EMAIL_SUBJECT_MAX_LENGTH))).toEqual({
            value: "x".repeat(EMAIL_SUBJECT_MAX_LENGTH),
        });
    });
});

describe("hasControlCharacter", () => {
    test("finds a line break, a tab or another C0 or C1 control character, and nothing else", () => {
        for (const text of ["a\nb", "a\rb", "a\tb", "\u0000", "a\u007fb", `a${String.fromCharCode(0x85)}b`]) {
            expect([text, hasControlCharacter(text)]).toEqual([text, true]);
        }
        for (const text of ["", "Words by", "Songs for {date} · {service}", `${String.fromCharCode(0xa0)}`]) {
            expect([text, hasControlCharacter(text)]).toEqual([text, false]);
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
                { key: "reportPeriod", value: '"weekly"' },
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
