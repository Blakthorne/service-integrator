import { describe, expect, test } from "vitest";
import { normalizeTitle } from "./normalizeTitle";

describe("normalizeTitle", () => {
    test("lowercases and trims", () => {
        expect(normalizeTitle("  A Mighty Fortress  ")).toBe("a mighty fortress");
    });

    test("collapses internal whitespace", () => {
        expect(normalizeTitle("Holy,   Holy,   Holy")).toBe("holy, holy, holy");
    });

    test("strips trailing punctuation but keeps internal", () => {
        expect(normalizeTitle("Holy, Holy, Holy!")).toBe("holy, holy, holy");
        expect(normalizeTitle("Come, Thou Fount.")).toBe("come, thou fount");
    });

    test.each([
        ["left single quotation mark U+2018", "‘"],
        ["right single quotation mark U+2019", "’"],
        ["modifier letter apostrophe U+02BC", "ʼ"],
        ["prime U+2032", "′"],
    ])("straightens a %s into an apostrophe", (_name, mark) => {
        expect(normalizeTitle(`In Jordan${mark}s Stream`)).toBe(
            "in jordan's stream"
        );
    });

    test.each([
        ["left double quotation mark U+201C", "“"],
        ["right double quotation mark U+201D", "”"],
        ["double prime U+2033", "″"],
    ])("straightens a %s into a double quote", (_name, mark) => {
        expect(normalizeTitle(`Say ${mark}Amen${mark}`)).toBe('say "amen"');
    });

    test("leaves straight quotes as they are", () => {
        expect(normalizeTitle("Jesus' Name")).toBe("jesus' name");
        expect(normalizeTitle('Say "Amen"')).toBe('say "amen"');
    });

    test("a curly and a straight spelling of a catalog title normalize alike", () => {
        expect(normalizeTitle("The Strife Is O’er")).toBe(
            normalizeTitle("The Strife Is O'er")
        );
    });

    test("expands ampersand to 'and'", () => {
        expect(normalizeTitle("Praise & Worship")).toBe("praise and worship");
    });
});
