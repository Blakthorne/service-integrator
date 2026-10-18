import { describe, expect, test } from "vitest";
import {
    buildCreditLabelReview,
    describeCancelledCreditLabels,
    describeCreditLabelReview,
    describeRequestedCreditLabels,
    isTrustedProposal,
    proposeCreditLabel,
    toCreditLabelTierViews,
    type CreditLabelProposal,
    type CreditLabelSong,
} from "./creditLabels";
import { parseCredits, readLegacyAuthor } from "./credits";
import { DEFAULT_SETTINGS, type CreditSettings } from "./settings";

const SETTINGS: CreditSettings = DEFAULT_SETTINGS;

function propose(author: string | null): CreditLabelProposal {
    return proposeCreditLabel(author, SETTINGS);
}

describe("readLegacyAuthor's dropped parts", () => {
    test("three or more comma-separated parts drop the fourth and after", () => {
        expect(readLegacyAuthor("A, B, C")).toMatchObject({ kind: "three", dropped: [] });
        expect(readLegacyAuthor("A, B, C, D, E")).toMatchObject({
            kind: "three",
            words: ["A", "B"],
            music: "C",
            dropped: ["D", "E"],
        });
    });

    test('" and " drops the third part and after', () => {
        expect(readLegacyAuthor("A and B")).toMatchObject({ kind: "two", dropped: [] });
        expect(readLegacyAuthor("A and B and C")).toMatchObject({
            kind: "two",
            words: "A",
            music: "B",
            dropped: ["C"],
        });
    });
});

describe("proposeCreditLabel", () => {
    test("an author in the convention needs nothing", () => {
        expect(propose("Words: Isaac Watts; Music: Lowell Mason")).toEqual({ kind: "labelled" });
        expect(propose("Words & Music: John Newton")).toEqual({ kind: "labelled" });
    });

    test("one name is labelled as the words' and the music's, and prints as it did", () => {
        expect(propose("Fanny Crosby")).toEqual({
            kind: "proposed",
            shape: "one",
            author: "Words & Music: Fanny Crosby",
            lineBefore: "Words and Music by Fanny Crosby.",
            lineAfter: "Words and Music by Fanny Crosby.",
        });
    });

    test("an ampersand inside one name stays in the name", () => {
        expect(propose("Bill & Gloria Gaither")).toMatchObject({
            kind: "proposed",
            shape: "one",
            author: "Words & Music: Bill & Gloria Gaither",
            lineAfter: "Words and Music by Bill & Gloria Gaither.",
        });
    });

    test('two names joined by " and " are the words\' and the music\'s, and print as they did', () => {
        expect(propose("Isaac Watts and Lowell Mason")).toEqual({
            kind: "proposed",
            shape: "two",
            author: "Words: Isaac Watts; Music: Lowell Mason",
            lineBefore: "Words by Isaac Watts. Music by Lowell Mason.",
            lineAfter: "Words by Isaac Watts. Music by Lowell Mason.",
        });
    });

    test("three comma-separated names are two words' authors and one music's", () => {
        expect(propose("Bob Kauflin, Jordan Kauflin, Matt Merker")).toEqual({
            kind: "proposed",
            shape: "three",
            author: "Words: Bob Kauflin, Jordan Kauflin; Music: Matt Merker",
            lineBefore: "Words by Bob Kauflin and Jordan Kauflin. Music by Matt Merker.",
            lineAfter: "Words by Bob Kauflin and Jordan Kauflin. Music by Matt Merker.",
        });
    });

    test("whitespace around the names is trimmed", () => {
        expect(propose("  Isaac Watts  and  Lowell Mason ")).toMatchObject({
            author: "Words: Isaac Watts; Music: Lowell Mason",
        });
    });

    test("the labels are the roles of the settings", () => {
        const settings: CreditSettings = {
            creditRoles: ["Text", "Tune"],
            creditPhrases: { Text: "Text by", Tune: "Tune by", "Text & Tune": "Text and tune by" },
        };
        expect(proposeCreditLabel("Isaac Watts and Lowell Mason", settings)).toMatchObject({
            author: "Text: Isaac Watts; Tune: Lowell Mason",
            lineAfter: "Text by Isaac Watts. Tune by Lowell Mason.",
        });
        expect(proposeCreditLabel("John Newton", settings)).toMatchObject({
            author: "Text & Tune: John Newton",
            lineBefore: "Text and tune by John Newton.",
            lineAfter: "Text and tune by John Newton.",
        });
    });

    test("an author whose reading drops names is left for a person", () => {
        expect(propose("A, B, C, D")).toEqual({ kind: "manual", reason: "dropped-names" });
        expect(propose("A and B and C")).toEqual({ kind: "manual", reason: "dropped-names" });
    });

    test("an empty or missing author is left for a person", () => {
        expect(propose(null)).toEqual({ kind: "manual", reason: "empty" });
        expect(propose("")).toEqual({ kind: "manual", reason: "empty" });
        expect(propose("   ")).toEqual({ kind: "manual", reason: "empty" });
    });

    test("an author with an empty part is left for a person", () => {
        expect(propose(" and Lowell Mason")).toEqual({ kind: "manual", reason: "missing-part" });
        expect(propose("Isaac Watts and ")).toEqual({ kind: "manual", reason: "missing-part" });
        expect(propose("A, , C")).toEqual({ kind: "manual", reason: "missing-part" });
    });

    test("names separated by one comma are left for a person: who wrote what is not said", () => {
        expect(propose("Isaac Watts, Lowell Mason")).toEqual({ kind: "manual", reason: "comma-name" });
        expect(propose("A, B and C")).toEqual({ kind: "manual", reason: "comma-name" });
    });

    test("a name that cannot be written is left for a person", () => {
        expect(propose("Isaac Watts; Lowell Mason")).toEqual({ kind: "manual", reason: "unwritable" });
        expect(propose("Isaac Watts\nLowell Mason")).toEqual({ kind: "manual", reason: "unwritable" });
        expect(propose("x".repeat(101))).toEqual({ kind: "manual", reason: "unwritable" });
    });

    test("labels that do not parse are left for a person", () => {
        expect(propose("Lyrics: Robert Robinson")).toEqual({ kind: "manual", reason: "unparsed" });
    });

    test("what it proposes reads back as the credits the legacy reading gave", () => {
        for (const author of [
            "Fanny Crosby",
            "Isaac Watts and Lowell Mason",
            "Bob Kauflin, Jordan Kauflin, Matt Merker",
            "John Newton and John Newton",
        ]) {
            const proposal = propose(author);
            expect(proposal.kind).toBe("proposed");
            if (proposal.kind !== "proposed") {
                continue;
            }
            const before = parseCredits(author, SETTINGS.creditRoles);
            const after = parseCredits(proposal.author, SETTINGS.creditRoles);
            expect(after.status).toBe("ok");
            expect(after.status === "ok" && after.credits).toEqual(
                before.status === "legacy" && before.credits
            );
        }
    });
});

