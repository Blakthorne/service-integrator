import { describe, expect, test } from "vitest";
import { buildCopyrightCopyAllText } from "./copyright";
import { planDateFromSortDate } from "./format";
import {
    buildPlanEmail,
    formatPlanEmailSubject,
    type PlanEmailDetail,
    type PlanEmailItem,
} from "./planEmail";
import { mergeScheduleSelections } from "./scheduleSelections";
import { buildScheduleCopyText } from "./serviceSchedule";
import { DEFAULT_SETTINGS, planTextSettings, type AppSettings } from "./settings";

const SUNDAY_MORNING = { id: "1405391", name: "Sunday Morning" };
const PLAN = { dates: "October 4, 2026", sortDate: "2026-10-04T11:00:00Z" };

function item(
    id: string,
    sequence: number,
    title: string,
    fields: Partial<PlanEmailItem> = {}
): PlanEmailItem {
    return { id, title, itemType: "song", sequence, songId: null, song: null, ...fields };
}

/**
 * A plan, out of order as Planning Center may list it: Amazing Grace (linked,
 * R-396 and G-317), a header, O God, Our Help (linked, R-28, sung with custom
 * text), Shout to the Lord (not linked), and a song item with no Planning
 * Center song.
 */
const ITEMS: PlanEmailItem[] = [
    item("4", 4, "Shout to the Lord", {
        songId: "1099",
        song: {
            title: "Shout to the Lord",
            author: "Darlene Zschech",
            copyright: "1993 Wondrous Worship",
            admin: "Music Services",
        },
    }),
    item("1", 1, "Amazing Grace", {
        songId: "1001",
        song: { title: "Amazing Grace", author: "John Newton", copyright: "Public Domain", admin: null },
    }),
    item("2", 2, "Sermon", { itemType: "header" }),
    item("3", 3, "O God, Our Help", {
        songId: "1002",
        song: {
            title: "O God, Our Help in Ages Past",
            author: "Words: Isaac Watts; Music: William Croft",
            copyright: null,
            admin: null,
        },
    }),
    item("5", 5, "Doxology"),
];

const CATALOG = {
    "1001": {
        entries: [
            { label: "R-396", variantNote: null },
            { label: "G-317", variantNote: null },
        ],
    },
    "1002": { entries: [{ label: "R-28", variantNote: null }] },
};

const SELECTIONS = { "3": { option: "custom" as const, customText: "vv. 1, 2 & 5" } };

function detail(overrides: Partial<PlanEmailDetail> = {}): PlanEmailDetail {
    return {
        plan: PLAN,
        serviceType: SUNDAY_MORNING,
        items: ITEMS,
        catalog: CATALOG,
        selections: SELECTIONS,
        scheduleSettings: planTextSettings(DEFAULT_SETTINGS, SUNDAY_MORNING),
        ...overrides,
    };
}

const FOOTER = "Used by permission. CCLI Streaming License 1564484.";

