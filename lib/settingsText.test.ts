import { describe, expect, test } from "vitest";
import { HYMN_NOTE_TUNE_SEPARATOR } from "./hymnNotes";
import { describeRepeatWarning } from "./repeatWarnings";
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
    previewRepeatWarnings,
    CREDITS_NOT_REREAD_MESSAGE,
    EMAIL_RECIPIENTS_HINT,
    EMAIL_SUBJECT_HINT,
    EMAIL_SUBJECT_SAMPLE_PLAN,
    NO_RECIPIENTS_PREVIEW,
    creditPairPhraseHint,
    creditPhraseHint,
    creditRoleLegend,
    describeRederivedCredits,
    previewCreditLines,
    previewEmailSubject,
    previewRecipients,
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

describe("the repeat warning setting", () => {
    test("is named, and edited by the Repeat warnings card", () => {
        expect(SETTING_DESCRIPTIONS.repeatWarningWeeks).toEqual({
            label: "Repeat warning window",
            card: "Repeat warnings",
        });
        expect(SETTINGS_CARD_TITLES.repeatWarnings).toBe("Repeat warnings");
    });

    test("names itself and its default when its stored value no longer parses", () => {
        expect(describeSettingIssue(issue("repeatWarningWeeks", "99", "Too many."))).toEqual({
            label: "Repeat warning window",
            card: "Repeat warnings",
            stored: "99",
            message: "Too many.",
            usingDefault: "The default is in use: 6 weeks.",
        });
    });
});

