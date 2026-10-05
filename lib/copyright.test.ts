import { describe, expect, test } from "vitest";
import {
    buildCopyrightCopyAllText,
    formatCopyrightText,
    getItemCopyrightInfo,
    type CopyrightItem,
    type CopyrightSong,
} from "./copyright";
import { parseCredits } from "./credits";
import { DEFAULT_SETTINGS, planTextSettings } from "./settings";

// Characterization tests: they pin what the code did when it was moved out of
// the components, quirks included. A test marked QUIRK documents behavior that
// looks wrong but is deliberately kept; fix commits flip those assertions. The
// author line's tests moved to lib/credits.test.ts with the reading they pin,
// assertions unchanged.

const FOOTER = "Used by permission. CCLI Streaming License 1564484.";

function song(overrides: Partial<CopyrightSong> = {}): CopyrightSong {
    return { title: "T", author: "X", copyright: "2001 Y", ...overrides };
}

/**
 * A "song" item joined to `itemSong`. `title` is the item's own title in the
 * plan, which the copyright views never read; it defaults to the song's.
 */
function songItem(
    itemSong: CopyrightSong | null,
    sequence: number,
    title: string = itemSong?.title ?? "Untitled"
): CopyrightItem & { title: string } {
    return { title, itemType: "song", sequence, song: itemSong };
}

/** Line 2 of the block: the copyright line. */
function copyrightLineFor(
    copyright: string | null | undefined,
    admin?: string | null
): string {
    // PCO can hand over a null copyright, and `undefined` stands in for a
    // field missing from the JSON.
    return formatCopyrightText(song({ copyright, admin })).split("\n")[1];
}

describe("formatCopyrightText: copyright line", () => {
    test("a null or undefined copyright is 'Public Domain.' and ignores the admin", () => {
        expect(copyrightLineFor(null)).toBe("Public Domain.");
        expect(copyrightLineFor(undefined)).toBe("Public Domain.");
        expect(copyrightLineFor(null, "Y")).toBe("Public Domain.");
        expect(copyrightLineFor(undefined, "Y")).toBe("Public Domain.");
    });

    test("an empty or whitespace-only copyright is 'Public Domain.' and ignores the admin, like a missing one", () => {
        expect(copyrightLineFor("")).toBe("Public Domain.");
        expect(copyrightLineFor("   ")).toBe("Public Domain.");
        expect(copyrightLineFor("", "Y")).toBe("Public Domain.");
        expect(copyrightLineFor("   ", "Y")).toBe("Public Domain.");
    });

    test("'public domain' in any case gets no © and ends with exactly one '.'", () => {
        expect(copyrightLineFor("public domain")).toBe("public domain.");
        expect(copyrightLineFor("Public Domain")).toBe("Public Domain.");
        expect(copyrightLineFor("PUBLIC DOMAIN.")).toBe("PUBLIC DOMAIN.");
        expect(copyrightLineFor("Public domain.")).toBe("Public domain.");
    });

    test("the original casing of 'public domain' is kept (only the match is case-insensitive)", () => {
        expect(copyrightLineFor("pUbLiC dOmAiN")).toBe("pUbLiC dOmAiN.");
    });

    test("surrounding whitespace is trimmed before checking for 'public domain'", () => {
        expect(copyrightLineFor("  public domain.  ")).toBe("public domain.");
    });

    test("only an exact 'public domain' counts: anything longer gets a ©", () => {
        expect(copyrightLineFor("Public Domain in the USA")).toBe(
            "© Public Domain in the USA."
        );
    });

    test("an ordinary copyright gets a © and a trailing '.'", () => {
        expect(copyrightLineFor("2001 X")).toBe("© 2001 X.");
    });

    test("a copyright already ending in '.' does not get a doubled '.'", () => {
        expect(copyrightLineFor("2001 X.")).toBe("© 2001 X.");
    });

    test("the copyright is trimmed", () => {
        expect(copyrightLineFor("  2001 X  ")).toBe("© 2001 X.");
    });

    test("QUIRK: a copyright that already starts with © gets a second ©", () => {
        expect(copyrightLineFor("© 2001 X")).toBe("© © 2001 X.");
    });

    test("an admin is appended as ' Admin. by Y' with a closing period", () => {
        expect(copyrightLineFor("2001 X", "Y")).toBe(
            "© 2001 X. Admin. by Y."
        );
        expect(copyrightLineFor("2001 X.", "Y")).toBe(
            "© 2001 X. Admin. by Y."
        );
    });

    test("an admin already ending in '.' does not get a doubled '.'", () => {
        expect(copyrightLineFor("2001 X", "Y.")).toBe(
            "© 2001 X. Admin. by Y."
        );
    });

    test("QUIRK: an admin is appended untrimmed", () => {
        expect(copyrightLineFor("2001 X", "  Y  ")).toBe(
            "© 2001 X. Admin. by " + "  Y  " + "."
        );
    });

    test("an admin is also appended after 'public domain'", () => {
        expect(copyrightLineFor("Public Domain", "Y")).toBe(
            "Public Domain. Admin. by Y."
        );
    });

    test("a whitespace-only, empty, null or missing admin is skipped", () => {
        expect(copyrightLineFor("2001 X", "   ")).toBe("© 2001 X.");
        expect(copyrightLineFor("2001 X", "")).toBe("© 2001 X.");
        expect(copyrightLineFor("2001 X", null)).toBe("© 2001 X.");
        expect(copyrightLineFor("2001 X", undefined)).toBe("© 2001 X.");
    });
});

