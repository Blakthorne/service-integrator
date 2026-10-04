import { describe, expect, test } from "vitest";
import {
    CREDIT_NAME_MAX_LENGTH,
    checkCredits,
    creditLineOf,
    parseCredits,
    renderCreditLine,
    renderCredits,
    renderLegacyCreditLine,
    songCreditsOf,
    type CreditsParse,
} from "./credits";
import type { Credit } from "./domain";
import { DEFAULT_SETTINGS, type CreditSettings } from "./settings";

const ROLES = DEFAULT_SETTINGS.creditRoles;
const PHRASES = DEFAULT_SETTINGS.creditPhrases;

/** The credits of an "ok" parse, or what the parse was instead. */
function okCredits(author: string, roles: readonly string[] = ROLES): Credit[] | CreditsParse {
    const parsed = parseCredits(author, roles);
    return parsed.status === "ok" ? parsed.credits : parsed;
}

/**
 * Line 1 of the copyright block of a song titled "T" whose author is
 * `author`, with the default settings: `"T" <credit line>`, the credit line
 * as `creditLineOf` gives it for what `parseCredits` reads.
 */
function titleLineFor(author: string | null | undefined): string {
    return `"T" ${creditLineOf(parseCredits(author, ROLES), DEFAULT_SETTINGS)}`;
}

// Characterization tests of the legacy reading: moved here from
// lib/copyright.test.ts with the reading they pin, assertions unchanged. They
// pin what the copyright text printed for an author before the credits
// convention, quirks included; a test marked QUIRK documents behavior that
// looks wrong but is deliberately kept.
describe("the legacy reading: the author line the copyright text always printed", () => {
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

    test("a null or undefined author becomes 'Unknown', like an empty one", () => {
        expect(titleLineFor(null)).toBe(
            '"T" Words and Music by Unknown.'
        );
        expect(
            titleLineFor(undefined)
        ).toBe('"T" Words and Music by Unknown.');
    });
});


describe("parseCredits: an author with no labels is legacy", () => {
    test("is read the way the copyright text always read it, words under the first role and music under the second", () => {
        expect(parseCredits("John Newton", ROLES)).toEqual({
            status: "legacy",
            credits: [
                { role: "Words", names: ["John Newton"] },
                { role: "Music", names: ["John Newton"] },
            ],
            raw: "John Newton",
        });
        expect(parseCredits("Reginald Heber and John Dykes", ROLES)).toMatchObject({
            status: "legacy",
            credits: [
                { role: "Words", names: ["Reginald Heber"] },
                { role: "Music", names: ["John Dykes"] },
            ],
        });
        expect(parseCredits("Robert Robinson, John Wyeth, Tune Arranger", ROLES)).toMatchObject({
            status: "legacy",
            credits: [
                { role: "Words", names: ["Robert Robinson", "John Wyeth"] },
                { role: "Music", names: ["Tune Arranger"] },
            ],
        });
    });

    test("keeps the reading's quirks: parts dropped, 'A, B' one author, only a lowercase ' and ' splits", () => {
        const credits = (author: string) => {
            const parsed = parseCredits(author, ROLES);
            return parsed.status === "legacy" ? parsed.credits : parsed;
        };
        expect(credits("A, B, C, D")).toEqual([
            { role: "Words", names: ["A", "B"] },
            { role: "Music", names: ["C"] },
        ]);
        expect(credits("A and B and C")).toEqual([
            { role: "Words", names: ["A"] },
            { role: "Music", names: ["B"] },
        ]);
        expect(credits("A, B")).toEqual([
            { role: "Words", names: ["A, B"] },
            { role: "Music", names: ["A, B"] },
        ]);
        expect(credits("A & B")).toEqual([
            { role: "Words", names: ["A & B"] },
            { role: "Music", names: ["A & B"] },
        ]);
        expect(credits("A and B, C, D")).toEqual([
            { role: "Words", names: ["A and B", "C"] },
            { role: "Music", names: ["D"] },
        ]);
    });

    test("credits nobody where the line prints 'Unknown', and the words' author where it prints them for the music", () => {
        const credits = (author: string) => {
            const parsed = parseCredits(author, ROLES);
            return parsed.status === "legacy" ? parsed.credits : parsed;
        };
        expect(credits(" and B")).toEqual([{ role: "Music", names: ["B"] }]);
        expect(credits("A and ")).toEqual([
            { role: "Words", names: ["A"] },
            { role: "Music", names: ["A"] },
        ]);
        expect(credits(" and ")).toEqual([]);
        expect(credits("A, , ")).toEqual([{ role: "Words", names: ["A"] }]);
        expect(credits(", , C")).toEqual([{ role: "Music", names: ["C"] }]);
        expect(credits("A, A, B")).toEqual([
            { role: "Words", names: ["A"] },
            { role: "Music", names: ["B"] },
        ]);
    });

    test("an empty, blank or missing author is legacy and credits nobody", () => {
        for (const author of ["", "   ", null, undefined]) {
            expect(parseCredits(author, ROLES)).toEqual({ status: "legacy", credits: [], raw: author ?? "" });
        }
    });

    test("fills whatever the first two roles are called", () => {
        expect(parseCredits("A and B", ["Text", "Tune", "Arr."])).toMatchObject({
            status: "legacy",
            credits: [
                { role: "Text", names: ["A"] },
                { role: "Tune", names: ["B"] },
            ],
        });
    });

    test("words that only look like labels are still legacy: there is no colon", () => {
        expect(parseCredits("Words by Isaac Watts; Music by Lowell Mason", ROLES)).toMatchObject({
            status: "legacy",
            credits: [
                { role: "Words", names: ["Words by Isaac Watts; Music by Lowell Mason"] },
                { role: "Music", names: ["Words by Isaac Watts; Music by Lowell Mason"] },
            ],
        });
    });
});

