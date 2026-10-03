import { describe, expect, test } from "vitest";
import {
    buildScheduleCopyText,
    formatHymnNumbers,
    type ScheduleHymn,
    type ScheduleHymnVersion,
    type ScheduleItem,
} from "./serviceSchedule";

// Characterization tests: they pin what the code did when it was moved out of
// ServiceSchedule.tsx, quirks included. A test marked QUIRK documents behavior
// that looks wrong but is deliberately kept; fix commits flip those assertions.

// Built from local-time parts so the header reads "6/15/25" in every time zone.
const SUNDAY = new Date(2025, 5, 15, 10, 30);
const HEADER_AM = "Sunday AM 6/15/25\n\n";
const HEADER_PM = "Sunday PM 6/15/25\n\n";

function version(rejoice: string, great: string): ScheduleHymnVersion {
    return { rejoice_hymns_number: rejoice, great_hymns_number: great };
}

function hymn(title: string, ...versions: ScheduleHymnVersion[]): ScheduleHymn {
    return { song_title: title, versions };
}

function songItem(
    title: string,
    sequence: number,
    selection: Partial<ScheduleItem> = {}
): ScheduleItem {
    return { title, itemType: "song", sequence, ...selection };
}

/** The copy text under a service type name that gets no header. */
function textFor(items: ScheduleItem[], hymnData: ScheduleHymn[] = []): string {
    return buildScheduleCopyText({
        items,
        hymnData,
        serviceTypeName: "Midweek",
        date: SUNDAY,
    });
}

/** The single line for one song item titled "T" with the given selections. */
function lineFor(
    selection: Partial<ScheduleItem>,
    hymnData: ScheduleHymn[] = []
): string {
    return textFor([songItem("T", 1, selection)], hymnData);
}

const BOTH = version("12", "34"); // R-12/G-34
const RJ_ONLY = version("12", "-1"); // R-12
const GR_ONLY = version("-1", "34"); // G-34
const NEITHER = version("-1", "-1"); // no numbers

describe("formatHymnNumbers", () => {
    test("joins the Rejoice and Great Hymns numbers with '/'", () => {
        expect(formatHymnNumbers(BOTH)).toBe("R-12/G-34");
    });

    test("leaves out a '-1' number", () => {
        expect(formatHymnNumbers(RJ_ONLY)).toBe("R-12");
        expect(formatHymnNumbers(GR_ONLY)).toBe("G-34");
    });

    test("is empty when both numbers are '-1' (the tab then shows 'TUNE ()')", () => {
        expect(formatHymnNumbers(NEITHER)).toBe("");
    });

    test("only the exact string '-1' is skipped: '0' and '' are printed", () => {
        expect(formatHymnNumbers(version("0", "0"))).toBe("R-0/G-0");
        expect(formatHymnNumbers(version("", ""))).toBe("R-/G-");
        expect(formatHymnNumbers(version("-2", "-1"))).toBe("R--2");
    });

    test("ignores the other fields of a catalog version", () => {
        const full = {
            id: "Holy-0",
            tune_name: "NICAEA",
            selected: true,
            ...BOTH,
        };
        expect(formatHymnNumbers(full)).toBe("R-12/G-34");
    });
});

describe("buildScheduleCopyText: header", () => {
    test("'Sunday Morning' gets a 'Sunday AM <M/D/YY>' header and a blank line", () => {
        const text = buildScheduleCopyText({
            items: [songItem("T", 1)],
            hymnData: [],
            serviceTypeName: "Sunday Morning",
            date: SUNDAY,
        });
        expect(text).toBe(HEADER_AM + "T");
    });

    test("'Sunday Evening' gets a 'Sunday PM <M/D/YY>' header", () => {
        const text = buildScheduleCopyText({
            items: [songItem("T", 1)],
            hymnData: [],
            serviceTypeName: "Sunday Evening",
            date: SUNDAY,
        });
        expect(text).toBe(HEADER_PM + "T");
    });

    test("with no songs the output is just the header, including its blank line", () => {
        const morning = buildScheduleCopyText({
            items: [],
            hymnData: [],
            serviceTypeName: "Sunday Morning",
            date: SUNDAY,
        });
        const evening = buildScheduleCopyText({
            items: [{ title: "Welcome", itemType: "header", sequence: 1 }],
            hymnData: [],
            serviceTypeName: "Sunday Evening",
            date: SUNDAY,
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
                hymnData: [],
                serviceTypeName,
                date: SUNDAY,
            });
            expect(text).toBe("T");
        }
    });

    test("the date is month/day/2-digit-year without zero padding", () => {
        const january = buildScheduleCopyText({
            items: [],
            hymnData: [],
            serviceTypeName: "Sunday Morning",
            date: new Date(2025, 0, 5, 10, 30),
        });
        const december = buildScheduleCopyText({
            items: [],
            hymnData: [],
            serviceTypeName: "Sunday Evening",
            date: new Date(2030, 11, 25, 18, 0),
        });
        expect(january).toBe("Sunday AM 1/5/25\n\n");
        expect(december).toBe("Sunday PM 12/25/30\n\n");
    });
});

