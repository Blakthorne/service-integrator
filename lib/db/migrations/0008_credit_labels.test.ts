import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { openTestDb, seedPcoSong } from "../testing";

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

function count(): number {
    return Number(db.prepare("SELECT count(*) AS n FROM credit_label_requests").get()?.n);
}

const AT = "2026-10-04T12:00:00.000Z";

type RequestColumns =
    | "pcoSongId"
    | "source"
    | "shownAuthor"
    | "author"
    | "attempts"
    | "finishedAt"
    | "outcome";

/** Add a request, each column given or a valid default. */
function request({
    pcoSongId,
    source = "review",
    shownAuthor = "Fanny Crosby",
    author = "Words & Music: Fanny Crosby",
    attempts = 0,
    finishedAt = null,
    outcome = null,
}: Partial<Record<RequestColumns, SQLInputValue>> = {}) {
    db.prepare(
        `INSERT INTO credit_label_requests
             (pco_song_id, source, shown_author, author, requested_at, attempts, finished_at, outcome)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(pcoSongId ?? null, source, shownAuthor, author, AT, attempts, finishedAt, outcome);
}

describe("0008_credit_labels: credit_label_requests", () => {
    test("holds what to write over which author, who asked, and how it ended", () => {
        expect(columns("credit_label_requests")).toEqual([
            "id",
            "pco_song_id",
            "source",
            "shown_author",
            "author",
            "requested_at",
            "attempts",
            "finished_at",
            "outcome",
            "message",
        ]);
    });

    test("belongs to a mirrored song", () => {
        expect(() => request({ pcoSongId: "999" })).toThrow(/FOREIGN KEY constraint failed/);
        request({ pcoSongId: seedPcoSong(db) });
        expect(count()).toBe(1);
    });

    test("has at most one request waiting per song, and keeps the ended ones", () => {
        const song = seedPcoSong(db);
        request({ pcoSongId: song, finishedAt: AT, outcome: "labelled" });
        request({ pcoSongId: song, finishedAt: AT, outcome: "changed" });
        request({ pcoSongId: song });
        expect(() => request({ pcoSongId: song })).toThrow(/UNIQUE constraint failed/);
        request({ pcoSongId: seedPcoSong(db) });
        expect(count()).toBe(4);
    });

    test("ends with both when it ended and how, or neither", () => {
        const song = seedPcoSong(db);
        expect(() => request({ pcoSongId: song, finishedAt: AT })).toThrow(/CHECK constraint failed/);
        expect(() => request({ pcoSongId: song, outcome: "labelled" })).toThrow(
            /CHECK constraint failed/
        );
    });

    test("never writes an empty label, and counts attempts from 0", () => {
        const song = seedPcoSong(db);
        expect(() => request({ pcoSongId: song, author: "" })).toThrow(/CHECK constraint failed/);
        expect(() => request({ pcoSongId: song, attempts: -1 })).toThrow(/CHECK constraint failed/);
        request({ pcoSongId: song, shownAuthor: "" });
        expect(count()).toBe(1);
    });
});
