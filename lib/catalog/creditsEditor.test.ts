import { describe, expect, test } from "vitest";
import { CREDIT_NAME_MAX_LENGTH, parseCredits } from "@/lib/credits";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import {
    CREDITS_NO_ANSWER,
    CREDIT_STATUS_LABELS,
    NO_CREDITS_MESSAGE,
    addCreditName,
    canSplitCreditName,
    creditNameProblem,
    creditRows,
    describeCreditsDraft,
    hasCreditNameProblems,
    describeCreditsSave,
    draftCredits,
    previewCredits,
    readCreditsInput,
    removeCreditName,
    sameCredits,
    setCreditName,
    splitCreditName,
    type CreditNamesRow,
} from "./creditsEditor";

const ROLES = DEFAULT_SETTINGS.creditRoles;
const SETTINGS = {
    creditRoles: DEFAULT_SETTINGS.creditRoles,
    creditPhrases: DEFAULT_SETTINGS.creditPhrases,
};

/** Rows for the default roles, from the names of each in order ([] for a blank field). */
function rows(words: string[] = [], music: string[] = [], arr: string[] = [], trans: string[] = []): CreditNamesRow[] {
    return [
        { role: "Words", names: words.length > 0 ? words : [""] },
        { role: "Music", names: music.length > 0 ? music : [""] },
        { role: "Arr.", names: arr.length > 0 ? arr : [""] },
        { role: "Trans.", names: trans.length > 0 ? trans : [""] },
    ];
}

describe("creditRows", () => {
    test("gives a row per role, in the roles' order, with a blank field for a role with no names", () => {
        expect(
            creditRows(
                [
                    { role: "Music", names: ["Lowell Mason"] },
                    { role: "Words", names: ["Isaac Watts", "John Rippon"] },
                ],
                ROLES
            )
        ).toEqual(rows(["Isaac Watts", "John Rippon"], ["Lowell Mason"]));
    });

    test("gives blank rows for no credits", () => {
        expect(creditRows([], ROLES)).toEqual(rows());
    });

    test("keeps a credit whose role is no longer a role in a row at the end", () => {
        expect(creditRows([{ role: "Tune", names: ["X"] }], ["Words", "Music"])).toEqual([
            { role: "Words", names: [""] },
            { role: "Music", names: [""] },
            { role: "Tune", names: ["X"] },
        ]);
    });

    test("copies the names, so editing a row never changes the credits", () => {
        const credits = [{ role: "Words", names: ["A"] }];
        const [first] = creditRows(credits, ROLES);
        first.names.push("B");
        expect(credits[0].names).toEqual(["A"]);
    });
});