describe("formatCopyrightText: full template", () => {
    test('is `"<title>" <author line>.\\n<copyright line>\\n<footer>`', () => {
        expect(
            formatCopyrightText({
                title: "Come, Thou Fount",
                author: "Robert Robinson, John Wyeth, Tune Arranger",
                copyright: "2001 Example Music",
                admin: "Example Admin",
            })
        ).toBe(
            '"Come, Thou Fount" Words by Robert Robinson and John Wyeth. Music by Tune Arranger.\n' +
                "© 2001 Example Music. Admin. by Example Admin.\n" +
                "Used by permission. CCLI Streaming License 1564484."
        );
    });

    test("public domain song, as the copy text shows it", () => {
        expect(
            formatCopyrightText({
                title: "Amazing Grace",
                author: "John Newton",
                copyright: "Public Domain",
                admin: null,
            })
        ).toBe(
            '"Amazing Grace" Words and Music by John Newton.\n' +
                "Public Domain.\n" +
                "Used by permission. CCLI Streaming License 1564484."
        );
    });

    test("the title is inserted as-is between straight double quotes", () => {
        const text = formatCopyrightText(song({ title: 'He said "Hi"' }));
        expect(text.split("\n")[0]).toBe(
            '"He said "Hi"" Words and Music by X.'
        );
    });

    test("always has exactly three lines ending with the CCLI footer", () => {
        const lines = formatCopyrightText(song()).split("\n");
        expect(lines).toHaveLength(3);
        expect(lines[2]).toBe(FOOTER);
    });
});

describe("getItemCopyrightInfo", () => {
    const amazing = song({
        title: "Amazing Grace",
        author: "John Newton",
        copyright: "Public Domain",
        admin: null,
    });

    test("returns exactly the title, author, copyright and admin of the item's song", () => {
        const detailed = {
            id: "42",
            ccliNumber: 22025,
            notes: "n",
            ...amazing,
        };
        expect(getItemCopyrightInfo(songItem(detailed, 1))).toStrictEqual({
            title: "Amazing Grace",
            author: "John Newton",
            copyright: "Public Domain",
            admin: null,
        });
    });

    test("is null for an item that is not a song, even when it carries a song", () => {
        const header: CopyrightItem = {
            itemType: "header",
            sequence: 1,
            song: amazing,
        };
        expect(getItemCopyrightInfo(header)).toBeNull();
    });

    test("is null for a song item without a song", () => {
        expect(getItemCopyrightInfo(songItem(null, 1, "Amazing Grace"))).toBeNull();
    });

    test("uses the item's own song, whatever the item is called in the plan", () => {
        const renamed = songItem(amazing, 1, "Amazing Grace (Acoustic)");
        expect(getItemCopyrightInfo(renamed)?.title).toBe("Amazing Grace");
    });
});