describe("parseCredits: the labelled convention", () => {
    test("reads each group's role and names", () => {
        expect(parseCredits("Words: Isaac Watts; Music: Lowell Mason; Arr.: John Doe", ROLES)).toEqual({
            status: "ok",
            credits: [
                { role: "Words", names: ["Isaac Watts"] },
                { role: "Music", names: ["Lowell Mason"] },
                { role: "Arr.", names: ["John Doe"] },
            ],
        });
    });

    test("matches labels without regard to case or spacing, and spells each role as the settings do", () => {
        expect(okCredits("words: A;  MUSIC : B; arr.: C; TRANS.:D")).toEqual([
            { role: "Words", names: ["A"] },
            { role: "Music", names: ["B"] },
            { role: "Arr.", names: ["C"] },
            { role: "Trans.", names: ["D"] },
        ]);
    });

    test("'Words & Music' and 'Words and Music' fill both roles, in any case and either order", () => {
        const both = [
            { role: "Words", names: ["John Newton"] },
            { role: "Music", names: ["John Newton"] },
        ];
        for (const label of ["Words & Music", "Words and Music", "words AND music", "Words&Music", "Music & Words", " words   and   Music "]) {
            expect([label, okCredits(`${label}: John Newton`)]).toEqual([label, both]);
        }
    });

    test("any two roles may share a group", () => {
        expect(okCredits("Words: A; Arr. & Trans.: B")).toEqual([
            { role: "Words", names: ["A"] },
            { role: "Arr.", names: ["B"] },
            { role: "Trans.", names: ["B"] },
        ]);
    });

    test("reads several names, each trimmed", () => {
        expect(okCredits("Words:  Isaac Watts ,John Newton,  William Cowper ; Music: Lowell Mason")).toEqual([
            { role: "Words", names: ["Isaac Watts", "John Newton", "William Cowper"] },
            { role: "Music", names: ["Lowell Mason"] },
        ]);
    });

    test("puts the roles in the settings' order", () => {
        expect(okCredits("Arr.: C; Music: B; Words: A")).toEqual([
            { role: "Words", names: ["A"] },
            { role: "Music", names: ["B"] },
            { role: "Arr.", names: ["C"] },
        ]);
    });

    test("a role named twice has the names of both, each once", () => {
        expect(okCredits("Words & Music: A; Music: B, A; Words: C")).toEqual([
            { role: "Words", names: ["A", "C"] },
            { role: "Music", names: ["A", "B"] },
        ]);
    });

    test("skips empty groups, a trailing semicolon among them", () => {
        expect(okCredits("Words: A;; Music: B; ")).toEqual([
            { role: "Words", names: ["A"] },
            { role: "Music", names: ["B"] },
        ]);
    });

    test("names keep what is in them, a period included", () => {
        expect(okCredits("Words: John Newton.; Music: Trad. (American)")).toEqual([
            { role: "Words", names: ["John Newton."] },
            { role: "Music", names: ["Trad. (American)"] },
        ]);
    });

    test("follows the settings' roles", () => {
        const roles = ["Text", "Tune", "Descant"];
        expect(okCredits("Text & Tune: A; Descant: B", roles)).toEqual([
            { role: "Text", names: ["A"] },
            { role: "Tune", names: ["A"] },
            { role: "Descant", names: ["B"] },
        ]);
        expect(parseCredits("Words: A", roles)).toEqual({ status: "unparsed", raw: "Words: A" });
    });

    test("a role whose own name has 'and' in it is that role, not two", () => {
        const roles = ["Words", "Music", "Arranged and adapted"];
        expect(okCredits("Arranged and adapted: A", roles)).toEqual([
            { role: "Arranged and adapted", names: ["A"] },
        ]);
        expect(okCredits("Words & arranged AND adapted: B", roles)).toEqual([
            { role: "Words", names: ["B"] },
            { role: "Arranged and adapted", names: ["B"] },
        ]);
    });

    test("takes the labels at their word: a role is not found inside another word", () => {
        expect(parseCredits("Wordsand Music: A", ROLES)).toMatchObject({ status: "unparsed" });
        expect(parseCredits("Words andMusic: A", ROLES)).toMatchObject({ status: "unparsed" });
    });
});