describe("draftCredits", () => {
    test("starts a labelled author from its credits", () => {
        expect(draftCredits("Words: Isaac Watts; Music: Lowell Mason", ROLES)).toEqual({
            status: "ok",
            rows: rows(["Isaac Watts"], ["Lowell Mason"]),
            unplaced: [],
        });
    });

    test("fills both roles from 'Words & Music'", () => {
        expect(draftCredits("Words & Music: John Newton", ROLES).rows).toEqual(
            rows(["John Newton"], ["John Newton"])
        );
    });

    test("splits an author with no labels as the copyright text reads it: 'A and B'", () => {
        expect(draftCredits("Isaac Watts and Lowell Mason", ROLES)).toEqual({
            status: "legacy",
            rows: rows(["Isaac Watts"], ["Lowell Mason"]),
            unplaced: [],
        });
    });

    test("splits 'A, B, C' as words by A and B, music by C", () => {
        expect(draftCredits("John Newton, John Rees, Edwin Excell", ROLES).rows).toEqual(
            rows(["John Newton", "John Rees"], ["Edwin Excell"])
        );
    });

    test("gives a single author both roles, as the copyright text does", () => {
        expect(draftCredits("Fanny Crosby", ROLES).rows).toEqual(
            rows(["Fanny Crosby"], ["Fanny Crosby"])
        );
    });

    test("keeps 'A, B' as one name in both roles, to be split by hand", () => {
        expect(draftCredits("Isaac Watts, Lowell Mason", ROLES).rows).toEqual(
            rows(["Isaac Watts, Lowell Mason"], ["Isaac Watts, Lowell Mason"])
        );
    });

    test("starts with blank rows for no author", () => {
        for (const author of [null, "", "   "]) {
            expect(draftCredits(author, ROLES)).toEqual({ status: "legacy", rows: rows(), unplaced: [] });
        }
    });

    test("fills the roles from the groups of an unparsed author that read, and lists the others", () => {
        expect(draftCredits("Words: Isaac Watts; Tune: Lowell Mason; Arr.: John Doe", ROLES)).toEqual({
            status: "unparsed",
            rows: rows(["Isaac Watts"], [], ["John Doe"]),
            unplaced: ["Tune: Lowell Mason"],
        });
    });

    test("lists a group with no label of an unparsed author too", () => {
        expect(draftCredits("Words: Isaac Watts; Lowell Mason", ROLES)).toEqual({
            status: "unparsed",
            rows: rows(["Isaac Watts"]),
            unplaced: ["Lowell Mason"],
        });
    });

    test("merges a role named twice in an unparsed author, each name once", () => {
        expect(
            draftCredits("Words: A; Words: A, B; Composer: C", ROLES).rows
        ).toEqual(rows(["A", "B"]));
    });

    test("reads the labels with the roles it is given", () => {
        expect(draftCredits("Text: A; Tune: B", ["Text", "Tune"])).toEqual({
            status: "ok",
            rows: [
                { role: "Text", names: ["A"] },
                { role: "Tune", names: ["B"] },
            ],
            unplaced: [],
        });
    });
});

describe("editing the rows", () => {
    const start = rows(["A", "B"], ["C"]);

    test("sets one name, leaving the rows given as they were", () => {
        expect(setCreditName(start, 0, 1, "Bee")).toEqual(rows(["A", "Bee"], ["C"]));
        expect(start).toEqual(rows(["A", "B"], ["C"]));
    });

    test("adds a blank name at the end of a row", () => {
        expect(addCreditName(start, 1)).toEqual(rows(["A", "B"], ["C", ""]));
    });

    test("removes a name, and leaves a row's only name blank rather than remove its field", () => {
        expect(removeCreditName(start, 0, 0)).toEqual(rows(["B"], ["C"]));
        expect(removeCreditName(start, 1, 0)).toEqual(rows(["A", "B"]));
    });

    test("splits a name at its commas and semicolons, in its place", () => {
        const legacy = rows(["Isaac Watts, Lowell Mason"], ["X; Y ,, Z"]);
        expect(splitCreditName(legacy, 0, 0)).toEqual(
            rows(["Isaac Watts", "Lowell Mason"], ["X; Y ,, Z"])
        );
        expect(splitCreditName(legacy, 1, 0)).toEqual(
            rows(["Isaac Watts, Lowell Mason"], ["X", "Y", "Z"])
        );
        expect(splitCreditName(rows(["A", "B, C", "D"]), 0, 1)).toEqual(rows(["A", "B", "C", "D"]));
    });

    test("leaves a name with nothing to split as it is", () => {
        expect(splitCreditName(start, 0, 0)).toEqual(start);
        expect(splitCreditName(rows(["A,"]), 0, 0)).toEqual(rows(["A,"]));
    });

    test("offers a split only for a name that holds several", () => {
        expect(canSplitCreditName("Isaac Watts, Lowell Mason")).toBe(true);
        expect(canSplitCreditName("A;B")).toBe(true);
        expect(canSplitCreditName("Isaac Watts")).toBe(false);
        expect(canSplitCreditName("Watts, ")).toBe(false);
        expect(canSplitCreditName("")).toBe(false);
    });
});

