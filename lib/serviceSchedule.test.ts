import { afterAll, describe, expect, test } from "vitest";
import { planDateFromSortDate } from "./format";
import {
    buildScheduleCopyText,
    catalogMatchFor,
    formatScheduleNumbers,
    scheduleEntries,
    type ScheduleCatalog,
    type ScheduleEntry,
    type ScheduleItem,
} from "./serviceSchedule";

// Characterization tests: they pin what the code did when it was moved out of
// ServiceSchedule.tsx, quirks included. A test marked QUIRK documents behavior
// that looks wrong but is deliberately kept; fix commits flip those assertions.

// The plan's calendar date, as buildScheduleCopyText takes it.
const PLAN_DATE = "2025-06-15";
const HEADER_AM = "Sunday AM 6/15/25\n\n";
const HEADER_PM = "Sunday PM 6/15/25\n\n";

/** The Planning Center song that the song items below schedule, unless they say otherwise. */
const SONG = "100";

function entry(
    bookCode: string,
    number: number | null,
    variantNote: string | null = null
): ScheduleEntry {
    return { bookCode, number, variantNote };
}

/** A catalog in which Planning Center song `songId` is linked to a song with these entries. */
function linked(entries: ScheduleEntry[], songId: string = SONG): ScheduleCatalog {
    return { [songId]: { entries } };
}

function songItem(
    title: string,
    sequence: number,
    selection: Partial<ScheduleItem> = {}
): ScheduleItem {
    return { title, itemType: "song", sequence, songId: SONG, ...selection };
}

/** A plan item that is not a song, such as a header. */
function otherItem(title: string, itemType: string, sequence: number): ScheduleItem {
    return { title, itemType, sequence, songId: null };
}

/** The copy text under a service type name that gets no header. */
function textFor(items: ScheduleItem[], catalog: ScheduleCatalog = {}): string {
    return buildScheduleCopyText({
        items,
        catalog,
        serviceTypeName: "Midweek",
        planDate: PLAN_DATE,
    });
}

/** The single line for one song item titled "T" with the given selections. */
function lineFor(
    selection: Partial<ScheduleItem>,
    catalog: ScheduleCatalog = {}
): string {
    return textFor([songItem("T", 1, selection)], catalog);
}

const BOTH = [entry("R", 12), entry("G", 34)]; // R-12/G-34
const RJ_ONLY = [entry("R", 12)]; // R-12
const GR_ONLY = [entry("G", 34)]; // G-34
const NEITHER: ScheduleEntry[] = []; // in no book

describe("formatScheduleNumbers", () => {
    test("joins the numbers with '/', each as its book's code and number", () => {
        expect(formatScheduleNumbers(BOTH)).toBe("R-12/G-34");
    });

    test("a song in one book has one number", () => {
        expect(formatScheduleNumbers(RJ_ONLY)).toBe("R-12");
        expect(formatScheduleNumbers(GR_ONLY)).toBe("G-34");
    });

    test("is empty for a song in no book", () => {
        expect(formatScheduleNumbers(NEITHER)).toBe("");
    });

    test("keeps the entries' order, which is the books' order", () => {
        expect(formatScheduleNumbers([entry("G", 34), entry("R", 12)])).toBe(
            "G-34/R-12"
        );
    });

    test("an entry with no number prints 0, as hymns.json had the Doxology's front cover", () => {
        expect(formatScheduleNumbers([entry("R", 14), entry("G", null)])).toBe(
            "R-14/G-0"
        );
    });

    test("leaves out a descant printed beside the hymn's own numbers", () => {
        expect(
            formatScheduleNumbers([
                entry("R", 28),
                entry("R", 29, "Descant - Last Chorus only"),
                entry("G", 37),
            ])
        ).toBe("R-28/G-37");
    });

    test("prints the variants when the song has nothing else, as a round printed only as a round", () => {
        expect(formatScheduleNumbers([entry("R", 693, "A Round")])).toBe("R-693");
        expect(
            formatScheduleNumbers([entry("R", 6, "A Round"), entry("G", 9, "Descant")])
        ).toBe("R-6/G-9");
    });
});

