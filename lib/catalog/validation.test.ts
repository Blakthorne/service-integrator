import { describe, expect, test } from "vitest";
import { buildCatalogIndex, type IndexableSong } from "@/lib/reconcile";
import {
    EMPTY_NEW_SONG,
    cleanText,
    draftFromPcoTitle,
    validateNewSong,
    type NewSongBook,
    type NewSongValues,
} from "./validation";

const REJOICE: NewSongBook = { id: 1, name: "Rejoice Hymns", numbered: true };
const GREAT: NewSongBook = { id: 2, name: "Great Hymns of the Faith", numbered: true };
const CHORUS: NewSongBook = { id: 3, name: "Chorus Book", numbered: false };
const BOOKS = [REJOICE, GREAT, CHORUS];

/** The form as posted: the empty form with these fields changed. */
function posted(fields: Partial<NewSongValues> = {}): FormData {
    const formData = new FormData();
    for (const [name, value] of Object.entries({ ...EMPTY_NEW_SONG.values, ...fields })) {
        formData.set(name, value);
    }
    return formData;
}

/** A valid form: a new hymn, no tune, no entry, with these fields changed. */
function form(fields: Partial<NewSongValues> = {}): FormData {
    return posted({ hymnTitle: "Shout to the Lord", ...fields });
}

describe("cleanText", () => {
    test("trims, and makes each run of white space one space", () => {
        expect(cleanText("  Amazing \t Grace\n")).toBe("Amazing Grace");
    });
});

describe("validateNewSong", () => {
    test("takes a new hymn with no tune and no entry", () => {
        expect(validateNewSong(form({ hymnTitle: "  Shout  to the Lord " }), BOOKS)).toEqual({
            ok: true,
            input: {
                hymn: { kind: "new", title: "Shout to the Lord" },
                tune: { kind: "none" },
                entry: null,
            },
        });
    });

    test("takes a hymn and a tune from the catalog, and a number in a numbered book", () => {
        expect(
            validateNewSong(
                form({
                    hymn: "existing",
                    hymnId: "12",
                    tune: "existing",
                    tuneId: "40",
                    bookId: "1",
                    placement: "number",
                    number: " 396 ",
                }),
                BOOKS
            )
        ).toEqual({
            ok: true,
            input: {
                hymn: { kind: "existing", hymnId: 12 },
                tune: { kind: "existing", tuneId: 40 },
                entry: { kind: "number", bookId: 1, number: 396 },
            },
        });
    });

    test("takes a new tune's name, cleaned", () => {
        expect(validateNewSong(form({ tune: "new", tuneName: " SLANE  " }), BOOKS)).toMatchObject({
            ok: true,
            input: { tune: { kind: "new", name: "SLANE" } },
        });
    });

    test("takes a location in a numbered book, such as the front cover", () => {
        expect(
            validateNewSong(
                form({ bookId: "2", placement: "location", location: " front  cover " }),
                BOOKS
            )
        ).toMatchObject({
            ok: true,
            input: { entry: { kind: "location", bookId: 2, locationLabel: "front cover" } },
        });
    });

    test("puts an entry at the end of a book without numbers, ignoring a number or location", () => {
        expect(
            validateNewSong(
                form({ bookId: "3", placement: "number", number: "abc", location: "x" }),
                BOOKS
            )
        ).toMatchObject({ ok: true, input: { entry: { kind: "end", bookId: 3 } } });
    });

    test("ignores the entry's fields when there is no book", () => {
        expect(
            validateNewSong(form({ bookId: "", placement: "nonsense", number: "abc" }), BOOKS)
        ).toMatchObject({ ok: true, input: { entry: null } });
    });

    test("ignores the fields of the modes not chosen", () => {
        expect(
            validateNewSong(
                form({ hymnId: "abc", tune: "none", tuneId: "abc", tuneName: "x".repeat(500) }),
                BOOKS
            )
        ).toMatchObject({ ok: true });
    });

    test.each([
        ["no hymn chosen", { hymn: "existing", hymnId: "" }, "Choose a hymn from the list."],
        ["a hymn id that is not one", { hymn: "existing", hymnId: "01" }, "Choose a hymn from the list."],
        ["a blank title", { hymn: "new", hymnTitle: "   " }, "Type the new hymn's title."],
        ["a title of punctuation only", { hymn: "new", hymnTitle: "?!" }, "A title needs letters or numbers."],
        ["a title too long", { hymn: "new", hymnTitle: "a".repeat(201) }, "A title has at most 200 characters."],
        ["a mode the form does not offer", { hymn: "both" }, "Choose a hymn from the list, or type a new title."],
    ])("refuses %s, as the hymn's error", (_name, fields, message) => {
        expect(validateNewSong(form(fields), BOOKS)).toEqual({
            ok: false,
            fieldErrors: { hymn: { message } },
        });
    });

    test("takes a title of the longest length", () => {
        expect(validateNewSong(form({ hymnTitle: "a".repeat(200) }), BOOKS)).toMatchObject({
            ok: true,
        });
    });

    test.each([
        ["no tune chosen", { tune: "existing", tuneId: "" }, "Choose a tune from the list."],
        ["a blank name", { tune: "new", tuneName: " " }, "Type the new tune's name."],
        ["a name too long", { tune: "new", tuneName: "A".repeat(101) }, "A tune's name has at most 100 characters."],
        ["a mode the form does not offer", { tune: "" }, "Choose a tune from the list, type a new one, or choose None."],
    ])("refuses %s, as the tune's error", (_name, fields, message) => {
        expect(validateNewSong(form(fields), BOOKS)).toEqual({
            ok: false,
            fieldErrors: { tune: { message } },
        });
    });

    test.each([
        ["a book the catalog does not have", { bookId: "9" }, "Choose a book from the list, or No book."],
        ["a book id that is not one", { bookId: "R" }, "Choose a book from the list, or No book."],
        ["a numbered book without a number", { bookId: "1", number: "" }, "Type the song's number in Rejoice Hymns."],
        ["a number that is not one", { bookId: "1", number: "12a" }, "A number is a whole number from 1 to 99,999."],
        ["a number of zero", { bookId: "1", number: "0" }, "A number is a whole number from 1 to 99,999."],
        ["a number too high", { bookId: "1", number: "100000" }, "A number is a whole number from 1 to 99,999."],
        ["a blank location", { bookId: "2", placement: "location", location: " " }, "Type where Great Hymns of the Faith has the song, such as front cover."],
        ["a location too long", { bookId: "2", placement: "location", location: "x".repeat(51) }, "A location has at most 50 characters."],
        ["a placement the form does not offer", { bookId: "1", placement: "page" }, "Choose a number or a location."],
    ])("refuses %s, as the entry's error", (_name, fields, message) => {
        expect(validateNewSong(form(fields), BOOKS)).toEqual({
            ok: false,
            fieldErrors: { entry: { message } },
        });
    });

    test("reports every part with a problem at once", () => {
        expect(
            validateNewSong(
                posted({ hymn: "new", hymnTitle: "", tune: "existing", tuneId: "", bookId: "1" }),
                BOOKS
            )
        ).toEqual({
            ok: false,
            fieldErrors: {
                hymn: { message: "Type the new hymn's title." },
                tune: { message: "Choose a tune from the list." },
                entry: { message: "Type the song's number in Rejoice Hymns." },
            },
        });
    });

    test("refuses a form that posts nothing", () => {
        expect(validateNewSong(new FormData(), BOOKS)).toMatchObject({
            ok: false,
            fieldErrors: {
                hymn: { message: "Choose a hymn from the list, or type a new title." },
                tune: { message: "Choose a tune from the list, type a new one, or choose None." },
            },
        });
    });
});