describe("isTrustedProposal", () => {
    test("one name and two joined by \"and\" are trusted", () => {
        expect(isTrustedProposal(propose("Fanny Crosby"))).toBe(true);
        expect(isTrustedProposal(propose("Isaac Watts and Lowell Mason"))).toBe(true);
    });

    test("three names are not", () => {
        expect(isTrustedProposal(propose("A, B, C"))).toBe(false);
    });

    test("nor a proposal that would change what the copyright text prints", () => {
        // The legacy line adds a period after one the author ends with.
        const period = propose("John Newton Jr.");
        expect(period).toMatchObject({
            kind: "proposed",
            shape: "one",
            lineBefore: "Words and Music by John Newton Jr..",
            lineAfter: "Words and Music by John Newton Jr.",
        });
        expect(isTrustedProposal(period)).toBe(false);
        // The same name twice prints as one credit once labelled.
        const twice = propose("John Newton and John Newton");
        expect(twice).toMatchObject({
            kind: "proposed",
            author: "Words & Music: John Newton",
            lineBefore: "Words by John Newton. Music by John Newton.",
            lineAfter: "Words and Music by John Newton.",
        });
        expect(isTrustedProposal(twice)).toBe(false);
    });

    test("nothing to label is not trusted", () => {
        expect(isTrustedProposal(propose("Words: A"))).toBe(false);
        expect(isTrustedProposal(propose(null))).toBe(false);
    });
});