describe("parseCredits: labels that do not parse are unparsed, never guessed at", () => {
    test.each([
        ["a label that is not a role", "Composer: Lowell Mason"],
        ["a label almost a role", "Arr: John Doe"],
        ["a group with no label among labelled ones", "Words: Isaac Watts; Lowell Mason"],
        ["a group before the labelled ones with no label", "Isaac Watts; Music: Lowell Mason"],
        ["an empty name", "Words: Isaac Watts,, John Newton"],
        ["a trailing comma", "Words: Isaac Watts,"],
        ["a label with no names", "Words:"],
        ["a group of nothing but a blank name", "Words: ; Music: Lowell Mason"],
        ["a name with a colon in it", "Music: Trad.: arr. John Doe"],
        ["three roles in one label", "Words & Music & Arr.: John Doe"],
        ["one role twice in one label", "Words & Words: John Doe"],
        ["a pair with a label that is not a role", "Words & Tune: John Doe"],
        ["an empty label", ": John Doe"],
        ["a colon alone", ":"],
        ["a colon in a legacy author", "Psalm 23: paraphrase by Isaac Watts"],
    ])("%s", (_case, author) => {
        expect(parseCredits(author, ROLES)).toEqual({ status: "unparsed", raw: author });
    });
});

describe("renderCredits", () => {
    test("writes the convention: each role's names, separated by commas, the roles by semicolons", () => {
        expect(
            renderCredits([
                { role: "Words", names: ["Isaac Watts", "John Newton"] },
                { role: "Music", names: ["Lowell Mason"] },
                { role: "Arr.", names: ["John Doe"] },
            ])
        ).toBe("Words: Isaac Watts, John Newton; Music: Lowell Mason; Arr.: John Doe");
    });

    test("writes two roles next to each other with the same names as one group", () => {
        expect(
            renderCredits([
                { role: "Words", names: ["John Newton"] },
                { role: "Music", names: ["John Newton"] },
            ])
        ).toBe("Words & Music: John Newton");
        expect(
            renderCredits([
                { role: "Words", names: ["A", "B"] },
                { role: "Music", names: ["A", "B"] },
                { role: "Arr.", names: ["A", "B"] },
            ])
        ).toBe("Words & Music: A, B; Arr.: A, B");
        expect(
            renderCredits([
                { role: "Words", names: ["A", "B"] },
                { role: "Music", names: ["B", "A"] },
            ])
        ).toBe("Words: A, B; Music: B, A");
    });

    test("leaves out a role with no names, and writes no credits as nothing", () => {
        expect(renderCredits([{ role: "Words", names: [] }, { role: "Music", names: ["B"] }])).toBe("Music: B");
        expect(renderCredits([])).toBe("");
    });

    test("reads back as the same credits", () => {
        const authors = [
            "Words: Isaac Watts; Music: Lowell Mason; Arr.: John Doe",
            "Words & Music: John Newton",
            "Words: A, B; Music: C; Arr. & Trans.: D",
            "Music: B; Words: A",
            "words and music: X; trans.: Y, Z",
        ];
        for (const author of authors) {
            const first = parseCredits(author, ROLES);
            expect(first.status).toBe("ok");
            const credits = first.status === "ok" ? first.credits : [];
            expect([author, parseCredits(renderCredits(credits), ROLES)]).toEqual([
                author,
                { status: "ok", credits },
            ]);
        }
    });
});