describe("creditNameProblem", () => {
    test("is null for a name the convention takes, and for a blank one", () => {
        for (const name of ["Isaac Watts", "J. S. Bach", "  Fanny Crosby  ", "", "   "]) {
            expect(creditNameProblem(name, ROLES)).toBeNull();
        }
    });

    test("says what is wrong, as checkCredits does", () => {
        expect(creditNameProblem("Watts, Mason", ROLES)).toMatch(/colon, semicolon or comma/);
        expect(creditNameProblem("Words: Watts", ROLES)).toMatch(/colon, semicolon or comma/);
        expect(creditNameProblem("Watts\nMason", ROLES)).toMatch(/one line/);
        expect(creditNameProblem("x".repeat(CREDIT_NAME_MAX_LENGTH + 1), ROLES)).toMatch(
            `at most ${CREDIT_NAME_MAX_LENGTH}`
        );
    });

    test("finds no problem with no roles to check against", () => {
        expect(creditNameProblem("Watts, Mason", [])).toBeNull();
    });
});

describe("hasCreditNameProblems", () => {
    test("is true when a name is marked, and false for blank or good names", () => {
        expect(hasCreditNameProblems(rows(["A"], ["B, C"]), ROLES)).toBe(true);
        expect(hasCreditNameProblems(rows(["A", "x\ny"]), ROLES)).toBe(true);
        expect(hasCreditNameProblems(rows(["A"], ["B"]), ROLES)).toBe(false);
        expect(hasCreditNameProblems(rows(), ROLES)).toBe(false);
    });

    test("is false for a row whose role is no longer a role: the preview says that", () => {
        expect(hasCreditNameProblems([{ role: "Tune", names: ["X"] }], ROLES)).toBe(false);
    });
});

describe("previewCredits", () => {
    test("gives the author to write and the credit line to print", () => {
        expect(previewCredits(rows(["Isaac Watts"], ["Lowell Mason"]), SETTINGS)).toEqual({
            ok: true,
            credits: [
                { role: "Words", names: ["Isaac Watts"] },
                { role: "Music", names: ["Lowell Mason"] },
            ],
            author: "Words: Isaac Watts; Music: Lowell Mason",
            creditLine: "Words by Isaac Watts. Music by Lowell Mason.",
        });
    });

    test("joins two roles the same people hold", () => {
        const preview = previewCredits(rows(["John Newton"], ["John Newton"], ["Edwin Excell"]), SETTINGS);
        expect(preview).toMatchObject({
            ok: true,
            author: "Words & Music: John Newton; Arr.: Edwin Excell",
            creditLine: "Words and Music by John Newton. Arr. by Edwin Excell.",
        });
    });

    test("trims the names and leaves blank ones out", () => {
        expect(previewCredits(rows(["  A ", " "], ["", "B"]), SETTINGS)).toMatchObject({
            ok: true,
            author: "Words: A; Music: B",
        });
    });

    test("prints what the copyright text prints for no author when there are no names", () => {
        expect(previewCredits(rows(), SETTINGS)).toEqual({
            ok: true,
            credits: [],
            author: "",
            creditLine: "Words and Music by Unknown.",
        });
    });

    test("follows the phrases of the settings", () => {
        const preview = previewCredits(rows(["A"], ["B"]), {
            ...SETTINGS,
            creditPhrases: { Words: "Text:", Music: "Tune:" },
        });
        expect(preview).toMatchObject({ ok: true, creditLine: "Text: A. Tune: B." });
    });

    test("says why when a name cannot be written", () => {
        expect(previewCredits(rows(["Watts, Mason"]), SETTINGS)).toEqual({
            ok: false,
            message: expect.stringMatching(/"Watts, Mason" has a colon, semicolon or comma/),
        });
    });

    test("refuses a row whose role is no longer a role", () => {
        const preview = previewCredits([{ role: "Tune", names: ["X"] }], SETTINGS);
        expect(preview).toEqual({ ok: false, message: expect.stringMatching(/"Tune" is not a credit role/) });
    });

    test("writes what reads back as the same credits", () => {
        const preview = previewCredits(rows(["A", "B"], ["C"], [], ["D"]), SETTINGS);
        if (!preview.ok) {
            throw new Error(preview.message);
        }
        expect(parseCredits(preview.author, ROLES)).toEqual({ status: "ok", credits: preview.credits });
    });
});