describe("buildScheduleCopyText: which lines appear", () => {
    test("only song items appear, in sequence order", () => {
        const items: ScheduleItem[] = [
            songItem("Third", 30),
            { title: "Welcome", itemType: "header", sequence: 5 },
            songItem("First", 10),
            { title: "Second", itemType: "item", sequence: 15 },
            { title: "Second", itemType: "Song", sequence: 16 },
            songItem("Second", 20),
            { title: "Video", itemType: "media", sequence: 25 },
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
            hymnData: [],
            serviceTypeName: "Sunday Evening",
            date: SUNDAY,
        });
        expect(text).toBe("Sunday PM 6/15/25\n\nB\nA");
    });

    test("is empty without a header when there are no song items", () => {
        expect(textFor([])).toBe("");
        expect(
            textFor([{ title: "Welcome", itemType: "header", sequence: 1 }])
        ).toBe("");
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
            { title: "Welcome", itemType: "header", sequence: 0 },
            songItem("A", 1),
        ];
        const snapshot = JSON.stringify(items);
        textFor(items);
        expect(JSON.stringify(items)).toBe(snapshot);
    });
});

describe("buildScheduleCopyText: song with no hymn match", () => {
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

    test("a hymn for some other title does not match", () => {
        expect(lineFor({}, [hymn("Other", BOTH)])).toBe("T");
    });
});

describe("buildScheduleCopyText: song with a hymn match", () => {
    const single = [hymn("T", BOTH)];
    const multi = [hymn("T", BOTH, RJ_ONLY, GR_ONLY, NEITHER)];

    test("defaults to the first version", () => {
        expect(lineFor({}, single)).toBe("T (R-12/G-34)");
        expect(lineFor({ selectedVersionIndex: 0 }, single)).toBe(
            "T (R-12/G-34)"
        );
        expect(lineFor({}, multi)).toBe("T (R-12/G-34)");
    });

    test("a '-1' number is dropped, and two '-1's leave just the title", () => {
        expect(lineFor({}, [hymn("T", RJ_ONLY)])).toBe("T (R-12)");
        expect(lineFor({}, [hymn("T", GR_ONLY)])).toBe("T (G-34)");
        expect(lineFor({}, [hymn("T", NEITHER)])).toBe("T");
    });

    test("selectedVersionIndex picks that version", () => {
        expect(lineFor({ selectedVersionIndex: 1 }, multi)).toBe("T (R-12)");
        expect(lineFor({ selectedVersionIndex: 2 }, multi)).toBe("T (G-34)");
        expect(lineFor({ selectedVersionIndex: 3 }, multi)).toBe("T");
    });

    test("an out-of-range index is just the title", () => {
        expect(lineFor({ selectedVersionIndex: 4 }, multi)).toBe("T");
        expect(lineFor({ selectedVersionIndex: 1 }, single)).toBe("T");
    });

    test("a hymn with no versions is just the title", () => {
        expect(lineFor({}, [hymn("T")])).toBe("T");
    });

    test("Custom with text replaces the numbers", () => {
        expect(
            lineFor(
                {
                    selectedOption: "Custom",
                    customText: "x",
                    selectedVersionIndex: 2,
                },
                multi
            )
        ).toBe("T (x)");
    });

    test("Custom with empty or missing text is just the title, not the numbers", () => {
        expect(
            lineFor({ selectedOption: "Custom", customText: "" }, multi)
        ).toBe("T");
        expect(lineFor({ selectedOption: "Custom" }, multi)).toBe("T");
    });

    test("QUIRK: whitespace-only custom text is printed as-is", () => {
        expect(
            lineFor({ selectedOption: "Custom", customText: "   " }, multi)
        ).toBe("T (   )");
    });

    test("QUIRK: 'Leave blank' still prints the numbers", () => {
        expect(lineFor({ selectedOption: "Leave blank" }, single)).toBe(
            "T (R-12/G-34)"
        );
        expect(
            lineFor({ selectedOption: "Leave blank", selectedVersionIndex: 1 }, multi)
        ).toBe("T (R-12)");
        expect(lineFor({ selectedOption: "Leave blank" }, [hymn("T", NEITHER)])).toBe(
            "T"
        );
    });

    test("custom text is ignored unless the option is Custom", () => {
        expect(lineFor({ customText: "x" }, single)).toBe("T (R-12/G-34)");
    });
});

