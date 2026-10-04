import { describe, expect, test } from "vitest";
import type { MergePreview } from "./merge";
import {
    canMerge,
    describeMergeDone,
    joinWords,
    mergeDestinationSong,
    mergeHeading,
    mergeQuestion,
    mergeRefusalLines,
    mergeSections,
    mergeWarning,
} from "./mergeText";

/** "Rejoice - the Lord Is King" into "Rejoice, the Lord Is King": one song moves, one merges. */
function hymnPreview(overrides: Partial<MergePreview> = {}): MergePreview {
    return {
        kind: "hymn",
        source: { id: 1, name: "Rejoice - the Lord Is King" },
        target: { id: 2, name: "Rejoice, the Lord Is King" },
        moves: [
            {
                songId: 102,
                from: "Rejoice - the Lord Is King (GOPSAL)",
                to: "Rejoice, the Lord Is King (GOPSAL)",
                entries: ["G-144"],
            },
        ],
        merges: [
            {
                sourceSongId: 101,
                targetSongId: 201,
                source: "Rejoice - the Lord Is King (DARWALL)",
                target: "Rejoice, the Lord Is King (DARWALL)",
                entries: ["G-143"],
                marks: [],
                notes: false,
                link: null,
            },
        ],
        aliasesAdded: ["Rejoice - the Lord Is King", "Rejoice! The Lord Is King"],
        detailTaken: null,
        notesAdded: false,
        refusals: [],
        ...overrides,
    };
}

/** DARWAL into DARWALL: two songs move. */
function tunePreview(overrides: Partial<MergePreview> = {}): MergePreview {
    return {
        kind: "tune",
        source: { id: 10, name: "DARWAL" },
        target: { id: 11, name: "DARWALL" },
        moves: [
            { songId: 301, from: "Ye Holy Angels Bright (DARWAL)", to: "Ye Holy Angels Bright (DARWALL)", entries: [] },
            { songId: 302, from: "Rejoice, the Lord Is King (DARWAL)", to: "Rejoice, the Lord Is King (DARWALL)", entries: ["R-43", "G-143"] },
        ],
        merges: [],
        aliasesAdded: ["DARWAL"],
        detailTaken: "6.6.6.6.8.8",
        notesAdded: true,
        refusals: [],
        ...overrides,
    };
}

describe("joinWords", () => {
    test("joins with commas and a last 'and'", () => {
        expect(joinWords([])).toBe("");
        expect(joinWords(["a"])).toBe("a");
        expect(joinWords(["a", "b"])).toBe("a and b");
        expect(joinWords(["a", "b", "c"])).toBe("a, b and c");
    });
});

describe("mergeSections", () => {
    test("lists the songs that move, those that merge, and what else changes, for hymns", () => {
        expect(mergeSections(hymnPreview())).toEqual([
            {
                heading: "Songs that move",
                items: ['"Rejoice - the Lord Is King (GOPSAL)" becomes "Rejoice, the Lord Is King (GOPSAL)", with G-144.'],
            },
            {
                heading: "Songs that merge into one to the same tune",
                items: [
                    '"Rejoice - the Lord Is King (DARWALL)" merges into "Rejoice, the Lord Is King (DARWALL)", which takes G-143.',
                ],
            },
            {
                heading: "Also",
                items: [
                    '"Rejoice, the Lord Is King" takes "Rejoice - the Lord Is King" and "Rejoice! The Lord Is King" as other titles.',
                    'The hymn "Rejoice - the Lord Is King" is deleted.',
                ],
            },
        ]);
    });

    test("names everything a merged song brings: entries, marks, notes and its link", () => {
        const preview = hymnPreview({
            moves: [],
            merges: [
                {
                    sourceSongId: 101,
                    targetSongId: 201,
                    source: "A (DARWALL)",
                    target: "B (DARWALL)",
                    entries: ["G-143", "CB"],
                    marks: ["to-learn"],
                    notes: true,
                    link: { pcoSongId: "1001", title: "Rejoice the Lord Is King" },
                },
                {
                    sourceSongId: 103,
                    targetSongId: 203,
                    source: "A",
                    target: "B",
                    entries: [],
                    marks: [],
                    notes: false,
                    link: { pcoSongId: "1002", title: null },
                },
                {
                    sourceSongId: 104,
                    targetSongId: 204,
                    source: "A (SLANE)",
                    target: "B (SLANE)",
                    entries: [],
                    marks: [],
                    notes: false,
                    link: null,
                },
            ],
        });
        expect(mergeSections(preview)[0]).toEqual({
            heading: "Songs that merge into one to the same tune",
            items: [
                '"A (DARWALL)" merges into "B (DARWALL)", which takes G-143, CB, its To learn mark, its notes and its link to "Rejoice the Lord Is King" in Planning Center.',
                '"A" merges into "B", which takes its link to Planning Center song 1002.',
                '"A (SLANE)" merges into "B (SLANE)".',
            ],
        });
    });

    test("says a tune's names bare, and the meter and notes the target takes", () => {
        expect(mergeSections(tunePreview())).toEqual([
            {
                heading: "Songs that move",
                items: [
                    '"Ye Holy Angels Bright (DARWAL)" becomes "Ye Holy Angels Bright (DARWALL)".',
                    '"Rejoice, the Lord Is King (DARWAL)" becomes "Rejoice, the Lord Is King (DARWALL)", with R-43 and G-143.',
                ],
            },
            {
                heading: "Also",
                items: [
                    "DARWALL takes DARWAL as another name.",
                    "DARWALL takes the meter 6.6.6.6.8.8.",
                    "The notes of DARWAL are added to those of DARWALL.",
                    "The tune DARWAL is deleted.",
                ],
            },
        ]);
    });

    test("says that a tune merge merges songs of the same hymn", () => {
        const preview = tunePreview({
            moves: [],
            merges: [
                {
                    sourceSongId: 301,
                    targetSongId: 401,
                    source: "Ye Holy Angels Bright (DARWAL)",
                    target: "Ye Holy Angels Bright (DARWALL)",
                    entries: [],
                    marks: [],
                    notes: false,
                    link: null,
                },
            ],
        });
        expect(mergeSections(preview)[0].heading).toBe("Songs that merge into one to the same hymn");
    });

    test("names a hymn's first line, in quotes", () => {
        const preview = hymnPreview({
            moves: [],
            merges: [],
            aliasesAdded: ["Rejoice - the Lord Is King"],
            detailTaken: "Rejoice, the Lord is King!",
            notesAdded: true,
        });
        expect(mergeSections(preview)).toEqual([
            {
                heading: "Also",
                items: [
                    '"Rejoice, the Lord Is King" takes "Rejoice - the Lord Is King" as another title.',
                    '"Rejoice, the Lord Is King" takes the first line "Rejoice, the Lord is King!".',
                    'The notes of "Rejoice - the Lord Is King" are added to those of "Rejoice, the Lord Is King".',
                    'The hymn "Rejoice - the Lord Is King" is deleted.',
                ],
            },
        ]);
    });
});

