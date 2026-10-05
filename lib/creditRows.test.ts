import { describe, expect, test } from "vitest";
import {
    CREDIT_PAIR_PHRASE_FIELD,
    CREDIT_ROLES_MIN,
    addCreditRow,
    canAddCreditRow,
    canRemoveCreditRow,
    creditFormValues,
    creditPhraseField,
    creditRoleField,
    creditRowsOf,
    moveCreditRow,
    removeCreditRow,
} from "./creditRows";
import { CREDIT_ROLES_MAX, DEFAULT_SETTINGS } from "./settings";

/** The form of the default roles and phrases. */
const DEFAULTS = creditFormValues(DEFAULT_SETTINGS.creditRoles, DEFAULT_SETTINGS.creditPhrases);

/** The roles of a form's rows, in order. */
function rolesOf(values: Record<string, string>): string[] {
    return creditRowsOf(values).map((row) => row.role);
}

describe("the fields' names", () => {
    test("number each row's role and phrase", () => {
        expect(creditRoleField(0)).toBe("creditRole-0");
        expect(creditPhraseField(3)).toBe("creditPhrase-3");
    });
});

describe("creditFormValues", () => {
    test("holds each default role with the phrase it prints, and the phrase for words and music together", () => {
        expect(DEFAULTS).toEqual({
            "creditRole-0": "Words",
            "creditPhrase-0": "Words by",
            "creditRole-1": "Music",
            "creditPhrase-1": "Music by",
            "creditRole-2": "Arr.",
            "creditPhrase-2": "Arr. by",
            "creditRole-3": "Trans.",
            "creditPhrase-3": "Trans. by",
            creditPairPhrase: "Words and Music by",
        });
    });

    test("shows what a role with no phrase prints, and a phrase the settings give a role in another case", () => {
        const values = creditFormValues(["Lyrics", "Tune"], { lyrics: "Text by" });
        expect(values).toEqual({
            "creditRole-0": "Lyrics",
            "creditPhrase-0": "Text by",
            "creditRole-1": "Tune",
            "creditPhrase-1": "Tune by",
            creditPairPhrase: "Lyrics and Tune by",
        });
    });

    test("takes the phrase for the first two roles from the settings", () => {
        const values = creditFormValues(["Words", "Music"], { "Words & Music": "Text and tune by" });
        expect(values[CREDIT_PAIR_PHRASE_FIELD]).toBe("Text and tune by");
    });
});

describe("creditRowsOf", () => {
    test("lists the rows in order, with their fields", () => {
        expect(creditRowsOf(DEFAULTS)[2]).toEqual({ index: 2, role: "Arr.", phrase: "Arr. by" });
        expect(rolesOf(DEFAULTS)).toEqual(["Words", "Music", "Arr.", "Trans."]);
    });

    test("stops at the first gap, and takes a missing phrase as blank", () => {
        expect(
            creditRowsOf({ "creditRole-0": "A", "creditRole-1": "B", "creditRole-3": "D" })
        ).toEqual([
            { index: 0, role: "A", phrase: "" },
            { index: 1, role: "B", phrase: "" },
        ]);
        expect(creditRowsOf({ creditPairPhrase: "x" })).toEqual([]);
    });
});

describe("addCreditRow", () => {
    test("adds a blank row at the end, and keeps the other fields", () => {
        const added = addCreditRow(DEFAULTS);
        expect(creditRowsOf(added)).toHaveLength(5);
        expect(creditRowsOf(added)[4]).toEqual({ index: 4, role: "", phrase: "" });
        expect(rolesOf(added).slice(0, 4)).toEqual(["Words", "Music", "Arr.", "Trans."]);
        expect(added[CREDIT_PAIR_PHRASE_FIELD]).toBe("Words and Music by");
    });

    test("does not change the values it is given", () => {
        const before = { ...DEFAULTS };
        addCreditRow(DEFAULTS);
        expect(DEFAULTS).toEqual(before);
    });

    test("adds no more than the most roles", () => {
        let values = DEFAULTS;
        while (canAddCreditRow(values)) {
            values = addCreditRow(values);
        }
        expect(creditRowsOf(values)).toHaveLength(CREDIT_ROLES_MAX);
        expect(addCreditRow(values)).toBe(values);
    });
});

describe("removeCreditRow", () => {
    test("removes a row and numbers the rest from 0 again, phrases with their roles", () => {
        const removed = removeCreditRow(DEFAULTS, 1);
        expect(creditRowsOf(removed)).toEqual([
            { index: 0, role: "Words", phrase: "Words by" },
            { index: 1, role: "Arr.", phrase: "Arr. by" },
            { index: 2, role: "Trans.", phrase: "Trans. by" },
        ]);
        expect(Object.hasOwn(removed, "creditRole-3")).toBe(false);
        expect(Object.hasOwn(removed, "creditPhrase-3")).toBe(false);
        expect(removed[CREDIT_PAIR_PHRASE_FIELD]).toBe("Words and Music by");
    });

    test("removes the last row", () => {
        expect(rolesOf(removeCreditRow(DEFAULTS, 3))).toEqual(["Words", "Music", "Arr."]);
    });

    test("leaves the words' and the music's roles: it removes nothing at the fewest", () => {
        const two = removeCreditRow(removeCreditRow(DEFAULTS, 3), 2);
        expect(rolesOf(two)).toEqual(["Words", "Music"]);
        expect(creditRowsOf(two)).toHaveLength(CREDIT_ROLES_MIN);
        expect(canRemoveCreditRow(two)).toBe(false);
        expect(removeCreditRow(two, 0)).toBe(two);
        expect(canRemoveCreditRow(DEFAULTS)).toBe(true);
    });

    test("removes nothing for a row that is not there", () => {
        expect(removeCreditRow(DEFAULTS, 4)).toBe(DEFAULTS);
        expect(removeCreditRow(DEFAULTS, -1)).toBe(DEFAULTS);
    });
});

describe("moveCreditRow", () => {
    test("moves a row up, swapping it with the one above, phrases with their roles", () => {
        const moved = moveCreditRow(DEFAULTS, 2, -1);
        expect(rolesOf(moved)).toEqual(["Words", "Arr.", "Music", "Trans."]);
        expect(creditRowsOf(moved)[1].phrase).toBe("Arr. by");
        expect(creditRowsOf(moved)[2].phrase).toBe("Music by");
    });

    test("moves a row down", () => {
        expect(rolesOf(moveCreditRow(DEFAULTS, 0, 1))).toEqual(["Music", "Words", "Arr.", "Trans."]);
    });

    test("does not move the first row up, or the last down, or a row that is not there", () => {
        expect(moveCreditRow(DEFAULTS, 0, -1)).toBe(DEFAULTS);
        expect(moveCreditRow(DEFAULTS, 3, 1)).toBe(DEFAULTS);
        expect(moveCreditRow(DEFAULTS, 9, -1)).toBe(DEFAULTS);
        expect(moveCreditRow(DEFAULTS, -1, 1)).toBe(DEFAULTS);
    });

    test("keeps the other fields", () => {
        expect(moveCreditRow(DEFAULTS, 1, 1)[CREDIT_PAIR_PHRASE_FIELD]).toBe("Words and Music by");
    });
});