describe("renderCreditLine", () => {
    test("prints each role's phrase and names as a sentence", () => {
        expect(
            renderCreditLine(
                [
                    { role: "Words", names: ["A", "B"] },
                    { role: "Music", names: ["C"] },
                    { role: "Arr.", names: ["D"] },
                ],
                PHRASES
            )
        ).toBe("Words by A and B. Music by C. Arr. by D.");
    });

    test("prints 'Words and Music by' when the same names hold both", () => {
        expect(
            renderCreditLine(
                [
                    { role: "Words", names: ["X"] },
                    { role: "Music", names: ["X"] },
                ],
                PHRASES
            )
        ).toBe("Words and Music by X.");
        expect(
            renderCreditLine(
                [
                    { role: "Words", names: ["X", "Y"] },
                    { role: "Music", names: ["X", "Y"] },
                    { role: "Trans.", names: ["Z"] },
                ],
                PHRASES
            )
        ).toBe("Words and Music by X and Y. Trans. by Z.");
    });

    test("lists three or more names with commas, the last after 'and'", () => {
        expect(renderCreditLine([{ role: "Words", names: ["A", "B", "C", "D"] }], PHRASES)).toBe(
            "Words by A, B, C and D."
        );
    });

    test("never doubles a period a name ends with", () => {
        expect(
            renderCreditLine(
                [
                    { role: "Words", names: ["John Newton."] },
                    { role: "Music", names: ["Trad."] },
                ],
                PHRASES
            )
        ).toBe("Words by John Newton. Music by Trad.");
    });

    test("takes each phrase from the settings, found without regard to case", () => {
        const phrases = { Words: "Text:", music: "Tune by", "Words & Music": "Written and composed by" };
        expect(
            renderCreditLine(
                [
                    { role: "Words", names: ["A"] },
                    { role: "Music", names: ["B"] },
                ],
                phrases
            )
        ).toBe("Text: A. Tune by B.");
        expect(
            renderCreditLine(
                [
                    { role: "Words", names: ["A"] },
                    { role: "Music", names: ["A"] },
                ],
                phrases
            )
        ).toBe("Written and composed by A.");
    });

    test("a role without a phrase prints '<role> by', and two without one '<role> and <role> by'", () => {
        expect(
            renderCreditLine(
                [
                    { role: "Arr.", names: ["A"] },
                    { role: "Trans.", names: ["A"] },
                    { role: "Descant", names: ["B"] },
                    { role: "constructor", names: ["C"] },
                ],
                {}
            )
        ).toBe("Arr. and Trans. by A. Descant by B. constructor by C.");
    });

    test("prints no credits as nothing", () => {
        expect(renderCreditLine([], PHRASES)).toBe("");
        expect(renderCreditLine([{ role: "Words", names: [] }], PHRASES)).toBe("");
    });
});