describe("scheduleEntries", () => {
    test("gives the entries without a variant note, or all of them when each has one", () => {
        const plain = entry("R", 28);
        const descant = entry("R", 29, "Descant");
        expect(scheduleEntries([plain, descant])).toEqual([plain]);
        expect(scheduleEntries([descant])).toEqual([descant]);
        expect(scheduleEntries([])).toEqual([]);
    });

    test("counts a blank variant note as none", () => {
        const blank = entry("R", 1, "  ");
        expect(scheduleEntries([blank, entry("R", 2, "Descant")])).toEqual([blank]);
    });

    test("gives the entries themselves, in their order, in a new array", () => {
        const entries = [entry("G", 34), entry("R", 12)];
        const picked = scheduleEntries(entries);
        expect(picked).not.toBe(entries);
        expect(picked[0]).toBe(entries[0]);
        expect(picked[1]).toBe(entries[1]);
    });
});

describe("catalogMatchFor", () => {
    const catalog = linked(BOTH);

    test("finds the catalog song an item's Planning Center song is linked to", () => {
        expect(catalogMatchFor(catalog, SONG)).toBe(catalog[SONG]);
    });

    test("finds nothing for an item with no Planning Center song, or a song that is not linked", () => {
        expect(catalogMatchFor(catalog, null)).toBeUndefined();
        expect(catalogMatchFor(catalog, "999")).toBeUndefined();
    });

    test("reads only the catalog's own keys", () => {
        expect(catalogMatchFor(catalog, "constructor")).toBeUndefined();
        expect(catalogMatchFor(catalog, "__proto__")).toBeUndefined();
        expect(catalogMatchFor(catalog, "toString")).toBeUndefined();
    });
});

describe("buildScheduleCopyText: header", () => {
    test("'Sunday Morning' gets a 'Sunday AM <M/D/YY>' header and a blank line", () => {
        const text = buildScheduleCopyText({
            items: [songItem("T", 1)],
            catalog: {},
            serviceTypeName: "Sunday Morning",
            planDate: PLAN_DATE,
        });
        expect(text).toBe(HEADER_AM + "T");
    });

    test("'Sunday Evening' gets a 'Sunday PM <M/D/YY>' header", () => {
        const text = buildScheduleCopyText({
            items: [songItem("T", 1)],
            catalog: {},
            serviceTypeName: "Sunday Evening",
            planDate: PLAN_DATE,
        });
        expect(text).toBe(HEADER_PM + "T");
    });

    test("with no songs the output is just the header, including its blank line", () => {
        const morning = buildScheduleCopyText({
            items: [],
            catalog: {},
            serviceTypeName: "Sunday Morning",
            planDate: PLAN_DATE,
        });
        const evening = buildScheduleCopyText({
            items: [otherItem("Welcome", "header", 1)],
            catalog: {},
            serviceTypeName: "Sunday Evening",
            planDate: PLAN_DATE,
        });
        expect(morning).toBe("Sunday AM 6/15/25\n\n");
        expect(evening).toBe("Sunday PM 6/15/25\n\n");
    });

    test("only the exact names get a header (not 'sunday morning' or 'Sunday Morning ')", () => {
        for (const serviceTypeName of [
            "sunday morning",
            "Sunday Morning ",
            " Sunday Evening",
            "SUNDAY EVENING",
            "Sunday",
            "Wednesday Evening",
            "",
        ]) {
            const text = buildScheduleCopyText({
                items: [songItem("T", 1)],
                catalog: {},
                serviceTypeName,
                planDate: PLAN_DATE,
            });
            expect(text).toBe("T");
        }
    });

    test("the date is month/day/2-digit-year without zero padding", () => {
        const january = buildScheduleCopyText({
            items: [],
            catalog: {},
            serviceTypeName: "Sunday Morning",
            planDate: "2025-01-05",
        });
        const december = buildScheduleCopyText({
            items: [],
            catalog: {},
            serviceTypeName: "Sunday Evening",
            planDate: "2030-12-25",
        });
        expect(january).toBe("Sunday AM 1/5/25\n\n");
        expect(december).toBe("Sunday PM 12/25/30\n\n");
    });
});