describe("sameCredits", () => {
    const credits = [
        { role: "Words", names: ["A", "B"] },
        { role: "Music", names: ["C"] },
    ];

    test("is true for the same roles and names in the same order", () => {
        expect(sameCredits(credits, structuredClone(credits))).toBe(true);
        expect(sameCredits([], [])).toBe(true);
    });

    test("is false for any difference", () => {
        expect(sameCredits(credits, [credits[0]])).toBe(false);
        expect(sameCredits(credits, [{ role: "Words", names: ["B", "A"] }, credits[1]])).toBe(false);
        expect(sameCredits(credits, [credits[0], { role: "Arr.", names: ["C"] }])).toBe(false);
        expect(sameCredits(credits, [credits[0], { role: "Music", names: ["C", "D"] }])).toBe(false);
    });
});

describe("the card's words", () => {
    test("labels each status", () => {
        expect(CREDIT_STATUS_LABELS).toEqual({
            ok: "Labelled",
            legacy: "Not in the labelled form yet",
            unparsed: "Labels the app cannot read",
        });
    });

    test("explains each status, and an author that is blank", () => {
        const author = "Words: A";
        expect(describeCreditsDraft(draftCredits(author, ROLES), author, ROLES)).toMatch(/labelled form/);
        expect(describeCreditsDraft(draftCredits("A and B", ROLES), "A and B", ROLES)).toMatch(
            /without labels.*check it, then save/
        );
        expect(describeCreditsDraft(draftCredits(null, ROLES), null, ROLES)).toMatch(/no credits/);
        expect(describeCreditsDraft(draftCredits("Tune: B", ROLES), "Tune: B", ROLES)).toBe(
            "Planning Center's credits have labels that are not the credit roles (Words, Music, Arr. or Trans.), so the copyright text prints them as they are. Put each name under its role below, then save to write them in the labelled form."
        );
    });

    test("refuses no names, and says what an action that never answered may have done", () => {
        expect(NO_CREDITS_MESSAGE).toBe("Enter at least one name: the credits would be empty.");
        expect(CREDITS_NO_ANSWER).toMatch(/may or may not have been saved/);
    });

    test("says what a save changed, or that it changed nothing", () => {
        expect(describeCreditsSave({ changed: true, author: "Words: A; Music: B" })).toBe(
            'Saved. Planning Center\'s author is now "Words: A; Music: B".'
        );
        expect(describeCreditsSave({ changed: false, author: "Words: A" })).toBe(
            "Planning Center already had these credits, so nothing was changed."
        );
    });
});

describe("readCreditsInput", () => {
    test("takes a list of roles with their names", () => {
        const credits = [
            { role: "Words", names: ["A", " "] },
            { role: "Music", names: [] },
        ];
        expect(readCreditsInput(credits)).toEqual(credits);
        expect(readCreditsInput([])).toEqual([]);
    });

    test("copies what it takes and leaves anything else out", () => {
        const input = [{ role: "Words", names: ["A"], extra: true }];
        const read = readCreditsInput(input);
        expect(read).toEqual([{ role: "Words", names: ["A"] }]);
        read?.[0].names.push("B");
        expect(input[0].names).toEqual(["A"]);
    });

    test("refuses anything that is not that shape", () => {
        for (const value of [
            null,
            undefined,
            "Words: A",
            42,
            { role: "Words", names: ["A"] },
            [null],
            ["Words"],
            [{ names: ["A"] }],
            [{ role: 1, names: ["A"] }],
            [{ role: "Words" }],
            [{ role: "Words", names: "A" }],
            [{ role: "Words", names: [1] }],
            [{ role: "Words", names: [null] }],
            Array.from({ length: 51 }, () => ({ role: "Words", names: [] })),
            [{ role: "Words", names: Array.from({ length: 51 }, () => "A") }],
        ]) {
            expect(readCreditsInput(value)).toBeNull();
        }
    });
});
