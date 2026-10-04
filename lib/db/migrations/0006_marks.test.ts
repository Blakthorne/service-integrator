import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { openTestDb, seedBook, seedEntry, seedSong } from "../testing";

let db: DatabaseSync;

beforeEach(() => {
    db = openTestDb();
});

afterEach(() => {
    db.close();
});

function columns(table: string): string[] {
    return db
        .prepare("SELECT name FROM pragma_table_info(?) ORDER BY cid")
        .all(table)
        .map((row) => String(row.name));
}

const AT = "2026-10-04T12:00:00.000Z";

/** Mark a song, each column given or a valid default. */
function mark(
    songId: SQLInputValue,
    { mark = "to-learn", note = null, createdAt = AT }: Partial<Record<"mark" | "note" | "createdAt", SQLInputValue>> = {}
) {
    db.prepare(
        "INSERT INTO song_marks (song_id, mark, note, created_at) VALUES (?, ?, ?, ?)"
    ).run(songId, mark, note, createdAt);
}

function count(table: string): number {
    return Number(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n);
}

describe("0006_marks: song_marks", () => {
    test("holds a song's marks, each with a note and when it was made", () => {
        expect(columns("song_marks")).toEqual(["song_id", "mark", "note", "created_at"]);
    });

    test("has each mark once per song", () => {
        const song = seedSong(db);
        mark(song);
        expect(() => mark(song, { note: "again" })).toThrow(
            /UNIQUE constraint failed: song_marks.song_id, song_marks.mark/
        );
        mark(song, { mark: "favourite" });
        mark(seedSong(db));
        expect(count("song_marks")).toBe(3);
    });

    test("belongs to a song of the catalog, and goes when the song does", () => {
        expect(() => mark(999)).toThrow(/FOREIGN KEY constraint failed/);
        const song = seedSong(db);
        const other = seedSong(db);
        mark(song);
        mark(other);
        db.prepare("DELETE FROM songs WHERE id = ?").run(song);
        expect(db.prepare("SELECT song_id FROM song_marks").all()).toEqual([{ song_id: other }]);
    });

    test("stores a note or none, never a blank one", () => {
        const song = seedSong(db);
        mark(song, { note: "For Advent" });
        mark(song, { mark: "other", note: null });
        expect(() => mark(seedSong(db), { note: "" })).toThrow(/CHECK constraint failed/);
    });

    test("needs a mark and a time; the mark is not checked here", () => {
        const song = seedSong(db);
        expect(() => mark(song, { mark: null })).toThrow(/NOT NULL constraint failed: song_marks.mark/);
        expect(() => mark(song, { createdAt: null })).toThrow(
            /NOT NULL constraint failed: song_marks.created_at/
        );
        // A newer build's mark is stored; readers skip it (lib/db/marks.ts).
        mark(song, { mark: "newer-mark" });
    });
});

describe("0006_marks: entries_book_position", () => {
    test("holds each position of a book once", () => {
        const chorus = seedBook(db, { numbered: false });
        const other = seedBook(db, { numbered: false });
        seedEntry(db, { bookId: chorus, songId: seedSong(db), position: 1 });
        expect(() => seedEntry(db, { bookId: chorus, songId: seedSong(db), position: 1 })).toThrow(
            /UNIQUE constraint failed: entries.book_id, entries.position/
        );
        seedEntry(db, { bookId: other, songId: seedSong(db), position: 1 });
    });

    test("leaves entries without a position alone", () => {
        const book = seedBook(db);
        seedEntry(db, { bookId: book, songId: seedSong(db), number: 1 });
        seedEntry(db, { bookId: book, songId: seedSong(db), number: 2 });
        seedEntry(db, { bookId: book, songId: seedSong(db), locationLabel: "front cover" });
        expect(count("entries")).toBe(3);
    });
});