describe("buildCopyrightCopyAllText", () => {
    const holy = song({
        title: "Holy, Holy, Holy",
        author: "Reginald Heber and John Dykes",
        copyright: "2001 Hymn Co",
        admin: "Hymn Admin",
    });
    const amazing = song({
        title: "Amazing Grace",
        author: "John Newton",
        copyright: "Public Domain",
        admin: null,
    });
    const holyBlock = [
        '"Holy, Holy, Holy" Words by Reginald Heber. Music by John Dykes.',
        "© 2001 Hymn Co. Admin. by Hymn Admin.",
        FOOTER,
    ].join("\n");
    const amazingBlock = [
        '"Amazing Grace" Words and Music by John Newton.',
        "Public Domain.",
        FOOTER,
    ].join("\n");

    test("joins the blocks of song items, in sequence order, with a blank line", () => {
        const items = [songItem(amazing, 2), songItem(holy, 1)];
        expect(buildCopyrightCopyAllText(items)).toBe(
            holyBlock + "\n\n" + amazingBlock
        );
    });

    test("a single block has no leading or trailing separator", () => {
        expect(buildCopyrightCopyAllText([songItem(amazing, 1)])).toBe(
            amazingBlock
        );
    });

    test("keeps only items whose type is exactly 'song'", () => {
        const items: CopyrightItem[] = [
            { itemType: "header", sequence: 1, song: null },
            { itemType: "item", sequence: 2, song: amazing },
            { itemType: "Song", sequence: 3, song: amazing },
            songItem(holy, 4),
        ];
        expect(buildCopyrightCopyAllText(items)).toBe(holyBlock);
    });

    test("skips song items without a song, leaving no gap", () => {
        const items = [
            songItem(holy, 1),
            songItem(null, 2, "Unknown Song"),
            songItem(amazing, 3),
        ];
        const text = buildCopyrightCopyAllText(items);
        expect(text).toBe(holyBlock + "\n\n" + amazingBlock);
        expect(text).not.toContain("\n\n\n");
    });

    test("is empty when there are no items or no song item has a song", () => {
        expect(buildCopyrightCopyAllText([])).toBe("");
        expect(
            buildCopyrightCopyAllText([songItem(null, 1, "Amazing Grace")])
        ).toBe("");
    });

    test("RENAMED ITEM: an item whose title differs from its song's title gets its song's block (songs are joined by PCO ID)", () => {
        const renamed = songItem(amazing, 1, "Amazing Grace (Acoustic)");
        expect(buildCopyrightCopyAllText([renamed])).toBe(amazingBlock);
        expect(getItemCopyrightInfo(renamed)).toStrictEqual({
            title: "Amazing Grace",
            author: "John Newton",
            copyright: "Public Domain",
            admin: null,
        });

        // Its exactly-titled neighbour is unaffected.
        const items = [renamed, songItem(holy, 2)];
        expect(buildCopyrightCopyAllText(items)).toBe(
            amazingBlock + "\n\n" + holyBlock
        );
    });

    test("the item's own title plays no part: the block names the song", () => {
        const items = [
            songItem(amazing, 1, "amazing grace"),
            songItem(amazing, 2, " Amazing Grace"),
            songItem(amazing, 3, "Something Else Entirely"),
        ];
        expect(buildCopyrightCopyAllText(items)).toBe(
            [amazingBlock, amazingBlock, amazingBlock].join("\n\n")
        );
    });

    test("two songs with the same title each stay with their own item", () => {
        const first = song({ title: "Same", author: "First" });
        const second = song({ title: "Same", author: "Second" });
        const text = buildCopyrightCopyAllText([
            songItem(second, 2),
            songItem(first, 1),
        ]);
        expect(text.split("\n\n").map((block) => block.split("\n")[0])).toEqual([
            '"Same" Words and Music by First.',
            '"Same" Words and Music by Second.',
        ]);
    });

    test("a song with a null author no longer breaks Copy All", () => {
        const anonymous = song({ title: "Anonymous Hymn", author: null, copyright: null });
        const items = [songItem(anonymous, 1), songItem(amazing, 2)];
        expect(buildCopyrightCopyAllText(items)).toBe(
            [
                '"Anonymous Hymn" Words and Music by Unknown.',
                "Public Domain.",
                FOOTER,
            ].join("\n") +
                "\n\n" +
                amazingBlock
        );
    });

    test("a song used twice in the plan gets one block per item", () => {
        const items = [songItem(amazing, 1), songItem(amazing, 5)];
        expect(buildCopyrightCopyAllText(items)).toBe(
            amazingBlock + "\n\n" + amazingBlock
        );
    });

    test("items with equal sequence keep their input order", () => {
        const items = [songItem(holy, 1), songItem(amazing, 1)];
        expect(buildCopyrightCopyAllText(items)).toBe(
            holyBlock + "\n\n" + amazingBlock
        );
    });

    test("does not reorder the items passed in", () => {
        const items = [
            songItem(amazing, 2),
            { title: "Welcome", itemType: "header", sequence: 0, song: null },
            songItem(holy, 1),
        ];
        const before = items.map((item) => item.title);
        buildCopyrightCopyAllText(items);
        expect(items.map((item) => item.title)).toEqual(before);
    });
});

