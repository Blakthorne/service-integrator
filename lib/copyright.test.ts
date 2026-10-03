import { describe, expect, test } from "vitest";
import {
    buildCopyrightCopyAllText,
    formatCopyrightText,
    getItemCopyrightInfo,
    type CopyrightItem,
    type CopyrightSong,
} from "./copyright";

// Characterization tests: they pin what the code did when it was moved out of
// the components, quirks included. A test marked QUIRK documents behavior that
// looks wrong but is deliberately kept; fix commits flip those assertions.

const FOOTER = "Used by permission. CCLI Streaming License 1564484.";

function song(overrides: Partial<CopyrightSong> = {}): CopyrightSong {
    return { title: "T", author: "X", copyright: "2001 Y", ...overrides };
}

function songItem(title: string, sequence: number): CopyrightItem {
    return { title, itemType: "song", sequence };
}

/** Line 1 of the block: `"<title>" <author line>.` for a song titled "T". */
function titleLineFor(author: string): string {
    return formatCopyrightText(song({ author })).split("\n")[0];
}

/** Line 2 of the block: the copyright line. */
function copyrightLineFor(
    copyright: string | null | undefined,
    admin?: string | null
): string {
    // PCO can hand over a null copyright at runtime even though the component
    // types say `string`, so the null/undefined cases need a cast.
    return formatCopyrightText(
        song({ copyright: copyright as string, admin })
    ).split("\n")[1];
}

describe("formatCopyrightText: author line", () => {
    test("a single author gets 'Words and Music by'", () => {
        expect(titleLineFor("X")).toBe('"T" Words and Music by X.');
    });

    test("'A and B' is words by A, music by B", () => {
        expect(titleLineFor("A and B")).toBe('"T" Words by A. Music by B.');
    });

    test("'A, B, C' is words by A and B, music by C", () => {
        expect(titleLineFor("A, B, C")).toBe(
            '"T" Words by A and B. Music by C.'
        );
    });

    test("a fourth comma-separated author is dropped", () => {
        expect(titleLineFor("A, B, C, D")).toBe(
            '"T" Words by A and B. Music by C.'
        );
    });

    test("'A, B' (two comma parts) is treated as ONE author", () => {
        expect(titleLineFor("A, B")).toBe('"T" Words and Music by A, B.');
    });

    test("a third ' and '-separated author is dropped", () => {
        expect(titleLineFor("A and B and C")).toBe(
            '"T" Words by A. Music by B.'
        );
    });

    test("an empty author becomes 'Unknown'", () => {
        expect(titleLineFor("")).toBe('"T" Words and Music by Unknown.');
    });

    test("a whitespace-only author also becomes 'Unknown'", () => {
        expect(titleLineFor("   ")).toBe('"T" Words and Music by Unknown.');
    });

    test("QUIRK: an author already ending in '.' is followed by a second '.'", () => {
        expect(titleLineFor("John Newton.")).toBe(
            '"T" Words and Music by John Newton..'
        );
    });

    test("each comma-separated author is trimmed", () => {
        expect(titleLineFor("  A ,  B ,C  ")).toBe(
            '"T" Words by A and B. Music by C.'
        );
    });

    test("an empty side of ' and ' falls back (first -> Unknown, second -> the first author)", () => {
        expect(titleLineFor("A and ")).toBe('"T" Words by A. Music by A.');
        expect(titleLineFor(" and B")).toBe(
            '"T" Words by Unknown. Music by B.'
        );
    });

    test("only a lowercase ' and ' splits authors ('AND' and '&' do not)", () => {
        expect(titleLineFor("A AND B")).toBe('"T" Words and Music by A AND B.');
        expect(titleLineFor("A & B")).toBe('"T" Words and Music by A & B.');
    });

    test("QUIRK: three or more comma parts win over ' and ', which is then not split", () => {
        expect(titleLineFor("A and B, C, D")).toBe(
            '"T" Words by A and B and C. Music by D.'
        );
    });

    test("two comma parts fall through to ' and ' splitting", () => {
        expect(titleLineFor("A and B, C")).toBe(
            '"T" Words by A. Music by B, C.'
        );
    });

    test("QUIRK: a null or undefined author throws (author.split); flips when null means 'Unknown'", () => {
        expect(() =>
            formatCopyrightText(song({ author: null as unknown as string }))
        ).toThrow(TypeError);
        expect(() =>
            formatCopyrightText(
                song({ author: undefined as unknown as string })
            )
        ).toThrow(TypeError);
    });
});