describe("refusals", () => {
    test("lists why the merge is refused, and says whether it may go ahead", () => {
        const refused = hymnPreview({
            refusals: [
                { reason: "linked-apart", message: "Linked to different Planning Center songs.", songIds: [101, 201] },
                { reason: "entry-collision", message: "Would be in Great Hymns twice.", songIds: [101, 201] },
            ],
        });
        expect(mergeRefusalLines(refused)).toEqual([
            "Linked to different Planning Center songs.",
            "Would be in Great Hymns twice.",
        ]);
        expect(canMerge(refused)).toBe(false);
        expect(mergeRefusalLines(hymnPreview())).toEqual([]);
        expect(canMerge(hymnPreview())).toBe(true);
    });
});

describe("the confirmation", () => {
    test("asks about the two by name, quoting a hymn's title and not a tune's name", () => {
        expect(mergeHeading(hymnPreview())).toBe('Merge "Rejoice - the Lord Is King" into "Rejoice, the Lord Is King"');
        expect(mergeQuestion(hymnPreview())).toBe('Merge "Rejoice - the Lord Is King" into "Rejoice, the Lord Is King"?');
        expect(mergeQuestion(tunePreview())).toBe("Merge DARWAL into DARWALL?");
    });

    test("warns that the merged hymn or tune is deleted", () => {
        expect(mergeWarning("hymn")).toBe(
            "This cannot be undone: the hymn merged is deleted. Everything below happens at once."
        );
        expect(mergeWarning("tune")).toContain("the tune merged is deleted");
    });
});

describe("describeMergeDone", () => {
    test("counts the songs that moved and merged", () => {
        expect(describeMergeDone(hymnPreview())).toBe(
            'Merged "Rejoice - the Lord Is King" into "Rejoice, the Lord Is King": 1 song moved and 1 merged.'
        );
        expect(describeMergeDone(tunePreview())).toBe("Merged DARWAL into DARWALL: 2 songs moved.");
        expect(describeMergeDone(hymnPreview({ moves: [] }))).toBe(
            'Merged "Rejoice - the Lord Is King" into "Rejoice, the Lord Is King": 1 song merged.'
        );
        expect(describeMergeDone(hymnPreview({ moves: [], merges: [] }))).toBe(
            'Merged "Rejoice - the Lord Is King" into "Rejoice, the Lord Is King".'
        );
    });
});

describe("mergeDestinationSong", () => {
    test("is the song itself when it moved, and the target's song when it merged", () => {
        expect(mergeDestinationSong(hymnPreview(), 102)).toBe(102);
        expect(mergeDestinationSong(hymnPreview(), 101)).toBe(201);
    });

    test("falls back to the first song the target took, for a song that was not the source's", () => {
        expect(mergeDestinationSong(hymnPreview(), 999)).toBe(102);
        expect(mergeDestinationSong(hymnPreview({ moves: [] }), 999)).toBe(201);
        expect(mergeDestinationSong(hymnPreview({ moves: [], merges: [] }), 999)).toBeNull();
    });
});
