import { describe, expect, test } from "vitest";
import { formatEntryLabel } from "./labels";
import { entryNotes } from "./entryNotes";

const numbered = { numbered: true, labelFormat: "G-{n}" };
const unnumbered = { numbered: false, labelFormat: "Chorus Book" };

const plain = { number: 317, locationLabel: null, variantNote: null };

describe("entryNotes", () => {
    test("a plain numbered entry has none", () => {
        expect(entryNotes(numbered, plain)).toEqual([]);
    });

    test("shows the variant note", () => {
        expect(
            entryNotes(numbered, { ...plain, variantNote: "Descant - last stanza only" })
        ).toEqual(["Descant - last stanza only"]);
    });

    test("does not repeat a location the label already shows", () => {
        const frontCover = { number: null, locationLabel: "front cover", variantNote: null };
        expect(formatEntryLabel(numbered, frontCover)).toBe("G-Front Cover");
        expect(entryNotes(numbered, frontCover)).toEqual([]);
    });

    test("shows the location of a numbered entry, whose label shows the number", () => {
        expect(
            entryNotes(numbered, { ...plain, locationLabel: "inside back cover" })
        ).toEqual(["inside back cover"]);
    });

    test("shows the location in an unnumbered book, whose label is its short name", () => {
        const entry = { number: null, locationLabel: "inside back cover", variantNote: null };
        expect(formatEntryLabel(unnumbered, entry)).toBe("Chorus Book");
        expect(entryNotes(unnumbered, entry)).toEqual(["inside back cover"]);
    });

    test("puts the variant note before the location", () => {
        expect(
            entryNotes(unnumbered, {
                number: null,
                locationLabel: "inside back cover",
                variantNote: "A Round",
            })
        ).toEqual(["A Round", "inside back cover"]);
    });

    test("leaves out blank notes and trims the rest", () => {
        expect(
            entryNotes(unnumbered, { number: null, locationLabel: "  ", variantNote: " " })
        ).toEqual([]);
        expect(
            entryNotes(unnumbered, {
                number: null,
                locationLabel: " inside back cover ",
                variantNote: " A Round ",
            })
        ).toEqual(["A Round", "inside back cover"]);
    });
});