/** A catalog song for the index: its hymn and tune as [id, name], with aliases. */
function song(
    id: number,
    [hymnId, title]: [number, string],
    tune: [number, string] | null,
    { aliases = [], tuneAliases = [] }: { aliases?: string[]; tuneAliases?: string[] } = {}
): IndexableSong {
    return {
        id,
        hymnId,
        title,
        aliases,
        tuneId: tune?.[0] ?? null,
        tuneName: tune?.[1] ?? null,
        tuneAliases,
        pcoSongId: null,
        entries: [],
    };
}

const INDEX = buildCatalogIndex([
    song(1, [1, "Amazing Grace"], [1, "NEW BRITAIN"]),
    song(2, [2, "Abba, Father"], [2, "ABBA, FATHER"]),
    song(3, [2, "Abba, Father"], [3, "PRITCHARD"]),
    song(4, [3, "Rejoice, the Lord Is King"], [4, "DARWALL"], {
        aliases: ["Rejoice - the Lord Is King!"],
        tuneAliases: ["DARWAL"],
    }),
    song(5, [4, "Holy, Holy, Holy"], [5, "NICAEA"]),
    song(6, [5, "Holy, Holy, Holy"], null),
    song(7, [6, "America the Beautiful"], [6, "MATERNA"]),
    song(8, [7, "Doxology"], [7, "OLD HUNDREDTH"]),
    song(9, [8, "All People That on Earth Do Dwell"], [7, "OLD HUNDREDTH"]),
    song(10, [9, "Glory Be to the Father"], [9, "GLORIA PATRI"]),
    song(11, [10, "Gloria Patri"], [10, "GLORIA PATRI"]),
]);

