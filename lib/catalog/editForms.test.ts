import { describe, expect, test } from "vitest";
import {
    FIX_MARKED_FIELDS_MESSAGE,
    describeAliasAdded,
    describeAliasRemoved,
    describeMarked,
    describeNameSaved,
    describeUnmarked,
    editRefusal,
    formRefusal,
    linkToCatalogRow,
} from "./editForms";

describe("linkToCatalogRow", () => {
    test("links a song, a tune and a book to their pages", () => {
        expect(linkToCatalogRow({ kind: "song", songId: 42, label: "Amazing Grace (NEW BRITAIN)" })).toEqual({
            href: "/catalog/songs/42",
            label: "Amazing Grace (NEW BRITAIN)",
        });
        expect(linkToCatalogRow({ kind: "tune", tuneId: 7, label: "DARWALL" })).toEqual({
            href: "/catalog/tunes/7",
            label: "DARWALL",
        });
        expect(linkToCatalogRow({ kind: "book", code: "CB", label: "Chorus Book" })).toEqual({
            href: "/catalog/books/CB",
            label: "Chorus Book",
        });
    });
});

describe("formRefusal", () => {
    test("marks the fields, and asks for them to be fixed", () => {
        expect(
            formRefusal({ placement: { message: "Type the number." } }, ["placement", "variantNote"])
        ).toEqual({
            message: FIX_MARKED_FIELDS_MESSAGE,
            fieldErrors: { placement: { message: "Type the number." } },
        });
    });

    test("says an error about a hidden id as the form's message, and still marks the fields", () => {
        expect(
            formRefusal<"entry" | "placement" | "variantNote">(
                {
                    entry: { message: "That entry is not in the catalog." },
                    variantNote: { message: "A variant note has at most 100 characters." },
                },
                ["placement", "variantNote"]
            )
        ).toEqual({
            message: "That entry is not in the catalog.",
            fieldErrors: { variantNote: { message: "A variant note has at most 100 characters." } },
        });
    });
});

describe("editRefusal", () => {
    test("keeps each part's first problem, with a link to what it clashes with", () => {
        expect(
            editRefusal(
                [
                    {
                        reason: "number-taken",
                        part: "placement",
                        message: 'R-396 is taken by "Holy, Holy, Holy (NICAEA)".',
                        existing: { kind: "song", songId: 9, label: "Holy, Holy, Holy (NICAEA)" },
                    },
                    { reason: "entry-not-placed", part: "placement", message: "Not this one.", existing: null },
                    {
                        reason: "song-already-in-book",
                        part: "variantNote",
                        message: "This song is already in Rejoice Hymns as R-12.",
                        existing: null,
                    },
                ],
                ["placement", "variantNote"]
            )
        ).toEqual({
            message: FIX_MARKED_FIELDS_MESSAGE,
            fieldErrors: {
                placement: {
                    message: 'R-396 is taken by "Holy, Holy, Holy (NICAEA)".',
                    link: { href: "/catalog/songs/9", label: "Holy, Holy, Holy (NICAEA)" },
                },
                variantNote: { message: "This song is already in Rejoice Hymns as R-12." },
            },
        });
    });

    test("says a row that is gone as the form's message", () => {
        expect(
            editRefusal(
                [{ reason: "entry-not-found", part: "entry", message: "That entry is not in the catalog.", existing: null }],
                ["placement", "variantNote"]
            )
        ).toEqual({ message: "That entry is not in the catalog.", fieldErrors: {} });
    });
});

describe("describeNameSaved", () => {
    test("says Saved., and what the rename did to the other names", () => {
        expect(describeNameSaved("hymn", { aliasKept: null, aliasDropped: null })).toBe("Saved.");
        expect(describeNameSaved("hymn", { aliasKept: "Amazing Grace!", aliasDropped: "Amazing Grace" })).toBe(
            'Saved. "Amazing Grace!" stays as another title, since a Planning Center song is still titled so. "Amazing Grace" is no longer another title: it is the title now.'
        );
        expect(describeNameSaved("tune", { aliasKept: "DARWAL", aliasDropped: "DARWALL" })).toBe(
            "Saved. DARWAL stays as another name, since a Planning Center song's title still names it. DARWALL is no longer another name: it is the name now."
        );
    });
});

describe("other names", () => {
    test("quotes a hymn's title and not a tune's name", () => {
        expect(describeAliasAdded("hymn", "Rejoice! The Lord Is King")).toBe(
            'Added "Rejoice! The Lord Is King" as another title.'
        );
        expect(describeAliasAdded("tune", "DARWAL")).toBe("Added DARWAL as another name.");
        expect(describeAliasRemoved("hymn", "Rejoice! The Lord Is King")).toBe('Removed "Rejoice! The Lord Is King".');
        expect(describeAliasRemoved("tune", "DARWAL")).toBe("Removed DARWAL.");
    });
});

describe("marks", () => {
    test("says what the song is marked now, with its note", () => {
        expect(describeMarked("to-learn", true, null)).toBe("Marked to learn.");
        expect(describeMarked("to-learn", true, "For Advent")).toBe('Marked to learn, with the note "For Advent".');
        expect(describeMarked("to-learn", false, "For Advent")).toBe(
            "Nothing changed: the song was marked to learn with this note already."
        );
    });

    test("says the mark is gone, or was not there", () => {
        expect(describeUnmarked("to-learn", true)).toBe("No longer marked to learn.");
        expect(describeUnmarked("to-learn", false)).toBe("The song was not marked to learn.");
    });
});