describe("the CCLI license number comes from the settings", () => {
    const settings = { ccliLicenseNumber: "7654321" };
    const amazing = song({ title: "Amazing Grace", author: "John Newton", copyright: "Public Domain" });

    test("formatCopyrightText prints the license number it is given", () => {
        expect(formatCopyrightText(amazing, settings)).toBe(
            '"Amazing Grace" Words and Music by John Newton.\n' +
                "Public Domain.\n" +
                "Used by permission. CCLI Streaming License 7654321."
        );
    });

    test("the default settings print the number it always printed", () => {
        expect(DEFAULT_SETTINGS.ccliLicenseNumber).toBe("1564484");
        expect(formatCopyrightText(amazing, DEFAULT_SETTINGS)).toBe(formatCopyrightText(amazing));
        expect(formatCopyrightText(amazing).split("\n")[2]).toBe(FOOTER);
    });

    test("only the footer changes", () => {
        const withDefault = formatCopyrightText(amazing).split("\n");
        const withSettings = formatCopyrightText(amazing, settings).split("\n");
        expect(withSettings.slice(0, 2)).toEqual(withDefault.slice(0, 2));
    });

    test("buildCopyrightCopyAllText gives every block the license number", () => {
        const holy = song({ title: "Holy, Holy, Holy", author: "Reginald Heber" });
        const text = buildCopyrightCopyAllText([songItem(amazing, 1), songItem(holy, 2)], settings);
        expect(text.split("\n\n").map((block) => block.split("\n")[2])).toEqual([
            "Used by permission. CCLI Streaming License 7654321.",
            "Used by permission. CCLI Streaming License 7654321.",
        ]);
        expect(buildCopyrightCopyAllText([songItem(amazing, 1)], DEFAULT_SETTINGS)).toBe(
            buildCopyrightCopyAllText([songItem(amazing, 1)])
        );
    });
});