describe("buildScheduleCopyText: header without a plan date", () => {
    // Before, an unknown date printed "Invalid Date" in the header.
    test("the header has no date, and no stray space after AM or PM", () => {
        const morning = buildScheduleCopyText({
            items: [songItem("T", 1)],
            catalog: {},
            serviceTypeName: "Sunday Morning",
            planDate: null,
        });
        const evening = buildScheduleCopyText({
            items: [songItem("T", 1)],
            catalog: {},
            serviceTypeName: "Sunday Evening",
            planDate: null,
        });
        expect(morning).toBe("Sunday AM\n\nT");
        expect(evening).toBe("Sunday PM\n\nT");
    });

    test("with no songs the output is just the header and its blank line", () => {
        expect(
            buildScheduleCopyText({
                items: [],
                catalog: {},
                serviceTypeName: "Sunday Morning",
                planDate: null,
            })
        ).toBe("Sunday AM\n\n");
        expect(
            buildScheduleCopyText({
                items: [],
                catalog: {},
                serviceTypeName: "Sunday Evening",
                planDate: null,
            })
        ).toBe("Sunday PM\n\n");
    });

    test("never prints 'Invalid Date'", () => {
        const text = buildScheduleCopyText({
            items: [songItem("T", 1)],
            catalog: {},
            serviceTypeName: "Sunday Morning",
            planDate: planDateFromSortDate("not a date"),
        });
        expect(text).not.toContain("Invalid");
        expect(text).toBe("Sunday AM\n\nT");
    });

    test("service types without a header are unaffected", () => {
        expect(
            buildScheduleCopyText({
                items: [songItem("T", 1)],
                catalog: {},
                serviceTypeName: "Midweek",
                planDate: null,
            })
        ).toBe("T");
    });
});

describe("buildScheduleCopyText: header date and time zones", () => {
    // The header used to format `new Date(plan.sortDate)` in the viewer's zone,
    // so an early or late service landed on the previous or next day.
    const originalTimeZone = process.env.TZ;

    afterAll(() => {
        if (originalTimeZone === undefined) {
            delete process.env.TZ;
        } else {
            process.env.TZ = originalTimeZone;
        }
    });

    const oldHeaderDate = (sortDate: string): string =>
        new Date(sortDate).toLocaleDateString("en-US", {
            month: "numeric",
            day: "numeric",
            year: "2-digit",
        });

    test.each([
        // zone, its UTC offset in minutes on 2025-06-15, sort_date, what the old code printed
        ["Pacific/Pago_Pago", 660, "2025-06-15T08:00:00Z", "6/14/25"],
        ["Pacific/Kiritimati", -840, "2025-06-15T18:00:00Z", "6/16/25"],
        ["America/New_York", 240, "2025-06-15T02:00:00Z", "6/14/25"],
    ])(
        "in %s the header shows the plan's own date",
        (zone, utcOffsetMinutes, sortDate, oldDate) => {
            process.env.TZ = zone;
            // Guard: if this runtime ignored the change, the test would prove nothing.
            expect(
                new Date(Date.UTC(2025, 5, 15, 12)).getTimezoneOffset()
            ).toBe(utcOffsetMinutes);
            expect(oldHeaderDate(sortDate)).toBe(oldDate);

            const text = buildScheduleCopyText({
                items: [],
                catalog: {},
                serviceTypeName: "Sunday Morning",
                planDate: planDateFromSortDate(sortDate),
            });
            expect(text).toBe("Sunday AM 6/15/25\n\n");
        }
    );
});

