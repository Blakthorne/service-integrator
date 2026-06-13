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

    test("straightens smart apostrophes and quotes", () => {
        expect(normalizeTitle("Jesus' Name")).toBe("jesus' name");
    });

    test("expands ampersand to 'and'", () => {
        expect(normalizeTitle("Praise & Worship")).toBe("praise and worship");
    });
});
