import { describe, expect, test } from "vitest";
import {
    PCO_SONG_COPYRIGHT_MAX_LENGTH,
    PCO_SONG_TITLE_MAX_LENGTH,
} from "@/lib/queries/pcoSongs";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import {
    NEW_PCO_SONG_COPYRIGHT_MAX_LENGTH,
    NEW_PCO_SONG_FIELD_ORDER,
    NEW_PCO_SONG_TITLE_MAX_LENGTH,
    checkNewPcoSongFields,
    createdSongStage,
    describeCreatedSong,
    newPcoSongFields,
    newPcoSongSummary,
    readCcliSongNumber,
    readNewPcoSongInput,
    type CheckedNewPcoSong,
    type NewPcoSongFields,
} from "./newPcoSong";

const ROLES = DEFAULT_SETTINGS.creditRoles;

/** The form for "Abba, Father (PRITCHARD)", with `overrides`. */
function fields(overrides: Partial<NewPcoSongFields> = {}): NewPcoSongFields {
    return { ...newPcoSongFields("Abba, Father (PRITCHARD)", ROLES), ...overrides };
}

describe("newPcoSongFields", () => {
    test("starts with the title, a blank row per role and nothing else", () => {
        expect(newPcoSongFields("Abba, Father", ROLES)).toEqual({
            title: "Abba, Father",
            credits: [
                { role: "Words", names: [""] },
                { role: "Music", names: [""] },
                { role: "Arr.", names: [""] },
                { role: "Trans.", names: [""] },
            ],
            copyright: "",
            ccliNumber: "",
            useCcliDetails: false,
        });
    });

    test("lists the parts in the form's order", () => {
        expect(NEW_PCO_SONG_FIELD_ORDER).toEqual(["title", "credits", "copyright", "ccliNumber"]);
    });
});

describe("readCcliSongNumber", () => {
    test("reads a whole number, spaces around it allowed, and blank as none", () => {
        expect(readCcliSongNumber("22025")).toEqual({ ok: true, value: 22025 });
        expect(readCcliSongNumber(" 7001 ")).toEqual({ ok: true, value: 7001 });
        expect(readCcliSongNumber("007")).toEqual({ ok: true, value: 7 });
        expect(readCcliSongNumber("999999999999999")).toEqual({ ok: true, value: 999_999_999_999_999 });
        expect(readCcliSongNumber("")).toEqual({ ok: true, value: null });
        expect(readCcliSongNumber("   ")).toEqual({ ok: true, value: null });
    });

    test("refuses anything else, in the query's words", () => {
        for (const text of ["0", "000", "-1", "+1", "1.5", "1e3", "22,025", "22 025", "abc", "1234567890123456"]) {
            expect(readCcliSongNumber(text)).toEqual({
                ok: false,
                message: "A CCLI song number is a whole number, such as 22025.",
            });
        }
    });
});