describe("previewRepeatWarnings", () => {
    test("says how far back a song counts as sung lately, and the words its card then says", () => {
        expect(previewRepeatWarnings("6")).toBe(
            'A song sung in the last 6 weeks is flagged on its card, for example "Sung Sep 20 (2 weeks ago)".'
        );
        expect(previewRepeatWarnings("52")).toContain("in the last 52 weeks");
    });

    test("says a week in the singular", () => {
        expect(previewRepeatWarnings("1")).toContain("in the last week is");
    });

    test("says the warnings are off for 0", () => {
        expect(previewRepeatWarnings("0")).toBe("The warnings are off: no song's card is flagged.");
        expect(previewRepeatWarnings(" 0 ")).toBe("The warnings are off: no song's card is flagged.");
    });

    test("takes the digits as the form posts them, with spaces around", () => {
        expect(previewRepeatWarnings("  8 ")).toContain("in the last 8 weeks");
    });

    test.each(["", "  ", "abc", "-1", "1.5", "53", "6 weeks", "1e2"])(
        "has nothing to say of %j, which the setting refuses",
        (value) => {
            expect(previewRepeatWarnings(value)).toBeNull();
        }
    );

    test("uses the words a card uses", () => {
        // The same function, so the preview cannot drift from the card.
        expect(previewRepeatWarnings("6")).toContain(describeRepeatWarning({ planDate: "2026-09-20", daysAgo: 14 }));
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
        expect(usingDefault("repeatWarningWeeks")).toBe("The default is in use: 6 weeks.");
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

    test("several categories of the name are a warning with the data layer's sentence", () => {
        const message =
            'Sunday Morning has 2 item note categories named "Hymnal" ("Hymnal" and "hymnal"), so the hymnal notes have no one place to go. Rename or delete all but one in Planning Center.';
        expect(describeCategoryLookup({ status: "ambiguous", message })).toEqual({
            tone: "warning",
            status: "More than one",
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

describe("creditRoleLegend", () => {
    test("says the first two roles are the words' and the music's", () => {
        expect(creditRoleLegend(0)).toBe("Role 1 (the words)");
        expect(creditRoleLegend(1)).toBe("Role 2 (the music)");
        expect(creditRoleLegend(2)).toBe("Role 3");
        expect(creditRoleLegend(11)).toBe("Role 12");
    });
});

describe("creditPhraseHint", () => {
    test("says what a blank phrase prints", () => {
        expect(creditPhraseHint("Words")).toBe('Left blank, it reads "Words by".');
        expect(creditPhraseHint("  Arr. ")).toBe('Left blank, it reads "Arr. by".');
        expect(creditPhraseHint("")).toBe('Left blank, it reads "the role by".');
    });
});

describe("creditPairPhraseHint", () => {
    test("says what a blank phrase for the first two roles together prints", () => {
        expect(creditPairPhraseHint("Words", "Music")).toBe('Left blank, it reads "Words and Music by".');
        expect(creditPairPhraseHint(" Lyrics ", "Tune")).toBe('Left blank, it reads "Lyrics and Tune by".');
        expect(creditPairPhraseHint("", " ")).toBe(
            'Left blank, it reads "the first role and the second role by".'
        );
    });
});

describe("previewCreditLines", () => {
    const DEFAULT_ROWS = [
        { role: "Words", phrase: "Words by" },
        { role: "Music", phrase: "Music by" },
        { role: "Arr.", phrase: "Arr. by" },
        { role: "Trans.", phrase: "Trans. by" },
    ];

    test("prints the default roles as the copyright text does", () => {
        expect(previewCreditLines(DEFAULT_ROWS, "Words and Music by")).toEqual({
            apart: "Words by Isaac Watts. Music by Lowell Mason. Arr. by John Doe. Trans. by Jane Roe.",
            together: "Words and Music by John Newton.",
        });
    });

    test("follows the phrases and the roles as they are typed", () => {
        expect(
            previewCreditLines(
                [
                    { role: "Lyrics", phrase: "Text by" },
                    { role: "Tune", phrase: " Melody by " },
                ],
                "Text and melody by"
            )
        ).toEqual({
            apart: "Text by Isaac Watts. Melody by Lowell Mason.",
            together: "Text and melody by John Newton.",
        });
    });

    test("prints '<role> by' for a blank phrase, and '<role> and <role> by' for a blank pair phrase", () => {
        expect(
            previewCreditLines(
                [
                    { role: "Lyrics", phrase: "" },
                    { role: "Tune", phrase: "  " },
                ],
                ""
            )
        ).toEqual({
            apart: "Lyrics by Isaac Watts. Tune by Lowell Mason.",
            together: "Lyrics and Tune by John Newton.",
        });
    });

    test("leaves out a role that is blank, has a separator or is listed twice, and a phrase that is too long", () => {
        expect(
            previewCreditLines(
                [
                    { role: "Words", phrase: "x".repeat(41) },
                    { role: "", phrase: "Nothing by" },
                    { role: "Music", phrase: "Music by" },
                    { role: "words", phrase: "Again by" },
                    { role: "A, B", phrase: "Both by" },
                ],
                "Words and Music by"
            )
        ).toEqual({
            apart: "Words by Isaac Watts. Music by Lowell Mason.",
            together: "Words and Music by John Newton.",
        });
    });

    test("is null when fewer than two roles can be read", () => {
        expect(previewCreditLines([], "x")).toBeNull();
        expect(previewCreditLines([{ role: "Words", phrase: "Words by" }], "x")).toBeNull();
        expect(
            previewCreditLines(
                [
                    { role: "Words", phrase: "" },
                    { role: "Words", phrase: "" },
                ],
                ""
            )
        ).toBeNull();
    });

    test("gives every role a name, and never the same one to two next to each other", () => {
        const rows = Array.from({ length: 12 }, (_, i) => ({ role: `Role ${i}`, phrase: "" }));
        const preview = previewCreditLines(rows, "");
        expect(preview?.apart.match(/Role \d+ by/g)).toHaveLength(12);
        expect(preview?.apart).not.toContain(" and ");
    });
});

describe("describeRederivedCredits", () => {
    test("says how many songs were read again, and how they read", () => {
        expect(describeRederivedCredits({ songs: 397, ok: 3, legacy: 390, unparsed: 4 })).toBe(
            "Saved. Read the credits of 397 songs again: 3 follow the roles, 390 have no labels and 4 have labels that no role matches."
        );
    });

    test("leaves out a status no song has, and words one song in the singular", () => {
        expect(describeRederivedCredits({ songs: 8, ok: 0, legacy: 8, unparsed: 0 })).toBe(
            "Saved. Read the credits of 8 songs again: 8 have no labels."
        );
        expect(describeRederivedCredits({ songs: 1, ok: 1, legacy: 0, unparsed: 0 })).toBe(
            "Saved. Read the credits of 1 song again: 1 follows the roles."
        );
        expect(describeRederivedCredits({ songs: 2, ok: 1, legacy: 0, unparsed: 1 })).toBe(
            "Saved. Read the credits of 2 songs again: 1 follows the roles and 1 has labels that no role matches."
        );
    });

    test("says there were no songs to read, with none synced yet", () => {
        expect(describeRederivedCredits({ songs: 0, ok: 0, legacy: 0, unparsed: 0 })).toBe(
            "Saved. No songs have been synced from Planning Center yet, so there were no credits to read again."
        );
    });

    test("has a message for credits that could not be read again, which says when they will be", () => {
        expect(CREDITS_NOT_REREAD_MESSAGE).toContain("roles were saved");
        expect(CREDITS_NOT_REREAD_MESSAGE).toContain("next song sync");
    });
});

describe("previewEmailSubject", () => {
    test("gives the default subject for a sample plan", () => {
        expect(previewEmailSubject(DEFAULT_SETTINGS.emailSubjectTemplate)).toBe(
            "Songs for 10/4/26 \u00b7 Sunday Morning"
        );
        expect(EMAIL_SUBJECT_SAMPLE_PLAN).toBe("a Sunday Morning plan for October 4, 2026");
    });

    test("fills in each placeholder, and leaves a template without any as it is", () => {
        expect(previewEmailSubject("{service}: {date}")).toBe("Sunday Morning: 10/4/26");
        expect(previewEmailSubject("  This week's songs  ")).toBe("This week's songs");
    });

    test("is null for a subject the setting does not accept", () => {
        expect(previewEmailSubject("")).toBeNull();
        expect(previewEmailSubject("Songs for {when}")).toBeNull();
        expect(previewEmailSubject("a\nb")).toBeNull();
        expect(previewEmailSubject("x".repeat(151))).toBeNull();
    });

    test("explains both placeholders", () => {
        expect(EMAIL_SUBJECT_HINT).toContain("{date}");
        expect(EMAIL_SUBJECT_HINT).toContain("{service}");
        expect(EMAIL_RECIPIENTS_HINT).toContain("each line");
    });
});

describe("previewRecipients", () => {
    test("says how many people the email goes to", () => {
        expect(previewRecipients("a@example.org")).toBe("The email goes to 1 recipient.");
        expect(previewRecipients("a@example.org\nb@example.org, c@example.org")).toBe(
            "The email goes to 3 recipients."
        );
    });

    test("says that nothing is sent until there are recipients", () => {
        expect(previewRecipients("")).toBe(NO_RECIPIENTS_PREVIEW);
        expect(previewRecipients(" \n, ")).toBe(NO_RECIPIENTS_PREVIEW);
        expect(NO_RECIPIENTS_PREVIEW).toContain("sends nothing");
    });

    test("names the entries that are not addresses, the first few", () => {
        expect(previewRecipients("a@example.org, pastor")).toBe('Not an email address: "pastor".');
        expect(previewRecipients("one, two, three, four, five")).toBe(
            'Not an email address: "one", "two", "three" and 2 more.'
        );
    });

    test("says what is wrong with the list when each entry is an address", () => {
        expect(previewRecipients("a@example.org, A@example.org")).toBe('"A@example.org" is listed twice.');
        const many = Array.from({ length: 26 }, (_, i) => `p${i}@example.org`).join(", ");
        expect(previewRecipients(many)).toBe("List at most 25 recipients.");
    });
});
