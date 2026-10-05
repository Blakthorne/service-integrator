import { describe, expect, test } from "vitest";
import { catalogSectionFor } from "@/lib/routes";
import { catalogLayoutSegment, isRouteGroup } from "./sections";

describe("isRouteGroup", () => {
    test.each<[string, boolean]>([
        ["(list)", true],
        ["(overview)", true],
        ["()", true],
        ["songs", false],
        ["42", false],
        ["(list", false],
        ["list)", false],
        ["", false],
    ])("%j: %s", (segment, expected) => {
        expect(isRouteGroup(segment)).toBe(expected);
    });
});

describe("catalogLayoutSegment", () => {
    // What useSelectedLayoutSegments() returns in the catalog layout, by URL.
    test.each<[string, string[], string | null]>([
        ["/catalog", ["(list)"], null],
        ["/catalog with no route group", [], null],
        ["/catalog/songs/42", ["songs", "42"], "songs"],
        ["/catalog/tunes", ["tunes", "(list)"], "tunes"],
        ["/catalog/tunes/7", ["tunes", "7"], "tunes"],
        ["/catalog/books/G", ["books", "G"], "books"],
        ["/catalog/import", ["import"], "import"],
        ["a section inside a group", ["(group)", "books"], "books"],
        ["only groups", ["(a)", "(b)"], null],
    ])("%s → %j", (_url, segments, expected) => {
        expect(catalogLayoutSegment(segments)).toBe(expected);
    });

    test("finds each page's section", () => {
        const sectionOf = (segments: string[]) =>
            catalogSectionFor(catalogLayoutSegment(segments))?.label;
        expect(sectionOf(["(list)"])).toBe("Songs");
        expect(sectionOf(["songs", "42"])).toBe("Songs");
        expect(sectionOf(["tunes", "(list)"])).toBe("Tunes");
        expect(sectionOf(["tunes", "7"])).toBe("Tunes");
        expect(sectionOf(["books"])).toBe("Books");
        expect(sectionOf(["import", "3"])).toBe("Import");
        expect(sectionOf(["reconcile"])).toBe("Reconcile");
        expect(sectionOf(["nothing-here"])).toBeUndefined();
    });
});
