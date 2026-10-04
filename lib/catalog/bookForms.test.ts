import { describe, expect, test } from "vitest";
import {
    BOOK_FIELD_PARTS,
    BOOK_SAVED_MESSAGE,
    EMPTY_NEW_BOOK,
    NOT_IN_USE_EXPLANATION,
    PREVIEW_ENTRY_NUMBER,
    bookEditValues,
    describeAddedBook,
    describeMove,
    labelFormatHint,
    previewBookLabel,
    type BookLabelFields,
} from "./bookForms";
import { BOOK_FIELDS, NEW_BOOK_FIELDS } from "./validation";

/** The fields of a numbered book, with what a test sets over them. */
function fields(over: Partial<BookLabelFields> = {}): BookLabelFields {
    return { code: "CB", name: "Chorus Book", shortName: "", labelFormat: "", numbered: true, ...over };
}

describe("the forms' starting values", () => {
    test("the Add form starts empty, as a numbered book, with a value for every field it posts", () => {
        expect(Object.keys(EMPTY_NEW_BOOK).sort()).toEqual([...NEW_BOOK_FIELDS].sort());
        expect(EMPTY_NEW_BOOK).toEqual({
            code: "",
            name: "",
            shortName: "",
            numbered: "yes",
            labelFormat: "",
        });
    });

    test("the Edit form starts with the book as stored, in text, for every field it posts", () => {
        const values = bookEditValues({
            id: 3,
            name: "Chorus Book",
            shortName: "Choruses",
            labelFormat: "Choruses",
            active: false,
        });

        expect(Object.keys(values).sort()).toEqual([...BOOK_FIELDS].sort());
        expect(values).toEqual({
            bookId: "3",
            name: "Chorus Book",
            shortName: "Choruses",
            labelFormat: "Choruses",
            active: "no",
        });
        expect(
            bookEditValues({ id: 1, name: "R", shortName: "R", labelFormat: "R-{n}", active: true }).active
        ).toBe("yes");
    });
});

describe("previewBookLabel", () => {
    test("a numbered book's default label is its code and a sample number", () => {
        expect(previewBookLabel(fields())).toEqual({
            kind: "label",
            lead: `An entry numbered ${PREVIEW_ENTRY_NUMBER} is labelled`,
            label: "CB-396",
        });
    });

    test("a typed label format wins over the default, and keeps its own prefix", () => {
        expect(previewBookLabel(fields({ labelFormat: "Ch {n}" }))).toMatchObject({ label: "Ch 396" });
        expect(previewBookLabel(fields({ labelFormat: "{n}{n}" }))).toMatchObject({ label: "396396" });
    });

    test("a book without numbers labels every entry with its short name, or its name without one", () => {
        expect(previewBookLabel(fields({ numbered: false, shortName: "Choruses" }))).toEqual({
            kind: "label",
            lead: "Every entry is labelled",
            label: "Choruses",
        });
        expect(previewBookLabel(fields({ numbered: false }))).toMatchObject({ label: "Chorus Book" });
        expect(previewBookLabel(fields({ numbered: false, labelFormat: "CB" }))).toMatchObject({ label: "CB" });
    });

    test("cleans what was typed, as the form's reader does", () => {
        expect(previewBookLabel(fields({ numbered: false, shortName: "  Gospel   Songs " }))).toMatchObject({
            label: "Gospel Songs",
        });
        expect(previewBookLabel(fields({ code: " CB ", labelFormat: "  Ch   {n} " }))).toMatchObject({
            label: "Ch 396",
        });
    });

    test("says what is wrong with a label format that does not suit the book, in the preview's place", () => {
        expect(previewBookLabel(fields({ labelFormat: "Chorus" }))).toEqual({
            kind: "problem",
            message: "A numbered book's label needs {n} where the number goes, such as R-{n}.",
        });
        expect(previewBookLabel(fields({ numbered: false, labelFormat: "CB-{n}" }))).toMatchObject({
            kind: "problem",
        });
    });

    test("has nothing to preview before there is something to build a label from", () => {
        // A numbered book's default needs its code.
        expect(previewBookLabel(fields({ code: "" }))).toBeNull();
        expect(previewBookLabel(fields({ code: "  " }))).toBeNull();
        // A book without numbers needs a name or a label.
        expect(previewBookLabel(fields({ name: "", numbered: false }))).toBeNull();
        // A typed label format needs no code.
        expect(previewBookLabel(fields({ code: "", labelFormat: "Ch {n}" }))).toMatchObject({
            label: "Ch 396",
        });
    });
});

describe("labelFormatHint", () => {
    test("a numbered book's names where the number goes, and the default, with the code typed so far", () => {
        expect(labelFormatHint(true, "CB")).toBe("Write {n} where the number goes, as in R-{n}. Leave blank for CB-{n}.");
        expect(labelFormatHint(true, " CB ")).toContain("Leave blank for CB-{n}.");
        expect(labelFormatHint(true, "")).toContain("Leave blank for the code-{n}.");
    });

    test("a book without numbers says every entry is labelled alike, and the default", () => {
        const hint = labelFormatHint(false, "CB");

        expect(hint).toContain("labels every entry alike");
        expect(hint).toContain("Leave blank for the short name.");
        expect(hint).not.toContain("{n}");
    });
});

describe("what a book that is not in use does", () => {
    test("the form's hint says what it leaves out, and that it stays browsable", () => {
        expect(NOT_IN_USE_EXPLANATION).toContain("browsable");
        expect(NOT_IN_USE_EXPLANATION).toContain("schedule text");
        expect(NOT_IN_USE_EXPLANATION).toContain("hymnal notes");
        expect(NOT_IN_USE_EXPLANATION).toContain("book filter");
    });
});

describe("BOOK_FIELD_PARTS", () => {
    test("is every part of the book forms but the hidden book id, which has no field to mark", () => {
        expect([...BOOK_FIELD_PARTS].sort()).toEqual(
            ["active", "code", "labelFormat", "name", "numbered", "shortName"].sort()
        );
        expect(BOOK_FIELD_PARTS).not.toContain("book");
    });
});

describe("the words after a change", () => {
    test("an added book is named with its code", () => {
        expect(describeAddedBook({ code: "CB", name: "Chorus Book" })).toBe("Added Chorus Book (CB).");
        expect(BOOK_SAVED_MESSAGE).toBe("Saved.");
    });

    test("a moved book says where it is now", () => {
        expect(describeMove("Great Hymns", "up", { changed: true, place: 1 }, "book")).toBe(
            "Moved Great Hymns up. It is now number 1 in the list."
        );
    });

    test("a moved entry says its position", () => {
        expect(describeMove("Amazing Grace", "down", { changed: true, place: 4 }, "entry")).toBe(
            "Moved Amazing Grace down. It is now at position 4."
        );
    });

    test("a move at the edge says so, for either direction", () => {
        expect(describeMove("Rejoice Hymns", "up", { changed: false, place: 1 }, "book")).toBe(
            "Rejoice Hymns is already first."
        );
        expect(describeMove("Rejoice Hymns", "down", { changed: false, place: 2 }, "book")).toBe(
            "Rejoice Hymns is already last."
        );
    });
});
