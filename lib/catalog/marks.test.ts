import { describe, expect, test } from "vitest";
import { SONG_MARKS, SONG_MARK_LABELS, isSongMarkKind, sortSongMarks } from "./marks";

describe("song marks", () => {
    test("knows the to-learn shelf, with its words", () => {
        expect(SONG_MARKS).toEqual(["to-learn"]);
        expect(SONG_MARK_LABELS["to-learn"]).toBe("To learn");
    });

    test("tells a mark it knows from anything else", () => {
        expect(isSongMarkKind("to-learn")).toBe(true);
        expect(isSongMarkKind("To-Learn")).toBe(false);
        expect(isSongMarkKind("favourite")).toBe(false);
        expect(isSongMarkKind(null)).toBe(false);
    });

    test("sorts marks into their order, once each, leaving out the unknown", () => {
        expect(sortSongMarks(["newer-mark", "to-learn", "to-learn", 3])).toEqual(["to-learn"]);
        expect(sortSongMarks([])).toEqual([]);
    });
});
