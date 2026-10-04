import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { SongMarkKind } from "@/lib/domain";
import {
    findSongMarks,
    listMarkedSongIds,
    markSong,
    songMarksFromJson,
    unmarkSong,
} from "./marks";
import { openTestDb, seedSong, seedSongMark } from "./testing";

let db: DatabaseSync;

beforeEach(() => {
    db = openTestDb();
});

afterEach(() => {
    db.close();
});

const T0 = new Date("2026-10-04T12:00:00.000Z");
const T1 = new Date("2026-10-05T08:00:00.000Z");

function stored(songId: number) {
    return db
        .prepare("SELECT mark, note, created_at FROM song_marks WHERE song_id = ? ORDER BY mark")
        .all(songId);
}

describe("markSong", () => {
    test("marks a song, with a note or none", () => {
        const first = seedSong(db);
        const second = seedSong(db);
        expect(markSong(db, first, "to-learn", "For Advent", T0)).toEqual({ ok: true, changed: true });
        expect(markSong(db, second, "to-learn", null, T0)).toEqual({ ok: true, changed: true });
        expect(stored(first)).toEqual([
            { mark: "to-learn", note: "For Advent", created_at: "2026-10-04T12:00:00.000Z" },
        ]);
        expect(stored(second)).toEqual([
            { mark: "to-learn", note: null, created_at: "2026-10-04T12:00:00.000Z" },
        ]);
    });

    test("stores a blank note as none", () => {
        const song = seedSong(db);
        markSong(db, song, "to-learn", "   ", T0);
        expect(stored(song)).toEqual([expect.objectContaining({ note: null })]);
    });

    test("changes the note of a song already marked, keeping when it was marked", () => {
        const song = seedSong(db);
        markSong(db, song, "to-learn", "For Advent", T0);
        expect(markSong(db, song, "to-learn", "For Lent", T1)).toEqual({ ok: true, changed: true });
        expect(stored(song)).toEqual([
            { mark: "to-learn", note: "For Lent", created_at: "2026-10-04T12:00:00.000Z" },
        ]);
        expect(markSong(db, song, "to-learn", "For Lent", T1)).toEqual({ ok: true, changed: false });
        expect(markSong(db, song, "to-learn", null, T1)).toEqual({ ok: true, changed: true });
        expect(markSong(db, song, "to-learn", "", T1)).toEqual({ ok: true, changed: false });
    });

    test("refuses a song that is not in the catalog", () => {
        expect(markSong(db, 999, "to-learn", null, T0)).toEqual({
            ok: false,
            reason: "song-not-found",
            message: "There is no such catalog song.",
        });
        expect(db.prepare("SELECT count(*) AS n FROM song_marks").get()?.n).toBe(0);
    });

    test("throws for a mark this build does not know", () => {
        const song = seedSong(db);
        expect(() => markSong(db, song, "favourite" as SongMarkKind, null, T0)).toThrow(
            "Unknown song mark: favourite"
        );
    });
});

describe("unmarkSong", () => {
    test("takes the mark off, once", () => {
        const song = seedSong(db);
        const other = seedSong(db);
        seedSongMark(db, song);
        seedSongMark(db, other);
        expect(unmarkSong(db, song, "to-learn")).toEqual({ ok: true, changed: true });
        expect(stored(song)).toEqual([]);
        expect(stored(other)).toHaveLength(1);
        expect(unmarkSong(db, song, "to-learn")).toEqual({ ok: true, changed: false });
    });

    test("refuses a song that is not in the catalog", () => {
        expect(unmarkSong(db, 999, "to-learn")).toMatchObject({ ok: false, reason: "song-not-found" });
    });
});

describe("findSongMarks", () => {
    test("gives a song's marks with their notes, without those this build does not know", () => {
        const song = seedSong(db);
        seedSongMark(db, song, { note: "For Advent", createdAt: "2026-10-01T09:00:00.000Z" });
        seedSongMark(db, song, { mark: "newer-mark" });
        expect(findSongMarks(db, song)).toEqual([
            { mark: "to-learn", note: "For Advent", createdAt: "2026-10-01T09:00:00.000Z" },
        ]);
    });

    test("is empty for a song with no marks, or no such song", () => {
        expect(findSongMarks(db, seedSong(db))).toEqual([]);
        expect(findSongMarks(db, 999)).toEqual([]);
    });
});

describe("listMarkedSongIds", () => {
    test("gives the ids of the songs with the mark, in id order", () => {
        const [a, b, c] = [seedSong(db), seedSong(db), seedSong(db)];
        seedSongMark(db, c);
        seedSongMark(db, a);
        seedSongMark(db, b, { mark: "newer-mark" });
        expect(listMarkedSongIds(db, "to-learn")).toEqual([a, c]);
    });

    test("is empty when no song has the mark", () => {
        seedSong(db);
        expect(listMarkedSongIds(db, "to-learn")).toEqual([]);
    });
});

describe("songMarksFromJson", () => {
    test("reads the marks a query built, leaving out the unknown and the malformed", () => {
        expect(
            songMarksFromJson(
                JSON.stringify([
                    { mark: "newer-mark", note: null, createdAt: "x" },
                    { mark: "to-learn", note: "For Advent", createdAt: "2026-10-01T09:00:00.000Z" },
                    null,
                    "to-learn",
                ])
            )
        ).toEqual([{ mark: "to-learn", note: "For Advent", createdAt: "2026-10-01T09:00:00.000Z" }]);
        expect(songMarksFromJson("[]")).toEqual([]);
        expect(songMarksFromJson("{}")).toEqual([]);
        expect(songMarksFromJson(null)).toEqual([]);
    });
});
