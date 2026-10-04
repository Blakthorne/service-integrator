import { describe, expect, test } from "vitest";
import { countOf, formatCount, formatMatchCount } from "./counts";

describe("formatCount", () => {
    test("groups thousands the same way everywhere", () => {
        expect(formatCount(0)).toBe("0");
        expect(formatCount(921)).toBe("921");
        expect(formatCount(1247)).toBe("1,247");
        expect(formatCount(1234567)).toBe("1,234,567");
    });
});

describe("countOf", () => {
    test("is singular for one only", () => {
        expect(countOf(1, "song")).toBe("1 song");
        expect(countOf(0, "song")).toBe("0 songs");
        expect(countOf(2, "song")).toBe("2 songs");
        expect(countOf(921, "song")).toBe("921 songs");
    });

    test("takes the plural it is given, and groups thousands", () => {
        expect(countOf(1, "entry", "entries")).toBe("1 entry");
        expect(countOf(1247, "entry", "entries")).toBe("1,247 entries");
    });
});

describe("formatMatchCount", () => {
    test("says only the total when every row is shown", () => {
        expect(formatMatchCount(921, 921, "song")).toBe("921 songs");
        expect(formatMatchCount(1, 1, "song")).toBe("1 song");
        expect(formatMatchCount(0, 0, "song")).toBe("0 songs");
    });

    test("says how many of the total match", () => {
        expect(formatMatchCount(12, 921, "song")).toBe("12 of 921 songs");
        expect(formatMatchCount(1, 921, "song")).toBe("1 of 921 songs");
        expect(formatMatchCount(0, 921, "song")).toBe("0 of 921 songs");
        expect(formatMatchCount(1000, 1247, "entry", "entries")).toBe(
            "1,000 of 1,247 entries"
        );
    });

    test("the total decides the noun's number", () => {
        expect(formatMatchCount(1, 2, "song")).toBe("1 of 2 songs");
    });
});
