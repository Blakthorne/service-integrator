import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { openTestDb, seedPcoSong } from "../testing";

let db: DatabaseSync;

beforeEach(() => {
    db = openTestDb();
    seedPcoSong(db, { id: "1001" });
});

afterEach(() => {
    db.close();
});

function written(pcoSongId: SQLInputValue, writtenAt: SQLInputValue = "2026-10-04T12:00:00.000Z") {
    db.prepare("INSERT INTO pco_song_tags_written (pco_song_id, written_at) VALUES (?, ?)").run(
        pcoSongId,
        writtenAt
    );
}

describe("0006_song_tags_written", () => {
    test("holds when each song's tags were last written", () => {
        expect(
            db
                .prepare("SELECT name FROM pragma_table_info('pco_song_tags_written') ORDER BY cid")
                .all()
                .map((row) => String(row.name))
        ).toEqual(["pco_song_id", "written_at"]);
    });

    test("has one row per song, of a song the mirror has", () => {
        written("1001");
        expect(() => written("1001")).toThrow(/UNIQUE constraint failed: pco_song_tags_written.pco_song_id/);
        expect(() => written("2002")).toThrow(/FOREIGN KEY constraint failed/);
    });

    test("needs the time", () => {
        expect(() => written("1001", null)).toThrow(
            /NOT NULL constraint failed: pco_song_tags_written.written_at/
        );
    });

    test("deleting the song deletes its row", () => {
        written("1001");
        db.prepare("DELETE FROM pco_songs WHERE id = '1001'").run();
        expect(db.prepare("SELECT count(*) AS n FROM pco_song_tags_written").get()?.n).toBe(0);
    });
});
