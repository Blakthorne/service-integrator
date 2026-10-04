import { describe, expect, test } from "vitest";
import {
    NO_ROLES_IMPACT,
    ROLES_IMPACT_EXPLANATION,
    checkRolesImpactConfirmed,
    confirmRolesImpactLabel,
    creditLabelSets,
    creditRolesImpact,
    describeLostLabels,
    rolesImpactChangedMessage,
    rolesImpactHeadline,
    rolesImpactKey,
    rolesImpactLabels,
    rolesImpactNotConfirmedMessage,
    type CreditLabelSet,
} from "./creditRoleImpact";
import { creditLineOf, parseCredits } from "./credits";
import { DEFAULT_SETTINGS, type CreditSettings } from "./settings";

const ROLES = DEFAULT_SETTINGS.creditRoles;

/** Authors as the mirror holds them: labelled, legacy, unparsed and missing. */
const AUTHORS = [
    "Words: Thomas Ken; Music: Louis Bourgeois",
    "Words: Isaac Watts; Music: Lowell Mason; Arr.: John Doe",
    "Words & Music: John Newton",
    "words: Fanny Crosby;  MUSIC : William Doane",
    "Music: Lowell Mason; Words: Isaac Watts",
    "Words: Charles Wesley",
    "Words: Martin Luther; Trans.: Frederic Hedge; Music: Martin Luther",
    "John Newton",
    "Isaac Watts and Lowell Mason",
    "",
    null,
    "Text: Isaac Watts; Tune: William Croft",
    "Words: ; Music: Lowell Mason",
];

describe("creditLabelSets", () => {
    test("groups the labelled authors by the roles they name, biggest first", () => {
        expect(creditLabelSets(AUTHORS, ROLES)).toEqual([
            { labels: ["Words", "Music"], songs: 4 },
            { labels: ["Words"], songs: 1 },
            { labels: ["Words", "Music", "Arr."], songs: 1 },
            { labels: ["Words", "Music", "Trans."], songs: 1 },
        ]);
    });

    test("gives the labels as the roles spell them, in their order, whatever the author's case, spaces and order", () => {
        expect(
            creditLabelSets(["music:  B ;WORDS: A", "Words & Music: C", "words and music: D"], ROLES)
        ).toEqual([{ labels: ["Words", "Music"], songs: 3 }]);
    });

    test("leaves out authors with no labels and labels that do not parse: they have none to lose", () => {
        expect(
            creditLabelSets(
                [
                    "John Newton",
                    "",
                    null,
                    "Text: Isaac Watts",
                    "Words: Isaac Watts; Lyrics: Anon",
                    "Words:",
                ],
                ROLES
            )
        ).toEqual([]);
    });

    test("reads the authors with the roles it is given", () => {
        expect(creditLabelSets(AUTHORS, ["Text", "Tune"])).toEqual([
            { labels: ["Text", "Tune"], songs: 1 },
        ]);
    });
});

/** The label sets of `AUTHORS` with the default roles. */
const SETS = creditLabelSets(AUTHORS, ROLES);

describe("creditRolesImpact", () => {
    test("counts the songs that use a renamed role, and under it the label they lose", () => {
        expect(creditRolesImpact(SETS, ["Words", "Tune", "Arr.", "Trans."])).toEqual({
            labels: [{ label: "Music", songs: 6 }],
            songs: 6,
        });
    });

    test("counts a removed role's songs", () => {
        expect(creditRolesImpact(SETS, ["Words", "Music", "Arr."])).toEqual({
            labels: [{ label: "Trans.", songs: 1 }],
            songs: 1,
        });
    });

    test("counts a song that loses two labels once, and once under each label, most songs first", () => {
        expect(creditRolesImpact(SETS, ["Text", "Music"])).toEqual({
            labels: [
                { label: "Words", songs: 7 },
                { label: "Arr.", songs: 1 },
                { label: "Trans.", songs: 1 },
            ],
            songs: 7,
        });
    });

    test("loses nothing when the roles are kept in another case, with other spaces, order or more roles", () => {
        for (const roles of [
            ["words", " MUSIC ", "arr.", "trans."],
            ["Trans.", "Arr.", "Music", "Words"],
            ["Words", "Music", "Arr.", "Trans.", "Desc."],
        ]) {
            expect(creditRolesImpact(SETS, roles)).toBe(NO_ROLES_IMPACT);
        }
    });

    test("loses nothing when no song is labelled", () => {
        expect(creditRolesImpact([], ["Text", "Tune"])).toBe(NO_ROLES_IMPACT);
        expect(NO_ROLES_IMPACT).toEqual({ labels: [], songs: 0 });
    });

    test("names a lost label as the saved roles spell it, adding up its songs across sets", () => {
        const sets: CreditLabelSet[] = [
            { labels: ["Words", "Music"], songs: 2 },
            { labels: ["Music"], songs: 3 },
        ];
        expect(creditRolesImpact(sets, ["Words", "Tune"])).toEqual({
            labels: [{ label: "Music", songs: 5 }],
            songs: 5,
        });
    });

    test("counts exactly the songs whose credit line changes, when a role is renamed with its phrase", () => {
        // The Credits form renames a role in its row, so the row's phrase goes with it.
        const before: CreditSettings = {
            creditRoles: ROLES,
            creditPhrases: DEFAULT_SETTINGS.creditPhrases,
        };
        const after: CreditSettings = {
            creditRoles: ["Words", "Tune", "Arr.", "Trans."],
            creditPhrases: {
                Words: "Words by",
                Tune: "Music by",
                "Arr.": "Arr. by",
                "Trans.": "Trans. by",
                "Words & Tune": "Words and Music by",
            },
        };
        const line = (author: string | null, settings: CreditSettings) =>
            creditLineOf(parseCredits(author, settings.creditRoles), settings);
        const changed = AUTHORS.filter((author) => line(author, before) !== line(author, after));

        expect(changed).toHaveLength(creditRolesImpact(SETS, after.creditRoles).songs);
        expect(line(AUTHORS[0], before)).toBe("Words by Thomas Ken. Music by Louis Bourgeois.");
        expect(line(AUTHORS[0], after)).toBe(
            "Words and Music by Words: Thomas Ken; Music: Louis Bourgeois."
        );
    });
});

