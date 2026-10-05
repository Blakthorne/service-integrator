import { describe, expect, test } from "vitest";
import { songUseLines } from "./songUse";

describe("songUseLines", () => {
    test("says when a song was last sung and when it was last scheduled", () => {
        expect(
            songUseLines({ lastScheduledAt: "2026-10-11T08:00:00Z", lastSungAt: "2026-09-27" }, true)
        ).toEqual(["Last sung 9/27/26", "Last scheduled 10/11/26"]);
    });

    test("says a song that was scheduled but not sung yet was never sung", () => {
        expect(songUseLines({ lastScheduledAt: "2026-10-11T08:00:00Z", lastSungAt: null }, true)).toEqual([
            "Never sung",
            "Last scheduled 10/11/26",
        ]);
    });

    test("says only that a song never scheduled was, which covers its never being sung", () => {
        expect(songUseLines({ lastScheduledAt: null, lastSungAt: null }, true)).toEqual(["Never scheduled"]);
    });

    test("says nothing of what was sung before the history has been read", () => {
        expect(songUseLines({ lastScheduledAt: "2026-09-27T08:00:00Z", lastSungAt: null }, false)).toEqual([
            "Last scheduled 9/27/26",
        ]);
        expect(songUseLines({ lastScheduledAt: null, lastSungAt: null }, false)).toEqual(["Never scheduled"]);
    });

    test("does not call a song never scheduled when the history says it was sung", () => {
        expect(songUseLines({ lastScheduledAt: null, lastSungAt: "2026-09-27" }, true)).toEqual([
            "Last sung 9/27/26",
        ]);
    });

    test("takes the date part of Planning Center's date as written, in no time zone", () => {
        expect(songUseLines({ lastScheduledAt: "2026-01-04T23:30:00Z", lastSungAt: null }, false)).toEqual([
            "Last scheduled 1/4/26",
        ]);
    });
});