describe("renderLegacyCreditLine", () => {
    test("prints the settings' phrases for the first two roles and for both", () => {
        const settings: CreditSettings = {
            creditRoles: ["Text", "Tune"],
            creditPhrases: { Text: "Text by", Tune: "Tune by", "Text & Tune": "Text and tune by" },
        };
        expect(renderLegacyCreditLine("A", settings)).toBe("Text and tune by A");
        expect(renderLegacyCreditLine("A and B", settings)).toBe("Text by A. Tune by B");
        expect(renderLegacyCreditLine("A, B, C", settings)).toBe("Text by A and B. Tune by C");
    });

    test("without phrases, prints '<role> by' and '<role> and <role> by', which are the defaults' words", () => {
        const settings: CreditSettings = { creditRoles: ROLES, creditPhrases: {} };
        for (const author of ["", "X", "A and B", "A, B, C", " and B", "John Newton."]) {
            expect([author, renderLegacyCreditLine(author, settings)]).toEqual([
                author,
                renderLegacyCreditLine(author, DEFAULT_SETTINGS),
            ]);
        }
    });

    test("QUIRK: joins two comma-separated words' authors with ' and ' even when one is empty", () => {
        expect(renderLegacyCreditLine("A,,B", DEFAULT_SETTINGS)).toBe("Words by A and . Music by B");
        expect(renderLegacyCreditLine(", , ", DEFAULT_SETTINGS)).toBe("Words by  and . Music by ");
    });
});

describe("creditLineOf", () => {
    test("prints credits that follow the convention as renderCreditLine does", () => {
        expect(titleLineFor("Words: Isaac Watts; Music: William Croft")).toBe(
            '"T" Words by Isaac Watts. Music by William Croft.'
        );
        expect(titleLineFor("Words & Music: John Newton.")).toBe('"T" Words and Music by John Newton.');
    });

    test("prints an unparsed author as the copyright text always printed it", () => {
        expect(titleLineFor("Composer: Lowell Mason")).toBe(
            '"T" Words and Music by Composer: Lowell Mason.'
        );
        expect(titleLineFor("Words: Isaac Watts, Music: Lowell Mason and John Doe")).toBe(
            '"T" Words by Words: Isaac Watts, Music: Lowell Mason. Music by John Doe.'
        );
        expect(titleLineFor("Psalm 23: Isaac Watts and Lowell Mason")).toBe(
            '"T" Words by Psalm 23: Isaac Watts. Music by Lowell Mason.'
        );
    });

    test("follows the settings' phrases for every status", () => {
        const settings: CreditSettings = {
            creditRoles: ROLES,
            creditPhrases: { ...PHRASES, Words: "Text by", "Words & Music": "Text and tune by" },
        };
        const line = (author: string) => creditLineOf(parseCredits(author, ROLES), settings);
        expect(line("Words: A; Music: B")).toBe("Text by A. Music by B.");
        expect(line("A and B")).toBe("Text by A. Music by B.");
        expect(line("A")).toBe("Text and tune by A.");
        expect(line("Composer: A")).toBe("Text and tune by Composer: A.");
    });

    test("prints 'ok' credits that name nobody as an empty author", () => {
        expect(creditLineOf({ status: "ok", credits: [] }, DEFAULT_SETTINGS)).toBe(
            "Words and Music by Unknown."
        );
    });
});

describe("songCreditsOf", () => {
    test("is a parse's status and its credits, none when it is unparsed", () => {
        expect(songCreditsOf(parseCredits("Words: A; Music: B", ROLES))).toEqual({
            status: "ok",
            credits: [
                { role: "Words", names: ["A"] },
                { role: "Music", names: ["B"] },
            ],
        });
        expect(songCreditsOf(parseCredits("A", ROLES))).toEqual({
            status: "legacy",
            credits: [
                { role: "Words", names: ["A"] },
                { role: "Music", names: ["A"] },
            ],
        });
        expect(songCreditsOf(parseCredits("", ROLES))).toEqual({ status: "legacy", credits: [] });
        expect(songCreditsOf(parseCredits("Composer: A", ROLES))).toEqual({ status: "unparsed", credits: [] });
    });
});

