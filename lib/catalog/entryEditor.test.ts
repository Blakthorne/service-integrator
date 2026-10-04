import { describe, expect, test } from "vitest";
import type { LabelledEntry } from "@/lib/domain";
import {
    deleteEntryQuestion,
    describeEntryAdded,
    describeEntryDeleted,
    describeEntryMove,
    describeEntryPosition,
    describeEntrySaved,
    editEntryValues,
    entryAfterRemoval,
    entryFormLabel,
    entryMoves,
    newEntryValues,
    twinEntry,
    twinEntryLink,
} from "./entryEditor";

const REJOICE = { id: 1, code: "R", name: "Rejoice Hymns", numbered: true, labelFormat: "R-{n}", entryCount: 700 };
const CHORUS = { id: 3, code: "CB", name: "Chorus Book", numbered: false, labelFormat: "Chorus Book", entryCount: 12 };

function entry(fields: Partial<LabelledEntry> & Pick<LabelledEntry, "id" | "bookId">): LabelledEntry {
    return {
        songId: 42,
        number: null,
        position: null,
        locationLabel: null,
        variantNote: null,
        bookCode: "R",
        label: "R-?",
        ...fields,
    };
}

describe("the forms' first values", () => {
    test("a new entry takes a number in a numbered book, and goes at the end of one without", () => {
        expect(newEntryValues(REJOICE)).toEqual({
            placement: "number",
            number: "",
            location: "",
            position: "",
            variantNote: "",
        });
        expect(newEntryValues(CHORUS).placement).toBe("end");
    });

    test("an entry's Edit form starts from its number, location or position, and its variant note", () => {
        expect(editEntryValues({ number: 396, position: null, locationLabel: null, variantNote: "Descant" }, REJOICE)).toEqual({
            placement: "number",
            number: "396",
            location: "",
            position: "",
            variantNote: "Descant",
        });
        expect(
            editEntryValues({ number: null, position: null, locationLabel: "front cover", variantNote: null }, REJOICE)
        ).toMatchObject({ placement: "location", location: "front cover", variantNote: "" });
        expect(editEntryValues({ number: null, position: 3, locationLabel: null, variantNote: null }, CHORUS)).toMatchObject({
            placement: "position",
            position: "3",
        });
    });
});

describe("entryFormLabel", () => {
    test("previews the label the fields make, or none while they make none", () => {
        expect(entryFormLabel(REJOICE, { placement: "number", number: " 396 ", location: "" })).toBe("R-396");
        expect(entryFormLabel(REJOICE, { placement: "number", number: "abc", location: "" })).toBeNull();
        expect(entryFormLabel(REJOICE, { placement: "location", number: "", location: "front cover" })).toBe(
            "R-Front Cover"
        );
        expect(entryFormLabel(CHORUS, { placement: "end", number: "", location: "" })).toBe("Chorus Book");
    });
});

describe("an unnumbered book's order", () => {
    test("says where an entry stands, only in a book without numbers", () => {
        expect(describeEntryPosition({ position: 3 }, CHORUS)).toBe("position 3 of 12");
        expect(describeEntryPosition({ position: null }, REJOICE)).toBeNull();
    });

    test("moves an entry up unless it is first, and down unless it is last", () => {
        expect(entryMoves({ position: 1 }, CHORUS)).toEqual({ up: false, down: true });
        expect(entryMoves({ position: 5 }, CHORUS)).toEqual({ up: true, down: true });
        expect(entryMoves({ position: 12 }, CHORUS)).toEqual({ up: true, down: false });
        expect(entryMoves({ position: null }, REJOICE)).toEqual({ up: false, down: false });
    });

    test("says where a moved entry is now, or that it was at the edge", () => {
        expect(describeEntryMove("up", { changed: true, position: 2 }, CHORUS)).toBe("Moved up: now 2 of 12 in Chorus Book.");
        expect(describeEntryMove("up", { changed: false, position: 1 }, CHORUS)).toBe("Already first in Chorus Book.");
        expect(describeEntryMove("down", { changed: false, position: 12 }, CHORUS)).toBe("Already last in Chorus Book.");
    });
});

describe("what the card says", () => {
    test("names the entry by its label in a numbered book, and by its book in one without", () => {
        expect(describeEntryAdded("R-396", REJOICE)).toBe("Added R-396.");
        expect(describeEntryAdded("Chorus Book", CHORUS)).toBe("Added to the end of Chorus Book.");
        expect(describeEntrySaved("R-397", REJOICE)).toBe("Saved R-397.");
        expect(describeEntrySaved("Chorus Book", CHORUS)).toBe("Saved the entry in Chorus Book.");
        expect(describeEntryDeleted("R-396", REJOICE)).toBe("Deleted R-396.");
        expect(describeEntryDeleted("Chorus Book", CHORUS)).toBe("Deleted the entry in Chorus Book.");
    });

    test("asks before a delete, saying what follows in a book without numbers", () => {
        expect(deleteEntryQuestion({ label: "R-396", variantNote: "Descant" }, REJOICE)).toEqual({
            title: "Delete R-396 (Descant)?",
            description: "The song stays in the catalog, with its other entries.",
        });
        expect(deleteEntryQuestion({ label: "Chorus Book", variantNote: null }, CHORUS)).toEqual({
            title: "Delete the entry in Chorus Book?",
            description:
                "The song stays in the catalog, with its other entries. The entries after it in Chorus Book move up one.",
        });
    });
});

describe("twinEntry", () => {
    const entries = [
        entry({ id: 1, bookId: 1, number: 396, label: "R-396" }),
        entry({ id: 2, bookId: 1, number: 397, label: "R-397", variantNote: "Descant" }),
        entry({ id: 3, bookId: 3, position: 4, bookCode: "CB", label: "Chorus Book" }),
    ];

    test("finds the song's entry in the book with the same variant note, or with none", () => {
        expect(twinEntry(entries, 1, null, null)?.id).toBe(1);
        expect(twinEntry(entries, 1, "Descant", null)?.id).toBe(2);
        expect(twinEntry(entries, 1, "Round", null)).toBeUndefined();
        expect(twinEntry(entries, 3, null, null)?.id).toBe(3);
    });

    test("never finds the entry being edited", () => {
        expect(twinEntry(entries, 1, null, 1)).toBeUndefined();
    });

    test("links to the twin's book, named by its label", () => {
        expect(twinEntryLink(entries[0])).toEqual({ href: "/catalog/books/R", label: "R-396" });
        expect(twinEntryLink(entries[2])).toEqual({ href: "/catalog/books/CB", label: "Chorus Book" });
    });
});

describe("entryAfterRemoval", () => {
    test("is the next entry, else the one before, else none", () => {
        expect(entryAfterRemoval([1, 2, 3], 2)).toBe(3);
        expect(entryAfterRemoval([1, 2, 3], 3)).toBe(2);
        expect(entryAfterRemoval([1], 1)).toBeNull();
        expect(entryAfterRemoval([1, 2], 9)).toBeNull();
    });
});