describe("formatCopyrightText: copyright line", () => {
    test("a null or undefined copyright is 'Public Domain.' and ignores the admin", () => {
        expect(copyrightLineFor(null)).toBe("Public Domain.");
        expect(copyrightLineFor(undefined)).toBe("Public Domain.");
        expect(copyrightLineFor(null, "Y")).toBe("Public Domain.");
        expect(copyrightLineFor(undefined, "Y")).toBe("Public Domain.");
    });

    test("QUIRK: an empty copyright renders as '© .' (what it should say is a product decision)", () => {
        expect(copyrightLineFor("")).toBe("© .");
    });

    test("QUIRK: a whitespace-only copyright also renders as '© .'", () => {
        expect(copyrightLineFor("   ")).toBe("© .");
    });

    test("QUIRK: an admin after an empty copyright follows the '© .'", () => {
        expect(copyrightLineFor("", "Y")).toBe("© . Admin. by Y.");
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

    test("returns exactly the title, author, copyright and admin of the matching song", () => {
        const detailed = {
            id: "42",
            ccliNumber: 22025,
            notes: "n",
            ...amazing,
        };
        expect(
            getItemCopyrightInfo(songItem("Amazing Grace", 1), [detailed])
        ).toStrictEqual({
            title: "Amazing Grace",
            author: "John Newton",
            copyright: "Public Domain",
            admin: null,
        });
    });

    test("is null for an item that is not a song, even when a song has that title", () => {
        const header: CopyrightItem = {
            title: "Amazing Grace",
            itemType: "header",
            sequence: 1,
        };
        expect(getItemCopyrightInfo(header, [amazing])).toBeNull();
    });

    test("is null for a song item with no song of that title", () => {
        const other = songItem("Other", 1);
        const grace = songItem("Amazing Grace", 1);
        expect(getItemCopyrightInfo(other, [amazing])).toBeNull();
        expect(getItemCopyrightInfo(grace, [])).toBeNull();
    });

    test("the first song with a matching title wins", () => {
        const first = song({ title: "Same", author: "First" });
        const second = song({ title: "Same", author: "Second" });
        expect(
            getItemCopyrightInfo(songItem("Same", 1), [first, second])?.author
        ).toBe("First");
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
        const items = [
            songItem("Amazing Grace", 2),
            songItem("Holy, Holy, Holy", 1),
        ];
        const text = buildCopyrightCopyAllText(items, [amazing, holy]);
        expect(text).toBe(holyBlock + "\n\n" + amazingBlock);
    });

    test("a single block has no leading or trailing separator", () => {
        expect(
            buildCopyrightCopyAllText([songItem("Amazing Grace", 1)], [amazing])
        ).toBe(amazingBlock);
    });

    test("keeps only items whose type is exactly 'song'", () => {
        const items: CopyrightItem[] = [
            { title: "Welcome", itemType: "header", sequence: 1 },
            { title: "Amazing Grace", itemType: "item", sequence: 2 },
            { title: "Amazing Grace", itemType: "Song", sequence: 3 },
            songItem("Holy, Holy, Holy", 4),
        ];
        expect(buildCopyrightCopyAllText(items, [amazing, holy])).toBe(
            holyBlock
        );
    });

    test("skips song items with no matching song, leaving no gap", () => {
        const items = [
            songItem("Holy, Holy, Holy", 1),
            songItem("Unknown Song", 2),
            songItem("Amazing Grace", 3),
        ];
        const text = buildCopyrightCopyAllText(items, [amazing, holy]);
        expect(text).toBe(holyBlock + "\n\n" + amazingBlock);
        expect(text).not.toContain("\n\n\n");
    });

    test("is empty when there are no items, no songs, or nothing matches", () => {
        const grace = [songItem("Amazing Grace", 1)];
        expect(buildCopyrightCopyAllText([], [amazing])).toBe("");
        expect(buildCopyrightCopyAllText(grace, [])).toBe("");
        expect(buildCopyrightCopyAllText([songItem("Nope", 1)], [amazing])).toBe(
            ""
        );
    });

    test("RENAMED ITEM: an item whose title differs from its song's title gets NO entry (flips when songs are joined by PCO ID)", () => {
        const renamed = songItem("Amazing Grace (Acoustic)", 1);
        expect(buildCopyrightCopyAllText([renamed], [amazing])).toBe("");
        expect(getItemCopyrightInfo(renamed, [amazing])).toBeNull();

        // Its exactly-titled neighbour is unaffected.
        const items = [renamed, songItem("Holy, Holy, Holy", 2)];
        expect(buildCopyrightCopyAllText(items, [amazing, holy])).toBe(
            holyBlock
        );
    });

    test("titles must match exactly: case and surrounding whitespace matter", () => {
        const items = [
            songItem("amazing grace", 1),
            songItem(" Amazing Grace", 2),
            songItem("Amazing Grace ", 3),
            songItem("Amazing Grace.", 4),
        ];
        expect(buildCopyrightCopyAllText(items, [amazing])).toBe("");
    });

    test("the first song with a matching title wins", () => {
        const first = song({ title: "Same", author: "First" });
        const second = song({ title: "Same", author: "Second" });
        const text = buildCopyrightCopyAllText(
            [songItem("Same", 1)],
            [first, second]
        );
        expect(text.split("\n")[0]).toBe('"Same" Words and Music by First.');
    });

    test("a song used twice in the plan gets one block per item", () => {
        const items = [
            songItem("Amazing Grace", 1),
            songItem("Amazing Grace", 5),
        ];
        expect(buildCopyrightCopyAllText(items, [amazing])).toBe(
            amazingBlock + "\n\n" + amazingBlock
        );
    });

    test("items with equal sequence keep their input order", () => {
        const items = [
            songItem("Holy, Holy, Holy", 1),
            songItem("Amazing Grace", 1),
        ];
        expect(buildCopyrightCopyAllText(items, [amazing, holy])).toBe(
            holyBlock + "\n\n" + amazingBlock
        );
    });

    test("does not reorder the items passed in", () => {
        const items = [
            songItem("Amazing Grace", 2),
            { title: "Welcome", itemType: "header", sequence: 0 },
            songItem("Holy, Holy, Holy", 1),
        ];
        const before = items.map((item) => item.title);
        buildCopyrightCopyAllText(items, [amazing, holy]);
        expect(items.map((item) => item.title)).toEqual(before);
    });
});
