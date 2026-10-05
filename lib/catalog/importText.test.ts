import { describe, expect, test } from "vitest";
import {
    describePlanned,
    describeSplitPairTunes,
    importRunLabel,
    NO_TUNE_REASONS,
    SPLIT_PAIR_LABELS,
} from "./importText";

describe("importRunLabel", () => {
    test("names the kind and the id", () => {
        expect(importRunLabel({ id: 3, kind: "hymns-json" })).toBe("Seed import 3");
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

describe("a split pair's outcome", () => {
    test("each outcome has a label of its own, a conflict is not an ambiguity", () => {
        expect(SPLIT_PAIR_LABELS).toEqual({
            merged: "Merged",
            ambiguous: "Ambiguous",
            conflict: "Conflict",
        });
    });

    test("words the tunes for what the outcome did with them", () => {
        expect(
            describeSplitPairTunes({ outcome: "merged", tunes: ["PINKSTON"] })
        ).toBe("Joined PINKSTON");
        expect(
            describeSplitPairTunes({
                outcome: "ambiguous",
                tunes: ["LYNCH", "THANK YOU, LORD"],
            })
        ).toBe("Candidates: LYNCH \u00b7 THANK YOU, LORD");
        expect(
            describeSplitPairTunes({ outcome: "conflict", tunes: ["PINKSTON"] })
        ).toBe("Would have joined PINKSTON");
    });
});

describe("why a song has no tune", () => {
    test("every reason has words, and no two share them", () => {
        expect(Object.keys(NO_TUNE_REASONS).sort()).toEqual([
            "ambiguous-split-pair",
            "no-tune",
            "split-pair-conflict",
            "variant-without-tune",
        ]);
        const words = Object.values(NO_TUNE_REASONS);
        expect(new Set(words).size).toBe(words.length);
    });

    test("says a conflict is about the song's entry in the book, not about candidate tunes", () => {
        expect(NO_TUNE_REASONS["split-pair-conflict"]).toBe(
            "The one song it could join already has an entry in this book"
        );
        expect(NO_TUNE_REASONS["split-pair-conflict"]).not.toBe(
            NO_TUNE_REASONS["ambiguous-split-pair"]
        );
    });
});
