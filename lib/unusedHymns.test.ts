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

import { computeUnusedHymns, type PcoSong, type RawHymn } from "./unusedHymns";

const AT = "2026-06-13T00:00:00.000Z";

function rejoice(title: string, tune: string, num: number): RawHymn {
    return { song_title: title, tune_name: tune, rejoice_hymns: num, great_hymns_of_the_faith: -1 };
}

describe("computeUnusedHymns", () => {
    test("unique title matched in PCO is excluded (used)", () => {
        const hymns: RawHymn[] = [rejoice("Amazing Grace", "NEW BRITAIN", 100)];
        const songs: PcoSong[] = [{ title: "Amazing Grace", lastScheduledAt: AT }];
        const result = computeUnusedHymns(hymns, songs, AT);
        expect(result.unused).toHaveLength(0);
        expect(result.review).toHaveLength(0);
    });

    test("unique title not in PCO is unused", () => {
        const hymns: RawHymn[] = [rejoice("Amazing Grace", "NEW BRITAIN", 100)];
        const result = computeUnusedHymns(hymns, [], AT);
        expect(result.unused).toEqual([
            { songTitle: "Amazing Grace", tuneName: "NEW BRITAIN", rejoiceNumber: 100, greatHymnsNumber: null },
        ]);
    });

    test("a song scheduled only via null last_scheduled_at counts as unused", () => {
        const hymns: RawHymn[] = [rejoice("Amazing Grace", "NEW BRITAIN", 100)];
        const songs: PcoSong[] = [{ title: "Amazing Grace", lastScheduledAt: null }];
        const result = computeUnusedHymns(hymns, songs, AT);
        expect(result.unused).toHaveLength(1);
    });

    test("multi-tune title used with no tune info sends both variants to review", () => {
        const hymns: RawHymn[] = [
            rejoice("Abba, Father", "ABBA, FATHER", 42),
            rejoice("Abba, Father", "PRITCHARD", 7),
        ];
        const songs: PcoSong[] = [{ title: "Abba, Father", lastScheduledAt: AT }];
        const result = computeUnusedHymns(hymns, songs, AT);
        expect(result.unused).toHaveLength(0);
        expect(result.review).toHaveLength(2);
        expect(result.review.every((r) => r.reason === "ambiguous-tune")).toBe(true);
        expect(result.review[0].matchedPcoTitle).toBe("Abba, Father");
    });

    test("multi-tune title with the tune named in the PCO title attributes usage to that variant", () => {
        const hymns: RawHymn[] = [
            rejoice("Abba, Father", "ABBA, FATHER", 42),
            rejoice("Abba, Father", "PRITCHARD", 7),
        ];
        const songs: PcoSong[] = [{ title: "Abba, Father (PRITCHARD)", lastScheduledAt: AT }];
        const result = computeUnusedHymns(hymns, songs, AT);
        // PRITCHARD attributed as used; the other variant has no evidence -> unused.
        expect(result.review).toHaveLength(0);
        expect(result.unused).toEqual([
            { songTitle: "Abba, Father", tuneName: "ABBA, FATHER", rejoiceNumber: 42, greatHymnsNumber: null },
        ]);
    });

    test("near-match goes to review, not silently unused", () => {
        const hymns: RawHymn[] = [rejoice("Blessed Assurance", "ASSURANCE", 300)];
        const songs: PcoSong[] = [{ title: "Blesed Assurance", lastScheduledAt: AT }];
        const result = computeUnusedHymns(hymns, songs, AT);
        expect(result.unused).toHaveLength(0);
        expect(result.review).toHaveLength(1);
        expect(result.review[0].reason).toBe("near-match");
        expect(result.review[0].matchedPcoTitle).toBe("Blesed Assurance");
    });

    test("titles that differ only by curly vs straight quotes are the same song (used, not near-match)", () => {
        const hymns: RawHymn[] = [
            rejoice("In Jordan’s Stream", "BRIDGEWATER", 1),
            rejoice("Jesus' Name", "X", 2),
        ];
        const songs: PcoSong[] = [
            { title: "In Jordan's Stream", lastScheduledAt: AT },
            { title: "Jesus’ Name", lastScheduledAt: AT },
        ];
        const result = computeUnusedHymns(hymns, songs, AT);
        expect(result.unused).toEqual([]);
        expect(result.review).toEqual([]);
    });

    test("maps -1 to null and counts per-book totals", () => {
        const hymns: RawHymn[] = [
            { song_title: "Both Books", tune_name: "X", rejoice_hymns: 5, great_hymns_of_the_faith: 9 },
            { song_title: "Rejoice Only", tune_name: "Y", rejoice_hymns: 6, great_hymns_of_the_faith: -1 },
        ];
        const result = computeUnusedHymns(hymns, [], AT);
        expect(result.meta.totals).toEqual({ rejoice: 2, greatHymns: 1 });
        const both = result.unused.find((e) => e.songTitle === "Both Books")!;
        expect(both.rejoiceNumber).toBe(5);
        expect(both.greatHymnsNumber).toBe(9);
        const rej = result.unused.find((e) => e.songTitle === "Rejoice Only")!;
        expect(rej.greatHymnsNumber).toBeNull();
    });

    test("stamps meta", () => {
        const result = computeUnusedHymns([], [{ title: "x", lastScheduledAt: AT }], AT);
        expect(result.meta.computedAt).toBe(AT);
        expect(result.meta.songsScanned).toBe(1);
        expect(result.meta.usedTitleCount).toBe(1);
    });

    test("multi-tune with mixed disambiguated + plain usage routes the un-named variant to review", () => {
        const hymns: RawHymn[] = [
            rejoice("Abba, Father", "ABBA, FATHER", 42),
            rejoice("Abba, Father", "PRITCHARD", 7),
        ];
        const songs: PcoSong[] = [
            { title: "Abba, Father (PRITCHARD)", lastScheduledAt: AT },
            { title: "Abba, Father", lastScheduledAt: AT },
        ];
        const result = computeUnusedHymns(hymns, songs, AT);
        // PRITCHARD is named -> used. ABBA, FATHER is not named, but a plain
        // (ambiguous) usage exists, so it must go to review, not unused.
        expect(result.unused).toHaveLength(0);
        expect(result.review).toHaveLength(1);
        expect(result.review[0].tuneName).toBe("ABBA, FATHER");
        expect(result.review[0].reason).toBe("ambiguous-tune");
    });
});