describe("draftFromPcoTitle", () => {
    test("picks the hymn the title names", () => {
        expect(draftFromPcoTitle("Amazing Grace", INDEX)).toEqual({
            values: { ...EMPTY_NEW_SONG.values, hymn: "existing", hymnId: "1" },
            hymnSearch: "",
            tuneSearch: "",
        });
    });

    test("picks a hymn by another of its titles", () => {
        expect(draftFromPcoTitle("Rejoice - the Lord Is King!", INDEX).values).toMatchObject({
            hymn: "existing",
            hymnId: "3",
        });
    });

    test("fills the tune a trailing parenthetical names, by name or other name, and picks the hymn before it", () => {
        expect(draftFromPcoTitle("Abba, Father (PRITCHARD)", INDEX).values).toMatchObject({
            hymn: "existing",
            hymnId: "2",
            tune: "existing",
            tuneId: "3",
        });
        expect(draftFromPcoTitle("Rejoice, the Lord Is King (Darwal)", INDEX).values).toMatchObject({
            hymn: "existing",
            hymnId: "3",
            tune: "existing",
            tuneId: "4",
        });
    });

    test("fills a tune the catalog has for a new hymn", () => {
        expect(draftFromPcoTitle("Praise Ye the Lord (OLD HUNDREDTH)", INDEX)).toEqual({
            values: {
                ...EMPTY_NEW_SONG.values,
                hymn: "new",
                hymnTitle: "Praise Ye the Lord",
                tune: "existing",
                tuneId: "7",
            },
            hymnSearch: "",
            tuneSearch: "",
        });
    });

    test("makes a parenthetical in capitals that names no tune a new tune", () => {
        expect(draftFromPcoTitle("Be Thou My Vision  (SLANE)", INDEX)).toEqual({
            values: {
                ...EMPTY_NEW_SONG.values,
                hymn: "new",
                hymnTitle: "Be Thou My Vision",
                tune: "new",
                tuneName: "SLANE",
            },
            hymnSearch: "",
            tuneSearch: "",
        });
        expect(draftFromPcoTitle("Amazing Grace (Descant) (AZMON)", INDEX).values).toMatchObject({
            hymn: "existing",
            hymnId: "1",
            tune: "new",
            tuneName: "AZMON",
        });
    });

    test("keeps any other parenthetical in a new hymn's title, and leaves the tune at None", () => {
        expect(draftFromPcoTitle("Shout to the Lord (Acoustic)", INDEX).values).toMatchObject({
            hymn: "new",
            hymnTitle: "Shout to the Lord (Acoustic)",
            tune: "none",
            tuneName: "",
        });
    });

    test("picks the hymn before a parenthetical that names no tune", () => {
        expect(draftFromPcoTitle("America the Beautiful (Descant)", INDEX).values).toMatchObject({
            hymn: "existing",
            hymnId: "6",
            tune: "none",
        });
    });

    test("searches for a title several hymns share instead of picking one", () => {
        expect(draftFromPcoTitle("Holy, Holy, Holy (NICAEA)", INDEX)).toEqual({
            values: {
                ...EMPTY_NEW_SONG.values,
                hymn: "existing",
                hymnId: "",
                tune: "existing",
                tuneId: "5",
            },
            hymnSearch: "Holy, Holy, Holy",
            tuneSearch: "",
        });
    });

    test("searches for a tune name several tunes share instead of picking one", () => {
        expect(draftFromPcoTitle("Glory Be (GLORIA PATRI)", INDEX)).toEqual({
            values: {
                ...EMPTY_NEW_SONG.values,
                hymn: "new",
                hymnTitle: "Glory Be",
                tune: "existing",
                tuneId: "",
            },
            hymnSearch: "",
            tuneSearch: "GLORIA PATRI",
        });
    });

    test("starts a new hymn with the title when the catalog has nothing like it", () => {
        expect(draftFromPcoTitle("  Shout to the   Lord ", INDEX)).toEqual({
            values: { ...EMPTY_NEW_SONG.values, hymn: "new", hymnTitle: "Shout to the Lord" },
            hymnSearch: "",
            tuneSearch: "",
        });
    });

    test("works on an empty catalog", () => {
        expect(draftFromPcoTitle("Abba, Father (PRITCHARD)", buildCatalogIndex([])).values).toMatchObject({
            hymn: "new",
            hymnTitle: "Abba, Father",
            tune: "new",
            tuneName: "PRITCHARD",
        });
    });
});