describe("the credit line comes from the song's credits and the settings", () => {
    const ourHelp = song({
        title: "O God, Our Help",
        author: "Words: Isaac Watts; Music: William Croft",
        copyright: "Public Domain",
    });

    test("an author in the labelled convention prints its credits", () => {
        expect(formatCopyrightText(ourHelp)).toBe(
            '"O God, Our Help" Words by Isaac Watts. Music by William Croft.\n' +
                "Public Domain.\n" +
                FOOTER
        );
        expect(formatCopyrightText(song({ author: "Words & Music: John Newton" })).split("\n")[0]).toBe(
            '"T" Words and Music by John Newton.'
        );
        expect(
            formatCopyrightText(song({ author: "Words: A, B; Music: C; Arr.: D" })).split("\n")[0]
        ).toBe('"T" Words by A and B. Music by C. Arr. by D.');
    });

    test("an author with labels that do not parse prints as it always did", () => {
        expect(formatCopyrightText(song({ author: "Composer: Lowell Mason" })).split("\n")[0]).toBe(
            '"T" Words and Music by Composer: Lowell Mason.'
        );
    });

    test("parsed credits, when given, are printed instead of the author", () => {
        const credits = parseCredits("Words: Isaac Watts", DEFAULT_SETTINGS.creditRoles);
        expect(formatCopyrightText({ ...song({ author: "Someone Else" }), credits }).split("\n")[0]).toBe(
            '"T" Words by Isaac Watts.'
        );
    });

    test("the settings' phrases print for every author, legacy ones included", () => {
        const settings = {
            ...DEFAULT_SETTINGS,
            creditPhrases: { Words: "Text by", Music: "Tune by", "Words & Music": "Text and tune by" },
        };
        expect(formatCopyrightText(ourHelp, settings).split("\n")[0]).toBe(
            '"O God, Our Help" Text by Isaac Watts. Tune by William Croft.'
        );
        expect(formatCopyrightText(song({ author: "A and B" }), settings).split("\n")[0]).toBe(
            '"T" Text by A. Tune by B.'
        );
        expect(formatCopyrightText(song({ author: "" }), settings).split("\n")[0]).toBe(
            '"T" Text and tune by Unknown.'
        );
    });

    test("the settings' roles are the labels the author is read with", () => {
        const settings = { ...DEFAULT_SETTINGS, creditRoles: ["Text", "Tune"] };
        expect(formatCopyrightText(song({ author: "Text: A; Tune: B" }), settings).split("\n")[0]).toBe(
            '"T" Text by A. Tune by B.'
        );
        expect(formatCopyrightText(song({ author: "Words: A" }), settings).split("\n")[0]).toBe(
            '"T" Text and Tune by Words: A.'
        );
    });

    test("settings without credit roles or phrases use the defaults", () => {
        expect(formatCopyrightText(ourHelp, { ccliLicenseNumber: "1564484" })).toBe(
            formatCopyrightText(ourHelp, DEFAULT_SETTINGS)
        );
    });

    test("only the credit line changes: the copyright line and footer stay as they were", () => {
        const settings = { ...DEFAULT_SETTINGS, creditPhrases: { Words: "Text by" } };
        const plain = formatCopyrightText(ourHelp).split("\n");
        const withSettings = formatCopyrightText(ourHelp, settings).split("\n");
        expect(withSettings.slice(1)).toEqual(plain.slice(1));
    });

    test("Copy All prints every block with the settings, and each song's parsed credits when it carries them", () => {
        const settings = { ...DEFAULT_SETTINGS, creditPhrases: { ...DEFAULT_SETTINGS.creditPhrases, Words: "Text by" } };
        const parsed = { ...song({ title: "Parsed", author: "ignored" }), credits: parseCredits("Music: X", DEFAULT_SETTINGS.creditRoles) };
        const text = buildCopyrightCopyAllText([songItem(ourHelp, 1), songItem(parsed, 2)], settings);
        expect(text.split("\n\n").map((block) => block.split("\n")[0])).toEqual([
            '"O God, Our Help" Text by Isaac Watts. Music by William Croft.',
            '"Parsed" Music by X.',
        ]);
        expect(getItemCopyrightInfo(songItem(parsed, 2))?.credits).toEqual(parsed.credits);
    });
});

describe("a plan's text settings are copyright settings", () => {
    const MORNING = { id: "1405391", name: "Sunday Morning" };
    const ourHelp = song({ title: "O God, Our Help", author: "Words: Isaac Watts; Music: William Croft" });

    test("with the defaults, every block is what it was without settings", () => {
        const settings = planTextSettings(DEFAULT_SETTINGS, MORNING);
        for (const block of [song(), ourHelp, song({ author: "A, B, C" }), song({ author: null })]) {
            expect(formatCopyrightText(block, settings)).toBe(formatCopyrightText(block));
        }
    });

    test("their CCLI number, credit roles and phrases reach every block of Copy All", () => {
        const settings = planTextSettings(
            {
                ...DEFAULT_SETTINGS,
                ccliLicenseNumber: "7654321",
                creditRoles: ["Words", "Music"],
                creditPhrases: { Words: "Text by", Music: "Tune by" },
            },
            MORNING
        );
        expect(buildCopyrightCopyAllText([songItem(ourHelp, 1)], settings)).toBe(
            '"O God, Our Help" Text by Isaac Watts. Tune by William Croft.\n' +
                "© 2001 Y.\n" +
                "Used by permission. CCLI Streaming License 7654321."
        );
    });
});
