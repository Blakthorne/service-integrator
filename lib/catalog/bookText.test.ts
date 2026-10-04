import { describe, expect, test } from "vitest";
import { entryRowId, formatEntryCount } from "./bookText";

describe("entryRowId", () => {
    test("is the entry's number behind a fixed prefix", () => {
        expect(entryRowId(396)).toBe("entry-396");
        expect(entryRowId(1)).toBe("entry-1");
    });

    test("is a valid, distinct id for every number", () => {
        expect(entryRowId(12)).not.toBe(entryRowId(120));
        expect(entryRowId(12)).toMatch(/^[a-z][a-z0-9-]*$/);
    });
});

describe("formatEntryCount", () => {
    test("is singular for one entry only", () => {
        expect(formatEntryCount(1)).toBe("1 entry");
    });

    test("is plural for none and for many", () => {
        expect(formatEntryCount(0)).toBe("0 entries");
        expect(formatEntryCount(2)).toBe("2 entries");
        expect(formatEntryCount(708)).toBe("708 entries");
    });
});
