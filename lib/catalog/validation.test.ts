import { describe, expect, test } from "vitest";
import { buildCatalogIndex, type IndexableSong } from "@/lib/reconcile";
import {
    EMPTY_NEW_SONG,
    MARK_NOTE_MAX_LENGTH,
    NOTES_MAX_LENGTH,
    VARIANT_NOTE_MAX_LENGTH,
    cleanText,
    draftFromPcoTitle,
    previewEntryLabel,
    defaultLabelFormat,
    labelFormatProblem,
    validateBookEdit,
    validateBookMove,
    validateEntryDelete,
    validateEntryEdit,
    validateEntryMove,
    validateHymnAlias,
    validateHymnEdit,
    validateMerge,
    validateNewBook,
    validateNewEntry,
    validateNewSong,
    validateSongMark,
    validateTuneAlias,
    validateTuneEdit,
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

describe("previewEntryLabel", () => {
    const rejoice = { numbered: true, labelFormat: "R-{n}" };
    const preview = (fields: Partial<NewSongValues>, book = rejoice) =>
        previewEntryLabel(book, { placement: "number", number: "", location: "", ...fields });

    test("labels a number, or a location, in a numbered book", () => {
        expect(preview({ number: " 396 " })).toBe("R-396");
        expect(preview({ placement: "location", location: " front  cover " })).toBe(
            "R-Front Cover"
        );
    });

    test("labels a book without numbers by its label format", () => {
        expect(preview({}, { numbered: false, labelFormat: "Chorus Book" })).toBe("Chorus Book");
    });

    test("is null until what is typed makes a label", () => {
        expect(preview({ number: "" })).toBeNull();
        expect(preview({ number: "12a" })).toBeNull();
        expect(preview({ number: "0" })).toBeNull();
        expect(preview({ number: "100000" })).toBeNull();
        expect(preview({ placement: "location", location: "  " })).toBeNull();
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

/** A form as posted: each field's text. */
function fields(values: Record<string, string>): FormData {
    const formData = new FormData();
    for (const [name, value] of Object.entries(values)) {
        formData.set(name, value);
    }
    return formData;
}

describe("validateSongMark", () => {
    test("reads the song, the mark and the note, cleaned", () => {
        expect(
            validateSongMark(fields({ songId: "12", mark: "to-learn", note: "  For   Advent " }))
        ).toEqual({ ok: true, input: { songId: 12, mark: "to-learn", note: "For Advent" } });
    });

    test("reads a blank or missing note as none", () => {
        expect(validateSongMark(fields({ songId: "12", mark: "to-learn", note: "  " }))).toEqual({
            ok: true,
            input: { songId: 12, mark: "to-learn", note: null },
        });
        expect(validateSongMark(fields({ songId: "12", mark: "to-learn" }))).toMatchObject({
            ok: true,
            input: { note: null },
        });
    });

    test("refuses a song id, mark or note that is not one, each on its part", () => {
        expect(
            validateSongMark(
                fields({ songId: "012", mark: "favourite", note: "x".repeat(MARK_NOTE_MAX_LENGTH + 1) })
            )
        ).toEqual({
            ok: false,
            fieldErrors: {
                song: { message: "That song is not in the catalog." },
                mark: { message: "That is not a mark the catalog knows." },
                note: { message: "A note has at most 200 characters." },
            },
        });
        expect(validateSongMark(fields({ mark: "to-learn" }))).toMatchObject({
            ok: false,
            fieldErrors: { song: expect.anything() },
        });
        expect(
            validateSongMark(fields({ songId: "1", mark: "to-learn", note: "x".repeat(MARK_NOTE_MAX_LENGTH) }))
        ).toMatchObject({ ok: true });
    });
});

describe("validateNewEntry", () => {
    test("reads a number in a book, with a variant note", () => {
        expect(
            validateNewEntry(
                fields({ songId: "5", bookId: "1", placement: "number", number: " 396 ", variantNote: " Descant " })
            )
        ).toEqual({
            ok: true,
            input: { songId: 5, bookId: 1, placement: { kind: "number", number: 396 }, variantNote: "Descant" },
        });
    });

    test("reads a location, the end and a position, and a blank variant note as none", () => {
        const base = { songId: "5", bookId: "1", variantNote: "  " };
        expect(validateNewEntry(fields({ ...base, placement: "location", location: " front  cover " }))).toEqual({
            ok: true,
            input: {
                songId: 5,
                bookId: 1,
                placement: { kind: "location", locationLabel: "front cover" },
                variantNote: null,
            },
        });
        expect(validateNewEntry(fields({ ...base, placement: "end", number: "abc" }))).toMatchObject({
            ok: true,
            input: { placement: { kind: "end" } },
        });
        expect(validateNewEntry(fields({ ...base, placement: "position", position: "3" }))).toMatchObject({
            ok: true,
            input: { placement: { kind: "position", position: 3 } },
        });
    });

    test("refuses what the placement needs when it is missing or not a whole number", () => {
        const base = { songId: "5", bookId: "1" };
        expect(validateNewEntry(fields({ ...base, placement: "number", number: "" }))).toEqual({
            ok: false,
            fieldErrors: { placement: { message: "Type the song's number, a whole number from 1 to 99,999." } },
        });
        expect(validateNewEntry(fields({ ...base, placement: "number", number: "1.5" }))).toMatchObject({
            ok: false,
            fieldErrors: { placement: expect.anything() },
        });
        expect(validateNewEntry(fields({ ...base, placement: "location", location: " " }))).toEqual({
            ok: false,
            fieldErrors: { placement: { message: "Type where the book has the song, such as front cover." } },
        });
        expect(validateNewEntry(fields({ ...base, placement: "position", position: "0" }))).toEqual({
            ok: false,
            fieldErrors: {
                placement: { message: "Type the song's position in the book, a whole number from 1 to 99,999." },
            },
        });
        expect(validateNewEntry(fields({ ...base, placement: "sideways" }))).toEqual({
            ok: false,
            fieldErrors: { placement: { message: "Choose where the book has the song." } },
        });
    });

    test("refuses ids that do not parse and a variant note that is too long, all at once", () => {
        expect(
            validateNewEntry(
                fields({
                    songId: "x",
                    bookId: "",
                    placement: "end",
                    variantNote: "x".repeat(VARIANT_NOTE_MAX_LENGTH + 1),
                })
            )
        ).toEqual({
            ok: false,
            fieldErrors: {
                song: { message: "That song is not in the catalog." },
                book: { message: "Choose a book from the list." },
                variantNote: { message: "A variant note has at most 100 characters." },
            },
        });
    });
});

describe("validateEntryEdit, validateEntryDelete and validateEntryMove", () => {
    test("read the entry and what changes", () => {
        expect(
            validateEntryEdit(fields({ entryId: "7", placement: "number", number: "12", variantNote: "" }))
        ).toEqual({
            ok: true,
            input: { entryId: 7, placement: { kind: "number", number: 12 }, variantNote: null },
        });
        expect(validateEntryDelete(fields({ entryId: "7" }))).toEqual({ ok: true, input: { entryId: 7 } });
        expect(validateEntryMove(fields({ entryId: "7", direction: "down" }))).toEqual({
            ok: true,
            input: { entryId: 7, direction: "down" },
        });
    });

    test("refuse an entry id that does not parse, and a direction that is not one", () => {
        expect(validateEntryEdit(fields({ entryId: "-1", placement: "end" }))).toEqual({
            ok: false,
            fieldErrors: { entry: { message: "That entry is not in the catalog." } },
        });
        expect(validateEntryDelete(fields({}))).toMatchObject({ ok: false, fieldErrors: { entry: expect.anything() } });
        expect(validateEntryMove(fields({ entryId: "7", direction: "sideways" }))).toEqual({
            ok: false,
            fieldErrors: { direction: { message: "Choose Move up or Move down." } },
        });
    });
});

describe("validateHymnEdit", () => {
    test("reads the title and first line cleaned, and the notes with their line breaks", () => {
        expect(
            validateHymnEdit(
                fields({
                    hymnId: "3",
                    title: "  Amazing   Grace ",
                    firstLine: " Amazing grace! how sweet the sound ",
                    notes: "  John Newton, 1779  \r\n\r\n  Stanza 6 by others \n\n",
                })
            )
        ).toEqual({
            ok: true,
            input: {
                hymnId: 3,
                title: "Amazing Grace",
                firstLine: "Amazing grace! how sweet the sound",
                notes: "John Newton, 1779\n\nStanza 6 by others",
            },
        });
    });

    test("reads a blank first line and blank notes as none", () => {
        expect(validateHymnEdit(fields({ hymnId: "3", title: "Doxology", firstLine: " ", notes: " \n " }))).toEqual({
            ok: true,
            input: { hymnId: 3, title: "Doxology", firstLine: null, notes: null },
        });
    });

    test("refuses a missing title, one with no letters or digits, and notes that are too long", () => {
        expect(
            validateHymnEdit(fields({ hymnId: "0", title: " ", notes: "x".repeat(NOTES_MAX_LENGTH + 1) }))
        ).toEqual({
            ok: false,
            fieldErrors: {
                hymn: { message: "That hymn is not in the catalog." },
                title: { message: "Type the hymn's title." },
                notes: { message: "Notes have at most 2,000 characters." },
            },
        });
        expect(validateHymnEdit(fields({ hymnId: "3", title: "?!" }))).toEqual({
            ok: false,
            fieldErrors: { title: { message: "A title needs letters or numbers." } },
        });
        expect(validateHymnEdit(fields({ hymnId: "3", title: "x".repeat(201) }))).toEqual({
            ok: false,
            fieldErrors: { title: { message: "A title has at most 200 characters." } },
        });
    });
});

describe("validateTuneEdit", () => {
    test("reads the name, meter and notes", () => {
        expect(validateTuneEdit(fields({ tuneId: "4", name: " ST.  ANNE ", meter: " C.M. ", notes: "" }))).toEqual({
            ok: true,
            input: { tuneId: 4, name: "ST. ANNE", meter: "C.M.", notes: null },
        });
    });

    test("refuses a missing name, and one or a meter that is too long", () => {
        expect(validateTuneEdit(fields({ tuneId: "4", name: "", meter: "8".repeat(51) }))).toEqual({
            ok: false,
            fieldErrors: {
                name: { message: "Type the tune's name." },
                meter: { message: "A meter has at most 50 characters." },
            },
        });
        expect(validateTuneEdit(fields({ tuneId: "4", name: "X".repeat(101) }))).toEqual({
            ok: false,
            fieldErrors: { name: { message: "A tune's name has at most 100 characters." } },
        });
    });
});

describe("validateHymnAlias and validateTuneAlias", () => {
    test("read the hymn or tune and the other name, cleaned", () => {
        expect(validateHymnAlias(fields({ hymnId: "3", alias: " Amazing Grace!  How Sweet " }))).toEqual({
            ok: true,
            input: { hymnId: 3, alias: "Amazing Grace! How Sweet" },
        });
        expect(validateTuneAlias(fields({ tuneId: "4", alias: " darwal " }))).toEqual({
            ok: true,
            input: { tuneId: 4, alias: "darwal" },
        });
    });

    test("refuse a missing other name, and an id that does not parse", () => {
        expect(validateHymnAlias(fields({ hymnId: "x", alias: "" }))).toEqual({
            ok: false,
            fieldErrors: {
                hymn: { message: "That hymn is not in the catalog." },
                alias: { message: "Type the other title." },
            },
        });
        expect(validateTuneAlias(fields({ tuneId: "4", alias: " " }))).toEqual({
            ok: false,
            fieldErrors: { alias: { message: "Type the other name." } },
        });
    });
});

describe("validateMerge", () => {
    test("reads the source and the target", () => {
        expect(validateMerge(fields({ sourceId: "3", targetId: "8" }), "hymn")).toEqual({
            ok: true,
            input: { sourceId: 3, targetId: 8 },
        });
        expect(validateMerge(fields({ sourceId: "3", targetId: "3" }), "tune")).toMatchObject({ ok: true });
    });

    test("refuses ids that do not parse, in the words of the kind", () => {
        expect(validateMerge(fields({ sourceId: "x", targetId: "" }), "tune")).toEqual({
            ok: false,
            fieldErrors: {
                source: { message: "That tune is not in the catalog." },
                target: { message: "Choose the tune to merge it into." },
            },
        });
    });
});

describe("the book forms", () => {
    test("default a numbered book's label to CODE-{n}, and an unnumbered one's to its short name", () => {
        expect(defaultLabelFormat("CB", true, "Choruses")).toBe("CB-{n}");
        expect(defaultLabelFormat("CB", false, "Choruses")).toBe("Choruses");
    });

    test("say what is wrong with a label format for the kind of book", () => {
        expect(labelFormatProblem("R-{n}", true)).toBeNull();
        expect(labelFormatProblem("Chorus Book", false)).toBeNull();
        expect(labelFormatProblem("Rejoice", true)).toBe(
            "A numbered book's label needs {n} where the number goes, such as R-{n}."
        );
        expect(labelFormatProblem("CB-{n}", false)).toBe(
            "A book without numbers labels every entry alike, so its label has no {n}: its short name, such as Chorus Book."
        );
    });

    test("read a new book, filling in the short name and label format left blank", () => {
        expect(
            validateNewBook(fields({ code: "CB", name: " Chorus  Book ", shortName: "", numbered: "no", labelFormat: "" }))
        ).toEqual({
            ok: true,
            input: { code: "CB", name: "Chorus Book", shortName: "Chorus Book", numbered: false, labelFormat: "Chorus Book" },
        });
        expect(
            validateNewBook(fields({ code: "hf", name: "Hymns of Faith", shortName: "Faith", numbered: "yes", labelFormat: "" }))
        ).toEqual({
            ok: true,
            input: { code: "hf", name: "Hymns of Faith", shortName: "Faith", numbered: true, labelFormat: "hf-{n}" },
        });
        expect(
            validateNewBook(fields({ code: "HF", name: "Hymns of Faith", numbered: "yes", labelFormat: " HF {n} " }))
        ).toMatchObject({ ok: true, input: { labelFormat: "HF {n}" } });
    });

    test("refuse a new book's bad code, blank name, unknown kind and label format, all at once", () => {
        expect(validateNewBook(fields({ code: "1CB", name: "", numbered: "maybe", labelFormat: "X" }))).toEqual({
            ok: false,
            fieldErrors: {
                code: { message: "A code is a letter, then up to 7 letters, digits, - or _, such as CB." },
                name: { message: "Type the book's name." },
                numbered: { message: "Choose whether the book numbers its songs." },
            },
        });
        expect(validateNewBook(fields({ code: "CB", name: "Chorus Book", numbered: "no", labelFormat: "CB-{n}" }))).toMatchObject({
            ok: false,
            fieldErrors: { labelFormat: { message: expect.stringContaining("has no {n}") } },
        });
        expect(
            validateNewBook(fields({ code: "CB", name: "x".repeat(101), shortName: "y".repeat(41), numbered: "no" }))
        ).toEqual({
            ok: false,
            fieldErrors: {
                name: { message: "A book's name has at most 100 characters." },
                shortName: { message: "A short name has at most 40 characters." },
            },
        });
    });

    test("read a book's edit, with blanks as none, and whether it is in use", () => {
        expect(
            validateBookEdit(fields({ bookId: "2", name: "Rejoice Hymns", shortName: " ", labelFormat: "", active: "no" }))
        ).toEqual({
            ok: true,
            input: { bookId: 2, name: "Rejoice Hymns", shortName: null, labelFormat: null, active: false },
        });
        expect(validateBookEdit(fields({ bookId: "2", name: "R", active: "" }))).toEqual({
            ok: false,
            fieldErrors: { active: { message: "Choose whether the book is in use." } },
        });
        expect(validateBookMove(fields({ bookId: "2", direction: "up" }))).toEqual({
            ok: true,
            input: { bookId: 2, direction: "up" },
        });
        expect(validateBookMove(fields({ bookId: "two", direction: "up" }))).toMatchObject({
            ok: false,
            fieldErrors: { book: { message: "That book is not in the catalog." } },
        });
    });
});
