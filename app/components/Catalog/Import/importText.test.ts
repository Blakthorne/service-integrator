import { describe, expect, test } from "vitest";
import { countOf, describePlanned, formatCount, importRunLabel } from "./importText";

describe("importRunLabel", () => {
    test("names the kind and the id", () => {
        expect(importRunLabel({ id: 3, kind: "hymns-json" })).toBe("Seed import 3");
    });
});

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
        expect(countOf(921, "song")).toBe("921 songs");
    });

    test("takes the plural it is given, and groups thousands", () => {
        expect(countOf(1, "entry", "entries")).toBe("1 entry");
        expect(countOf(1247, "entry", "entries")).toBe("1,247 entries");
    });
});

describe("describePlanned", () => {
    const seed = {
        books: 2,
        hymns: 895,
        hymnAliases: 4,
        tunes: 768,
        tuneAliases: 1,
        songs: 921,
        songsWithoutTune: 107,
        entries: 1247,
    };

    test("lists what the seed adds", () => {
        expect(describePlanned(seed)).toBe(
            "2 books, 895 hymns, 768 tunes, 921 songs and 1,247 entries"
        );
    });

    test("uses the singular for a count of one", () => {
        expect(
            describePlanned({ ...seed, books: 1, hymns: 1, tunes: 1, songs: 1, entries: 1 })
        ).toBe("1 book, 1 hymn, 1 tune, 1 song and 1 entry");
    });
});
