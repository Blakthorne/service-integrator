import { describe, expect, test } from "vitest";
import { formatCountOf, formatMatchCount } from "./summary";

const SONG = { one: "song", other: "songs" };
const ENTRY = { one: "entry", other: "entries" };

describe("formatCountOf", () => {
    test.each<[number, string]>([
        [0, "0 songs"],
        [1, "1 song"],
        [2, "2 songs"],
        [921, "921 songs"],
        [1247, "1,247 songs"],
    ])("%d → %j", (count, expected) => {
        expect(formatCountOf(count, SONG)).toBe(expected);
    });

    test("uses the noun's own plural", () => {
        expect(formatCountOf(1247, ENTRY)).toBe("1,247 entries");
        expect(formatCountOf(1, ENTRY)).toBe("1 entry");
    });
});

describe("formatMatchCount", () => {
    test("says only the total when every row is shown", () => {
        expect(formatMatchCount(921, 921, SONG)).toBe("921 songs");
        expect(formatMatchCount(1, 1, SONG)).toBe("1 song");
        expect(formatMatchCount(0, 0, SONG)).toBe("0 songs");
    });

    test("says how many of the total match", () => {
        expect(formatMatchCount(12, 921, SONG)).toBe("12 of 921 songs");
        expect(formatMatchCount(1, 921, SONG)).toBe("1 of 921 songs");
        expect(formatMatchCount(0, 921, SONG)).toBe("0 of 921 songs");
        expect(formatMatchCount(1000, 1247, ENTRY)).toBe("1,000 of 1,247 entries");
    });

    test("the total decides the noun's number", () => {
        expect(formatMatchCount(1, 2, SONG)).toBe("1 of 2 songs");
    });
});