describe("checkNewPcoSongFields", () => {
    test("gives the song to send: the title and copyright trimmed, the credits written in the convention", () => {
        const form = fields({
            title: "  Abba, Father (PRITCHARD) ",
            credits: [
                { role: "Words", names: [" Dave Bilbrough "] },
                { role: "Music", names: ["Dave Bilbrough", ""] },
                { role: "Arr.", names: [""] },
                { role: "Trans.", names: [""] },
            ],
            copyright: " © 1977 Thankyou Music ",
            ccliNumber: " 1234 ",
            useCcliDetails: true,
        });
        expect(checkNewPcoSongFields(form, ROLES)).toEqual({
            ok: true,
            song: {
                title: "Abba, Father (PRITCHARD)",
                credits: [
                    { role: "Words", names: ["Dave Bilbrough"] },
                    { role: "Music", names: ["Dave Bilbrough"] },
                ],
                author: "Words & Music: Dave Bilbrough",
                copyright: "© 1977 Thankyou Music",
                ccliNumber: 1234,
                useCcliDetails: true,
            },
        });
    });

    test("takes a song with no credits, copyright or CCLI number", () => {
        expect(checkNewPcoSongFields(fields(), ROLES)).toEqual({
            ok: true,
            song: {
                title: "Abba, Father (PRITCHARD)",
                credits: [],
                author: "",
                copyright: "",
                ccliNumber: null,
                useCcliDetails: false,
            },
        });
    });

    test("refuses a missing title, one on two lines, or one too long", () => {
        expect(checkNewPcoSongFields(fields({ title: "  " }), ROLES)).toEqual({
            ok: false,
            fieldErrors: { title: "Enter the song's title." },
        });
        expect(checkNewPcoSongFields(fields({ title: "A\nB" }), ROLES)).toEqual({
            ok: false,
            fieldErrors: { title: "The title must be on one line." },
        });
        expect(
            checkNewPcoSongFields(fields({ title: "x".repeat(NEW_PCO_SONG_TITLE_MAX_LENGTH + 1) }), ROLES)
        ).toEqual({ ok: false, fieldErrors: { title: "The title is at most 255 characters." } });
        expect(
            checkNewPcoSongFields(fields({ title: "x".repeat(NEW_PCO_SONG_TITLE_MAX_LENGTH) }), ROLES).ok
        ).toBe(true);
    });

    test("refuses credits checkCredits refuses, in its words", () => {
        const check = checkNewPcoSongFields(
            fields({ credits: [{ role: "Words", names: ["Watts, Mason"] }] }),
            ROLES
        );
        expect(check).toEqual({
            ok: false,
            fieldErrors: { credits: expect.stringMatching(/"Watts, Mason" has a colon, semicolon or comma/) },
        });
    });

    test("refuses a copyright on two lines or too long", () => {
        expect(checkNewPcoSongFields(fields({ copyright: "A\tB" }), ROLES)).toEqual({
            ok: false,
            fieldErrors: { copyright: "The copyright must be on one line." },
        });
        expect(
            checkNewPcoSongFields(
                fields({ copyright: "x".repeat(NEW_PCO_SONG_COPYRIGHT_MAX_LENGTH + 1) }),
                ROLES
            )
        ).toEqual({ ok: false, fieldErrors: { copyright: "The copyright is at most 1000 characters." } });
    });

    test("refuses a CCLI number that is not one", () => {
        expect(checkNewPcoSongFields(fields({ ccliNumber: "22,025" }), ROLES)).toEqual({
            ok: false,
            fieldErrors: { ccliNumber: "A CCLI song number is a whole number, such as 22025." },
        });
    });

    test("gives every part's problem at once", () => {
        const check = checkNewPcoSongFields(
            fields({
                title: "",
                credits: [{ role: "Words", names: ["A;B"] }],
                copyright: "A\nB",
                ccliNumber: "x",
            }),
            ROLES
        );
        expect(check.ok).toBe(false);
        expect(Object.keys(check.ok ? {} : check.fieldErrors)).toEqual([
            "title",
            "credits",
            "copyright",
            "ccliNumber",
        ]);
    });

    test("has the query's limits", () => {
        expect(NEW_PCO_SONG_TITLE_MAX_LENGTH).toBe(PCO_SONG_TITLE_MAX_LENGTH);
        expect(NEW_PCO_SONG_COPYRIGHT_MAX_LENGTH).toBe(PCO_SONG_COPYRIGHT_MAX_LENGTH);
    });
});