describe("buildScheduleCopyText: which lines appear", () => {
    test("only song items appear, in sequence order", () => {
        const items: ScheduleItem[] = [
            songItem("Third", 30),
            otherItem("Welcome", "header", 5),
            songItem("First", 10),
            otherItem("Second", "item", 15),
            otherItem("Second", "Song", 16),
            songItem("Second", 20),
            otherItem("Video", "media", 25),
        ];
        expect(textFor(items)).toBe("First\nSecond\nThird");
    });

    test("lines are joined with '\\n' and there is no trailing newline", () => {
        const text = textFor([songItem("A", 1), songItem("B", 2)]);
        expect(text).toBe("A\nB");
        expect(text.endsWith("\n")).toBe(false);
    });

    test("with the header, the first line follows the blank line", () => {
        const text = buildScheduleCopyText({
            items: [songItem("A", 2), songItem("B", 1)],
            catalog: {},
            serviceTypeName: "Sunday Evening",
            planDate: PLAN_DATE,
        });
        expect(text).toBe("Sunday PM 6/15/25\n\nB\nA");
    });

    test("is empty without a header when there are no song items", () => {
        expect(textFor([])).toBe("");
        expect(textFor([otherItem("Welcome", "header", 1)])).toBe("");
    });

    test("items with equal sequence keep their input order", () => {
        expect(textFor([songItem("B", 1), songItem("A", 1)])).toBe("B\nA");
    });

    test("a song appearing twice gets a line per item", () => {
        expect(textFor([songItem("A", 1), songItem("A", 2)])).toBe("A\nA");
    });

    test("does not reorder or modify the items passed in", () => {
        const items = [
            songItem("B", 2, { selectedOption: "Custom", customText: "x" }),
            otherItem("Welcome", "header", 0),
            songItem("A", 1),
        ];
        const snapshot = JSON.stringify(items);
        textFor(items, linked(BOTH));
        expect(JSON.stringify(items)).toBe(snapshot);
    });
});

describe("buildScheduleCopyText: song that is not linked", () => {
    test("Custom with text appends it in parentheses", () => {
        expect(lineFor({ selectedOption: "Custom", customText: "x" })).toBe(
            "T (x)"
        );
    });

    test("Custom with empty or missing text is just the title", () => {
        expect(lineFor({ selectedOption: "Custom", customText: "" })).toBe("T");
        expect(lineFor({ selectedOption: "Custom" })).toBe("T");
    });

    test("'Leave blank' is just the title, even with leftover custom text", () => {
        expect(lineFor({ selectedOption: "Leave blank" })).toBe("T");
        expect(
            lineFor({ selectedOption: "Leave blank", customText: "x" })
        ).toBe("T");
    });

    test("no selection is just the title, whatever else the item carries", () => {
        expect(lineFor({})).toBe("T");
        expect(lineFor({ customText: "x", selectedVersionIndex: 1 })).toBe("T");
    });

    test("QUIRK: whitespace-only custom text is printed as-is", () => {
        expect(lineFor({ selectedOption: "Custom", customText: "   " })).toBe(
            "T (   )"
        );
    });

    test("another Planning Center song's link does not count", () => {
        expect(lineFor({}, linked(BOTH, "999"))).toBe("T");
    });

    test("an item with no Planning Center song has no link", () => {
        expect(lineFor({ songId: null }, linked(BOTH))).toBe("T");
    });
});