describe("checkCredits", () => {
    test("trims names, drops blank ones, spells roles as the settings do and puts them in their order", () => {
        expect(
            checkCredits(
                [
                    { role: " music ", names: [" Lowell Mason ", ""] },
                    { role: "WORDS", names: ["Isaac Watts", "  "] },
                    { role: "Arr.", names: [] },
                ],
                ROLES
            )
        ).toEqual({
            ok: true,
            credits: [
                { role: "Words", names: ["Isaac Watts"] },
                { role: "Music", names: ["Lowell Mason"] },
            ],
        });
    });

    test("merges a role given twice, each name once", () => {
        expect(
            checkCredits(
                [
                    { role: "Words", names: ["A", "B"] },
                    { role: "words", names: ["B", "C"] },
                ],
                ROLES
            )
        ).toEqual({ ok: true, credits: [{ role: "Words", names: ["A", "B", "C"] }] });
    });

    test("takes no names at all, which write an empty author", () => {
        expect(checkCredits([], ROLES)).toEqual({ ok: true, credits: [] });
        expect(checkCredits([{ role: "Words", names: [" "] }], ROLES)).toEqual({ ok: true, credits: [] });
    });

    test("refuses a role that is not one of the settings'", () => {
        expect(checkCredits([{ role: "Composer", names: ["A"] }], ROLES)).toEqual({
            ok: false,
            message: '"Composer" is not a credit role: use Words, Music, Arr. or Trans.',
        });
        expect(checkCredits([{ role: "Words & Music", names: ["A"] }], ROLES)).toMatchObject({ ok: false });
        expect(checkCredits([{ role: "Composer", names: ["A"] }], ["Text", "Tune"])).toEqual({
            ok: false,
            message: '"Composer" is not a credit role: use Text or Tune.',
        });
    });

    test("refuses a name the convention could not read back as one name", () => {
        expect(checkCredits([{ role: "Words", names: ["Newton, John"] }], ROLES)).toEqual({
            ok: false,
            message:
                '"Newton, John" has a colon, semicolon or comma in it, which separate the credits in Planning Center: give each name on its own.',
        });
        for (const name of ["A: B", "A; B", "A\nB", "x".repeat(CREDIT_NAME_MAX_LENGTH + 1)]) {
            expect([name, checkCredits([{ role: "Words", names: [name] }], ROLES).ok]).toEqual([name, false]);
        }
        expect(checkCredits([{ role: "Words", names: ["x".repeat(CREDIT_NAME_MAX_LENGTH)] }], ROLES).ok).toBe(true);
        expect(checkCredits([{ role: "Words", names: ["Simon & Garfunkel", "Rodgers and Hammerstein"] }], ROLES)).toEqual({
            ok: true,
            credits: [{ role: "Words", names: ["Simon & Garfunkel", "Rodgers and Hammerstein"] }],
        });
    });

    test("what it gives reads back the same through renderCredits and parseCredits", () => {
        const typed: Credit[][] = [
            [
                { role: "Words", names: ["Isaac Watts"] },
                { role: "Music", names: ["William Croft"] },
            ],
            [
                { role: "Music", names: ["John Newton"] },
                { role: "Words", names: ["John Newton"] },
                { role: "Trans.", names: ["A & B", "C and D"] },
            ],
            [{ role: "Arr.", names: ["X"] }],
        ];
        for (const credits of typed) {
            const checked = checkCredits(credits, ROLES);
            expect(checked.ok).toBe(true);
            const ready = checked.ok ? checked.credits : [];
            expect(parseCredits(renderCredits(ready), ROLES)).toEqual({ status: "ok", credits: ready });
        }
    });
});