describe("buildCreditLabelReview", () => {
    const song = (pcoSongId: string, title: string, author: string | null): CreditLabelSong => ({
        pcoSongId,
        title,
        author,
        catalogSongId: null,
    });

    test("counts the labelled songs, sorts the rest into shapes and lists the others, each by title", () => {
        const review = buildCreditLabelReview(
            [
                song("1", "Holy, Holy, Holy", "Reginald Heber and John B. Dykes"),
                song("2", "Amazing Grace", "Words: John Newton"),
                song("3", "Blessed Assurance", "Fanny Crosby"),
                song("4", "All Hail the Power", "Edward Perronet and Oliver Holden"),
                song("5", "In Christ Alone", "Keith Getty, Stuart Townend"),
                song("6", "Before the Throne", "Charitie Bancroft, Vikki Cook, Matt Merker"),
                song("7", "Abide with Me", null),
            ],
            SETTINGS,
            new Set(["4"])
        );
        expect(review.labelled).toBe(1);
        expect(review.tiers.map(({ shape, rows }) => [shape, rows.map((row) => row.pcoSongId)])).toEqual([
            ["one", ["3"]],
            ["two", ["4", "1"]],
            ["three", ["6"]],
        ]);
        expect(review.tiers[1].rows[0]).toMatchObject({ queued: true, trusted: true });
        expect(review.tiers[1].rows[1]).toMatchObject({ queued: false, trusted: true });
        expect(review.tiers[2].rows[0]).toMatchObject({ trusted: false });
        expect(review.manual.map(({ pcoSongId, reason }) => [pcoSongId, reason])).toEqual([
            ["7", "empty"],
            ["5", "comma-name"],
        ]);
    });

    test("every shape is listed, even with no songs", () => {
        expect(buildCreditLabelReview([], SETTINGS, new Set())).toEqual({
            labelled: 0,
            tiers: [
                { shape: "one", rows: [] },
                { shape: "two", rows: [] },
                { shape: "three", rows: [] },
            ],
            manual: [],
        });
    });
});

describe("describeRequestedCreditLabels", () => {
    test("says how many will be written, were waiting and changed", () => {
        expect(describeRequestedCreditLabels({ queued: 23, waiting: 0, changed: 0 })).toBe(
            "23 labels will be written to Planning Center, a few a second. This page shows how it goes."
        );
        expect(describeRequestedCreditLabels({ queued: 1, waiting: 1, changed: 1 })).toBe(
            "1 label will be written to Planning Center, a few a second. This page shows how it goes. 1 song was waiting to be written already. 1 song changed since this page loaded, so it was left out: it shows as it is now."
        );
        expect(describeRequestedCreditLabels({ queued: 0, waiting: 2, changed: 3 })).toBe(
            "2 songs were waiting to be written already. 3 songs changed since this page loaded, so they were left out: they show as they are now."
        );
        expect(describeRequestedCreditLabels({ queued: 0, waiting: 0, changed: 0 })).toBe("Nothing was chosen.");
    });
});

describe("describeCancelledCreditLabels", () => {
    test("says how many were stopped", () => {
        expect(describeCancelledCreditLabels(12)).toBe("Stopped 12 labels: they were not written.");
        expect(describeCancelledCreditLabels(1)).toBe("Stopped 1 label: it was not written.");
        expect(describeCancelledCreditLabels(0)).toBe("No labels were waiting.");
    });
});

describe("toCreditLabelTierViews", () => {
    test("trims each row to what the browser needs, with the credit line only when it changes", () => {
        const review = buildCreditLabelReview(
            [
                { pcoSongId: "1", title: "Blessed Assurance", author: "Fanny Crosby", catalogSongId: 7 },
                { pcoSongId: "2", title: "Junior", author: "John Newton Jr.", catalogSongId: null },
            ],
            SETTINGS,
            new Set(["2"])
        );
        expect(toCreditLabelTierViews(review)).toEqual([
            {
                shape: "one",
                rows: [
                    {
                        pcoSongId: "1",
                        title: "Blessed Assurance",
                        author: "Fanny Crosby",
                        label: "Words & Music: Fanny Crosby",
                        lineAfter: null,
                        lineBefore: "Words and Music by Fanny Crosby.",
                        queued: false,
                        catalogSongId: 7,
                    },
                    {
                        pcoSongId: "2",
                        title: "Junior",
                        author: "John Newton Jr.",
                        label: "Words & Music: John Newton Jr.",
                        lineAfter: "Words and Music by John Newton Jr.",
                        lineBefore: "Words and Music by John Newton Jr..",
                        queued: true,
                        catalogSongId: null,
                    },
                ],
            },
            { shape: "two", rows: [] },
            { shape: "three", rows: [] },
        ]);
    });
});

describe("describeCreditLabelReview", () => {
    test("says how many are labelled, how many the app can label and how many need a person", () => {
        const review = buildCreditLabelReview(
            [
                { pcoSongId: "1", title: "A", author: "Words: X", catalogSongId: null },
                { pcoSongId: "2", title: "B", author: "Fanny Crosby", catalogSongId: null },
                { pcoSongId: "3", title: "C", author: "Isaac Watts and Lowell Mason", catalogSongId: null },
                { pcoSongId: "4", title: "D", author: null, catalogSongId: null },
            ],
            SETTINGS,
            new Set()
        );
        expect(describeCreditLabelReview(review)).toBe(
            "1 of 4 songs is labelled. The app can label 2 more; 1 needs a person."
        );
        expect(describeCreditLabelReview(buildCreditLabelReview([], SETTINGS, new Set()))).toBe(
            "There are no Planning Center songs yet."
        );
    });
});
