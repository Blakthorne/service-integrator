import { describe, expect, test } from "vitest";
import { isNearMatch, levenshtein } from "./unusedHymns";

describe("levenshtein", () => {
    test("identical strings have distance 0", () => {
        expect(levenshtein("abide with me", "abide with me")).toBe(0);
    });

    test("counts single edits", () => {
        expect(levenshtein("color", "colour")).toBe(1);
        expect(levenshtein("kitten", "sitting")).toBe(3);
    });

    test("handles empty strings", () => {
        expect(levenshtein("", "abc")).toBe(3);
        expect(levenshtein("abc", "")).toBe(3);
    });
});

describe("isNearMatch", () => {
    test("false for identical strings", () => {
        expect(isNearMatch("come thou fount", "come thou fount")).toBe(false);
    });

    test("true for a small typo on long-enough strings", () => {
        expect(isNearMatch("blessed assurance", "blesed assurance")).toBe(true);
    });

    test("false when too different", () => {
        expect(isNearMatch("amazing grace", "how great thou art")).toBe(false);
    });

    test("false when strings are too short", () => {
        expect(isNearMatch("go", "do")).toBe(false);
    });
});