describe("buildScheduleCopyText: song linked to a catalog song", () => {
    const both = linked(BOTH);

    test("prints the song's numbers", () => {
        expect(lineFor({}, both)).toBe("T (R-12/G-34)");
        expect(lineFor({ selectedVersionIndex: 0 }, both)).toBe("T (R-12/G-34)");
    });

    test("a song in one book prints its one number, and a song in no book just the title", () => {
        expect(lineFor({}, linked(RJ_ONLY))).toBe("T (R-12)");
        expect(lineFor({}, linked(GR_ONLY))).toBe("T (G-34)");
        expect(lineFor({}, linked(NEITHER))).toBe("T");
    });

    // The version picker is gone: a Planning Center song is one hymn to one
    // tune, so it links to one catalog song with one set of numbers.
    test("a version index changes nothing, in range or not", () => {
        for (const selectedVersionIndex of [1, 2, 3, 4]) {
            expect(lineFor({ selectedVersionIndex }, both)).toBe("T (R-12/G-34)");
        }
    });

    test("Custom with text replaces the numbers", () => {
        expect(
            lineFor(
                {
                    selectedOption: "Custom",
                    customText: "x",
                    selectedVersionIndex: 2,
                },
                both
            )
        ).toBe("T (x)");
    });

    test("Custom with empty or missing text is just the title, not the numbers", () => {
        expect(
            lineFor({ selectedOption: "Custom", customText: "" }, both)
        ).toBe("T");
        expect(lineFor({ selectedOption: "Custom" }, both)).toBe("T");
    });

    test("QUIRK: whitespace-only custom text is printed as-is", () => {
        expect(
            lineFor({ selectedOption: "Custom", customText: "   " }, both)
        ).toBe("T (   )");
    });

    test("QUIRK: 'Leave blank' still prints the numbers", () => {
        expect(lineFor({ selectedOption: "Leave blank" }, both)).toBe(
            "T (R-12/G-34)"
        );
        expect(
            lineFor({ selectedOption: "Leave blank", selectedVersionIndex: 1 }, both)
        ).toBe("T (R-12/G-34)");
        expect(lineFor({ selectedOption: "Leave blank" }, linked(NEITHER))).toBe(
            "T"
        );
    });

    test("custom text is ignored unless the option is Custom", () => {
        expect(lineFor({ customText: "x" }, both)).toBe("T (R-12/G-34)");
    });

    test("the Doxology prints its front cover as G-0", () => {
        expect(
            textFor([songItem("Doxology", 1)], linked([entry("R", 14), entry("G", null)]))
        ).toBe("Doxology (R-14/G-0)");
    });
});

describe("buildScheduleCopyText: finding a song by its link", () => {
    const catalog = linked(BOTH);

    test("the item's own title is printed, not the catalog's", () => {
        expect(textFor([songItem("Amazing Grace", 1)], catalog)).toBe(
            "Amazing Grace (R-12/G-34)"
        );
        expect(textFor([songItem("amazing grace", 1)], catalog)).toBe(
            "amazing grace (R-12/G-34)"
        );
    });

    test("an item renamed in the plan keeps its song's numbers", () => {
        expect(
            textFor([songItem("Amazing Grace (Acoustic)", 1)], catalog)
        ).toBe("Amazing Grace (Acoustic) (R-12/G-34)");
    });

    // Titles used to be matched against the hymnbooks (ignoring case,
    // punctuation, spacing and quote styles); now only the link counts.
    test("a title alone finds nothing: an item whose song is not linked prints just its title", () => {
        expect(
            textFor([songItem("Amazing Grace", 1, { songId: "999" })], catalog)
        ).toBe("Amazing Grace");
        expect(
            textFor([songItem("Amazing Grace", 1, { songId: null })], catalog)
        ).toBe("Amazing Grace");
    });

    test("items that schedule the same song each print its numbers", () => {
        expect(
            textFor([songItem("Amazing Grace", 1), songItem("Amazing Grace, Reprise", 2)], catalog)
        ).toBe("Amazing Grace (R-12/G-34)\nAmazing Grace, Reprise (R-12/G-34)");
    });

    test("each item is found by its own song and carries its own selection", () => {
        const catalog2: ScheduleCatalog = {
            "1": { entries: BOTH },
            "2": { entries: GR_ONLY },
        };
        const items = [
            songItem("Beta", 2, { songId: "2" }),
            songItem("Alpha", 1, {
                songId: "1",
                selectedOption: "Custom",
                customText: "mine",
            }),
            songItem("Gamma", 3, {
                songId: null,
                selectedOption: "Custom",
                customText: "free",
            }),
        ];
        expect(textFor(items, catalog2)).toBe(
            "Alpha (mine)\nBeta (G-34)\nGamma (free)"
        );
    });
});