describe("rolesImpactKey", () => {
    test("is the same for the same labels and songs, and differs when either does", () => {
        const music = creditRolesImpact(SETS, ["Words", "Tune", "Arr.", "Trans."]);
        expect(rolesImpactKey(music)).toBe(
            rolesImpactKey({ labels: [{ label: "Music", songs: 6 }], songs: 6 })
        );
        expect(rolesImpactKey(music)).not.toBe(
            rolesImpactKey({ labels: [{ label: "Music", songs: 5 }], songs: 5 })
        );
        expect(rolesImpactKey(music)).not.toBe(
            rolesImpactKey({ labels: [{ label: "Words", songs: 6 }], songs: 6 })
        );
        expect(rolesImpactKey(NO_ROLES_IMPACT)).not.toBe(rolesImpactKey(music));
    });
});

describe("the notice's words", () => {
    test("say how many songs change", () => {
        expect(rolesImpactHeadline(1)).toBe("Saving these roles changes the copyright text of 1 song.");
        expect(rolesImpactHeadline(40)).toBe(
            "Saving these roles changes the copyright text of 40 songs."
        );
    });

    test("name the labels with their songs", () => {
        expect(describeLostLabels([{ label: "Music", songs: 38 }])).toBe('"Music" (38 songs)');
        expect(
            describeLostLabels([
                { label: "Music", songs: 38 },
                { label: "Arr.", songs: 3 },
                { label: "Trans.", songs: 1 },
            ])
        ).toBe('"Music" (38 songs), "Arr." (3 songs) and "Trans." (1 song)');
    });

    test("say whose labels they are, for one song or many and one label or many", () => {
        expect(rolesImpactLabels({ labels: [{ label: "Trans.", songs: 1 }], songs: 1 })).toBe(
            'Its author uses a label that would no longer be a role: "Trans." (1 song).'
        );
        expect(
            rolesImpactLabels({
                labels: [
                    { label: "Music", songs: 38 },
                    { label: "Trans.", songs: 2 },
                ],
                songs: 40,
            })
        ).toBe(
            'Their authors use labels that would no longer be roles: "Music" (38 songs) and "Trans." (2 songs).'
        );
    });

    test("say what those songs would print, and that nothing changes in Planning Center", () => {
        expect(ROLES_IMPACT_EXPLANATION).toContain("in place of its credit line");
        expect(ROLES_IMPACT_EXPLANATION).toContain("saving the old roles again brings the credit lines back");
    });

    test("label the checkbox with the songs it confirms", () => {
        expect(confirmRolesImpactLabel(40)).toBe("Change the copyright text of 40 songs");
        expect(confirmRolesImpactLabel(1)).toBe("Change the copyright text of 1 song");
    });
});

describe("checkRolesImpactConfirmed", () => {
    const impact = { labels: [{ label: "Music", songs: 40 }], songs: 40 };

    test("lets roles that change no song be saved, confirmed or not", () => {
        expect(checkRolesImpactConfirmed(NO_ROLES_IMPACT, null)).toEqual({ ok: true });
        expect(checkRolesImpactConfirmed(NO_ROLES_IMPACT, 12)).toEqual({ ok: true });
    });

    test("lets roles be saved once exactly the songs they change are confirmed", () => {
        expect(checkRolesImpactConfirmed(impact, 40)).toEqual({ ok: true });
    });

    test("refuses roles that change songs when nothing was confirmed", () => {
        expect(checkRolesImpactConfirmed(impact, null)).toEqual({
            ok: false,
            message: rolesImpactNotConfirmedMessage(40),
        });
        expect(rolesImpactNotConfirmedMessage(40)).toBe(
            "Confirm that the copyright text of 40 songs will change, or keep the labels their authors use as roles."
        );
        expect(rolesImpactNotConfirmedMessage(1)).toBe(
            "Confirm that the copyright text of 1 song will change, or keep the labels its author uses as roles."
        );
    });

    test("refuses a confirmation of another number of songs, saying how many it is now", () => {
        expect(checkRolesImpactConfirmed(impact, 38)).toEqual({
            ok: false,
            message: rolesImpactChangedMessage(40, 38),
        });
        expect(rolesImpactChangedMessage(40, 38)).toBe(
            "These roles now change the copyright text of 40 songs, not the 38 you confirmed, since the songs or the saved roles changed. Check which songs, then confirm again."
        );
    });
});
