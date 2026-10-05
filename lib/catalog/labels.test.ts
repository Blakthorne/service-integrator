import { describe, expect, test } from "vitest";
import { formatEntryLabel } from "./labels";

const rejoice = { numbered: true, labelFormat: "R-{n}" };
const great = { numbered: true, labelFormat: "G-{n}" };
const choruses = { numbered: false, labelFormat: "Chorus Book" };

function entry(number: number | null, locationLabel: string | null = null) {
    return { number, locationLabel };
}

describe("formatEntryLabel", () => {
    test("puts the number in a numbered book's format", () => {
        expect(formatEntryLabel(rejoice, entry(396))).toBe("R-396");
        expect(formatEntryLabel(great, entry(1))).toBe("G-1");
    });

    test("puts the location, title-cased, where an entry has no number", () => {
        expect(formatEntryLabel(great, entry(null, "front cover"))).toBe(
            "G-Front Cover"
        );
        expect(formatEntryLabel(great, entry(null, "inside back  cover"))).toBe(
            "G-Inside Back  Cover"
        );
        expect(formatEntryLabel(great, entry(null, " title page "))).toBe(
            "G-Title Page"
        );
    });

    test("keeps the rest of each word of the location as it is", () => {
        expect(formatEntryLabel(great, entry(null, "DVD insert"))).toBe(
            "G-DVD Insert"
        );
        expect(formatEntryLabel(great, entry(null, "\u00E9pilogue"))).toBe(
            "G-\u00C9pilogue"
        );
    });

    test("puts a location in as it is, never reading $ patterns in it", () => {
        expect(formatEntryLabel(great, entry(null, "$& and $$ page $1"))).toBe(
            "G-$& And $$ Page $1"
        );
    });

    test("prefers the number when an entry has a location too", () => {
        expect(formatEntryLabel(great, entry(12, "front cover"))).toBe("G-12");
    });

    test("shows ? for an entry with neither a number nor a location", () => {
        expect(formatEntryLabel(great, entry(null))).toBe("G-?");
        expect(formatEntryLabel(great, entry(null, "  "))).toBe("G-?");
    });

    test("fills every placeholder of a format, wherever it is", () => {
        expect(
            formatEntryLabel({ numbered: true, labelFormat: "No. {n}" }, entry(7))
        ).toBe("No. 7");
        expect(
            formatEntryLabel({ numbered: true, labelFormat: "{n}/{n}" }, entry(7))
        ).toBe("7/7");
    });

    test("labels every entry of an unnumbered book with its format, its short name", () => {
        expect(formatEntryLabel(choruses, entry(null))).toBe("Chorus Book");
        expect(formatEntryLabel(choruses, entry(null, "front cover"))).toBe(
            "Chorus Book"
        );
        expect(formatEntryLabel(choruses, entry(3))).toBe("Chorus Book");
    });
});