describe("buildPlanEmail", () => {
    test("is the plan's label, its schedule text and its songs' copyright blocks", () => {
        expect(buildPlanEmail(detail(), DEFAULT_SETTINGS)).toEqual({
            subject: "Songs for 10/4/26 · Sunday Morning",
            text: [
                "October 4, 2026 · Sunday Morning",
                "",
                "Sunday AM 10/4/26",
                "",
                "Amazing Grace (R-396 / G-317)",
                "O God, Our Help (vv. 1, 2 & 5)",
                "Shout to the Lord",
                "Doxology",
                "",
                '"Amazing Grace" Words and Music by John Newton.',
                "Public Domain.",
                FOOTER,
                "",
                '"O God, Our Help in Ages Past" Words by Isaac Watts. Music by William Croft.',
                "Public Domain.",
                FOOTER,
                "",
                '"Shout to the Lord" Words and Music by Darlene Zschech.',
                "© 1993 Wondrous Worship. Admin. by Music Services.",
                FOOTER,
                "",
            ].join("\n"),
        });
    });

    test("with the default settings, prints exactly today's Copy All texts of both tabs", () => {
        const { text } = buildPlanEmail(detail(), DEFAULT_SETTINGS);
        // What the Schedule and Copyright tabs copy, which take no settings.
        const schedule = buildScheduleCopyText({
            items: mergeScheduleSelections(ITEMS, SELECTIONS, CATALOG),
            catalog: CATALOG,
            serviceTypeName: SUNDAY_MORNING.name,
            planDate: planDateFromSortDate(PLAN.sortDate),
        });
        const copyright = buildCopyrightCopyAllText(ITEMS);
        expect(text).toBe(`October 4, 2026 · Sunday Morning\n\n${schedule}\n\n${copyright}\n`);
    });

    test("follows the plan's text settings: header, separator, CCLI number and credit phrases", () => {
        const settings: AppSettings = {
            ...DEFAULT_SETTINGS,
            scheduleHeaderLabels: { [SUNDAY_MORNING.id]: "Morning Worship" },
            numberSeparator: ", ",
            ccliLicenseNumber: "999",
            creditPhrases: { ...DEFAULT_SETTINGS.creditPhrases, Words: "Text by", Music: "Tune by" },
        };
        const { text } = buildPlanEmail(
            detail({ scheduleSettings: planTextSettings(settings, SUNDAY_MORNING) }),
            settings
        );
        expect(text).toContain("\n\nMorning Worship 10/4/26\n\nAmazing Grace (R-396, G-317)\n");
        expect(text).toContain(
            '"O God, Our Help in Ages Past" Text by Isaac Watts. Tune by William Croft.\n'
        );
        expect(text).toContain("Used by permission. CCLI Streaming License 999.");
        expect(text).not.toContain("1564484");
    });

    test("prints each song as chosen, and Numbers by default only for a linked song", () => {
        const { text } = buildPlanEmail(
            detail({
                selections: {
                    "1": { option: "blank" },
                    "3": { option: "numbers" },
                    "4": { option: "custom", customText: "Key of A" },
                },
            }),
            DEFAULT_SETTINGS
        );
        expect(text).toContain("\nAmazing Grace\nO God, Our Help (R-28)\nShout to the Lord (Key of A)\nDoxology\n");
    });

    test("leaves out the header when the settings give none", () => {
        const settings: AppSettings = {
            ...DEFAULT_SETTINGS,
            scheduleHeaderLabels: { [SUNDAY_MORNING.id]: "" },
        };
        const { text } = buildPlanEmail(
            detail({ scheduleSettings: planTextSettings(settings, SUNDAY_MORNING) }),
            settings
        );
        expect(text.startsWith("October 4, 2026 · Sunday Morning\n\nAmazing Grace (R-396 / G-317)\n")).toBe(
            true
        );
    });

    test("leaves out a part with nothing in it", () => {
        const noSongs = [item("2", 2, "Sermon", { itemType: "header" })];
        expect(buildPlanEmail(detail({ items: noSongs }), DEFAULT_SETTINGS).text).toBe(
            "October 4, 2026 · Sunday Morning\n\nSunday AM 10/4/26\n"
        );

        const otherService = { id: "77", name: "Midweek" };
        expect(
            buildPlanEmail(
                detail({
                    items: noSongs,
                    serviceType: otherService,
                    scheduleSettings: planTextSettings(DEFAULT_SETTINGS, otherService),
                }),
                DEFAULT_SETTINGS
            ).text
        ).toBe("October 4, 2026 · Midweek\n");

        // Song items without songs print in the schedule but have no copyright block.
        expect(
            buildPlanEmail(detail({ items: [item("5", 5, "Doxology")] }), DEFAULT_SETTINGS).text
        ).toBe("October 4, 2026 · Sunday Morning\n\nSunday AM 10/4/26\n\nDoxology\n");
    });

    test("takes the subject from the subject template", () => {
        expect(
            buildPlanEmail(detail(), {
                emailSubjectTemplate: "{service} on {date}: the songs",
            }).subject
        ).toBe("Sunday Morning on 10/4/26: the songs");
    });
});

describe("formatPlanEmailSubject", () => {
    const subject = (
        template: string,
        plan: { dates: string; sortDate: string } = PLAN,
        serviceType: { name: string } = SUNDAY_MORNING
    ) => formatPlanEmailSubject(template, plan, serviceType);

    test("fills in the plan's short date and its service type's name, as often as they appear", () => {
        expect(subject(DEFAULT_SETTINGS.emailSubjectTemplate)).toBe(
            "Songs for 10/4/26 · Sunday Morning"
        );
        expect(subject("{date} {date} {service}{service}")).toBe(
            "10/4/26 10/4/26 Sunday MorningSunday Morning"
        );
        expect(subject("Bulletin songs")).toBe("Bulletin songs");
    });

    test("takes the date from the plan's sortDate as written, whatever the time", () => {
        expect(subject("{date}", { ...PLAN, sortDate: "2026-10-04T23:59:59Z" })).toBe("10/4/26");
        expect(subject("{date}", { ...PLAN, sortDate: "2026-12-31T00:00:00Z" })).toBe("12/31/26");
    });

    test("uses the plan's dates text when it has no date", () => {
        expect(subject("Songs for {date}", { dates: "No dates", sortDate: "" })).toBe(
            "Songs for No dates"
        );
    });

    test("leaves any other placeholder as typed", () => {
        expect(subject("{Date} {SERVICE} {plan} {} { date } {{date}} {date")).toBe(
            "{Date} {SERVICE} {plan} {} { date } {10/4/26} {date"
        );
    });

    test("puts what it fills in on one line, and takes it literally", () => {
        expect(subject("Songs: {service}", PLAN, { name: "Sunday\nEvening\t $& $1 " })).toBe(
            "Songs: Sunday Evening $& $1"
        );
        expect(subject("{date} {service}", { dates: "Oct\r\n4", sortDate: "" }, { name: "A" })).toBe(
            "Oct 4 A"
        );
    });
});