describe("newPcoSongSummary", () => {
    const song: CheckedNewPcoSong = {
        title: "Abba, Father (PRITCHARD)",
        credits: [{ role: "Words", names: ["A"] }],
        author: "Words: A",
        copyright: "Public Domain",
        ccliNumber: null,
        useCcliDetails: false,
    };
    const blank = { ...song, credits: [], author: "", copyright: "" };

    test("lists what was typed, without a CCLI number", () => {
        expect(newPcoSongSummary(song)).toEqual([
            { label: "Title", value: "Abba, Father (PRITCHARD)" },
            { label: "Author", value: "Words: A" },
            { label: "Copyright", value: "Public Domain" },
            { label: "CCLI number", value: "None" },
        ]);
    });

    test("says what a blank author and copyright come to, without a CCLI number", () => {
        expect(newPcoSongSummary(blank)).toEqual([
            { label: "Title", value: "Abba, Father (PRITCHARD)" },
            { label: "Author", value: "None" },
            { label: "Copyright", value: 'None: the copyright text says "Public Domain."' },
            { label: "CCLI number", value: "None" },
        ]);
    });

    test("with a CCLI number, writes back the title and credits typed, and takes CCLI's copyright", () => {
        expect(newPcoSongSummary({ ...song, ccliNumber: 22025 })).toEqual([
            { label: "Title", value: "Abba, Father (PRITCHARD)", note: "written back over CCLI's title" },
            { label: "Author", value: "Words: A", note: "written back over CCLI's credits" },
            { label: "Copyright", value: "From CCLI", note: 'in place of "Public Domain", typed here' },
            { label: "CCLI number", value: "22025" },
        ]);
    });

    test("with a CCLI number and nothing typed but the title, takes CCLI's credits and copyright", () => {
        expect(newPcoSongSummary({ ...blank, ccliNumber: 22025 })).toEqual([
            { label: "Title", value: "Abba, Father (PRITCHARD)", note: "written back over CCLI's title" },
            { label: "Author", value: "From CCLI", note: "no credits are typed to write back over CCLI's" },
            { label: "Copyright", value: "From CCLI", note: undefined },
            { label: "CCLI number", value: "22025" },
        ]);
    });

    test("with CCLI's details kept, takes them all, saying what each replaces", () => {
        expect(newPcoSongSummary({ ...song, ccliNumber: 22025, useCcliDetails: true })).toEqual([
            { label: "Title", value: "From CCLI", note: 'in place of "Abba, Father (PRITCHARD)", typed here' },
            { label: "Author", value: "From CCLI", note: 'in place of "Words: A", typed here' },
            { label: "Copyright", value: "From CCLI", note: 'in place of "Public Domain", typed here' },
            { label: "CCLI number", value: "22025" },
        ]);
        expect(newPcoSongSummary({ ...blank, ccliNumber: 22025, useCcliDetails: true })).toEqual([
            { label: "Title", value: "From CCLI", note: 'in place of "Abba, Father (PRITCHARD)", typed here' },
            { label: "Author", value: "From CCLI", note: undefined },
            { label: "Copyright", value: "From CCLI", note: undefined },
            { label: "CCLI number", value: "22025" },
        ]);
    });

    test("ignores Use CCLI's details without a CCLI number", () => {
        expect(newPcoSongSummary({ ...song, useCcliDetails: true })).toEqual(newPcoSongSummary(song));
    });
});

describe("a song just created", () => {
    const linked = { pcoSongId: "26000099", linked: true };
    const notLinked = { pcoSongId: "26000099", linked: false };

    test("is linked once the page shows the link to it", () => {
        expect(createdSongStage(linked, "26000099")).toBe("linked");
    });

    test("is being linked while the page that shows the link is on its way", () => {
        expect(createdSongStage(linked, null)).toBe("linking");
    });

    test("is not linked when the link could not be made", () => {
        expect(createdSongStage(notLinked, null)).toBe("not-linked");
    });

    test("says nothing with no song created, or a link to another song since", () => {
        expect(createdSongStage(null, null)).toBeNull();
        expect(createdSongStage(null, "26000099")).toBeNull();
        expect(createdSongStage(linked, "26000001")).toBeNull();
        expect(createdSongStage(notLinked, "26000001")).toBeNull();
    });

    test("is described for each stage", () => {
        expect(describeCreatedSong("Abba, Father", "linked")).toBe(
            'Created "Abba, Father" in Planning Center and linked this song to it.'
        );
        expect(describeCreatedSong("Abba, Father", "linking")).toBe(
            'Created "Abba, Father" in Planning Center. Linking this song to it\u2026'
        );
        expect(describeCreatedSong("Abba, Father", "not-linked")).toBe(
            'Created "Abba, Father" in Planning Center, but this song is not linked to it.'
        );
    });
});

describe("readNewPcoSongInput", () => {
    const input = {
        title: "Abba, Father",
        credits: [{ role: "Words", names: ["A"] }],
        copyright: "",
        ccliNumber: "22025",
        useCcliDetails: false,
    };

    test("takes the form's fields", () => {
        expect(readNewPcoSongInput(input)).toEqual(input);
        expect(readNewPcoSongInput({ ...input, extra: "left out" })).toEqual(input);
    });

    test("refuses anything that is not that shape", () => {
        for (const value of [
            null,
            undefined,
            "Abba, Father",
            [],
            { ...input, title: undefined },
            { ...input, title: 1 },
            { ...input, copyright: null },
            { ...input, ccliNumber: 22025 },
            { ...input, useCcliDetails: "true" },
            { ...input, credits: "Words: A" },
            { ...input, credits: [{ role: "Words", names: [1] }] },
        ]) {
            expect(readNewPcoSongInput(value)).toBeNull();
        }
    });
});