describe("buildScheduleCopyText: matching items to hymns", () => {
    const catalog = [hymn("Amazing Grace", BOTH)];

    test("the item's own title is printed, not the catalog's", () => {
        expect(textFor([songItem("Amazing Grace", 1)], catalog)).toBe(
            "Amazing Grace (R-12/G-34)"
        );
        expect(textFor([songItem("amazing grace", 1)], catalog)).toBe(
            "amazing grace (R-12/G-34)"
        );
    });

    test("matches regardless of case", () => {
        expect(textFor([songItem("AMAZING GRACE", 1)], catalog)).toBe(
            "AMAZING GRACE (R-12/G-34)"
        );
    });

    test("matches through trailing punctuation on either side", () => {
        const punctuated = [hymn("Holy, Holy, Holy!", BOTH)];
        expect(textFor([songItem("Holy, Holy, Holy", 1)], punctuated)).toBe(
            "Holy, Holy, Holy (R-12/G-34)"
        );
        expect(textFor([songItem("Holy, Holy, Holy?!", 1)], [hymn("Holy, Holy, Holy.", BOTH)])).toBe(
            "Holy, Holy, Holy?! (R-12/G-34)"
        );
        expect(textFor([songItem("Holy, Holy, Holy.", 1)], [hymn("Holy, Holy, Holy", BOTH)])).toBe(
            "Holy, Holy, Holy. (R-12/G-34)"
        );
    });

    test("punctuation inside the title still has to match", () => {
        expect(textFor([songItem("Holy Holy Holy", 1)], [hymn("Holy, Holy, Holy", BOTH)])).toBe(
            "Holy Holy Holy"
        );
    });

    test("matches through extra whitespace and '&' versus 'and'", () => {
        expect(textFor([songItem("  Amazing   Grace ", 1)], catalog)).toBe(
            "  Amazing   Grace  (R-12/G-34)"
        );
        expect(
            textFor([songItem("Praise and Worship", 1)], [hymn("Praise & Worship", BOTH)])
        ).toBe("Praise and Worship (R-12/G-34)");
    });

    test.each([
        ["modifier letter apostrophe U+02BC", "ʼ"],
        ["prime U+2032", "′"],
    ])("a %s matches a straight apostrophe", (_name, apostrophe) => {
        const straight = hymn("In Jordan's Stream", BOTH);
        const fancy = `In Jordan${apostrophe}s Stream`;
        expect(textFor([songItem(fancy, 1)], [straight])).toBe(
            `${fancy} (R-12/G-34)`
        );
        expect(textFor([songItem("In Jordan's Stream", 1)], [hymn(fancy, BOTH)])).toBe(
            "In Jordan's Stream (R-12/G-34)"
        );
    });

    test("a double prime U+2033 matches a straight double quote", () => {
        const title = "Say ″Amen″";
        expect(textFor([songItem(title, 1)], [hymn('Say "Amen"', BOTH)])).toBe(
            `${title} (R-12/G-34)`
        );
    });

    test.each([
        ["left single quotation mark U+2018", "‘", "'"],
        ["right single quotation mark U+2019", "’", "'"],
        ["left double quotation mark U+201C", "“", '"'],
        ["right double quotation mark U+201D", "”", '"'],
    ])(
        "a %s matches its straight form, either way round",
        (_name, curly, straight) => {
            const curlyTitle = `In Jordan${curly}s Stream`;
            const straightTitle = `In Jordan${straight}s Stream`;
            expect(
                textFor([songItem(straightTitle, 1)], [hymn(curlyTitle, BOTH)])
            ).toBe(`${straightTitle} (R-12/G-34)`);
            expect(
                textFor([songItem(curlyTitle, 1)], [hymn(straightTitle, BOTH)])
            ).toBe(`${curlyTitle} (R-12/G-34)`);
            // The same character on both sides still matches.
            expect(
                textFor([songItem(curlyTitle, 1)], [hymn(curlyTitle, BOTH)])
            ).toBe(`${curlyTitle} (R-12/G-34)`);
        }
    );

    test("the first matching hymn wins", () => {
        const two = [
            hymn("Amazing Grace", version("1", "-1")),
            hymn("AMAZING GRACE!", version("2", "-1")),
        ];
        expect(textFor([songItem("Amazing Grace", 1)], two)).toBe(
            "Amazing Grace (R-1)"
        );
    });

    test("the first match wins even when it has no versions", () => {
        const two = [hymn("Amazing Grace"), hymn("Amazing Grace", BOTH)];
        expect(textFor([songItem("Amazing Grace", 1)], two)).toBe(
            "Amazing Grace"
        );
    });

    test("each item is matched on its own title and carries its own selection", () => {
        const catalog2 = [
            hymn("Alpha", BOTH),
            hymn("Beta", RJ_ONLY, GR_ONLY),
        ];
        const items = [
            songItem("Beta", 2, { selectedVersionIndex: 1 }),
            songItem("Alpha", 1, { selectedOption: "Custom", customText: "mine" }),
            songItem("Gamma", 3, { selectedOption: "Custom", customText: "free" }),
        ];
        expect(textFor(items, catalog2)).toBe(
            "Alpha (mine)\nBeta (G-34)\nGamma (free)"
        );
    });
});
