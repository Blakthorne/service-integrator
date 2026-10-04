import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
    openTestDb,
    seedBook,
    seedEntry,
    seedHymn,
    seedSong,
    seedTune,
} from "./testing";

let db: DatabaseSync;

beforeEach(() => {
    db = openTestDb();
});

afterEach(() => {
    db.close();
});

function row(table: string, id: number) {
    return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
}

describe("seedBook", () => {
    test("makes numbered, active books coded B1, B2, … in order by default", () => {
        const first = seedBook(db);
        const second = seedBook(db);
        expect(row("books", first)).toEqual({
            id: first,
            code: "B1",
            name: "Book B1",
            short_name: "Book B1",
            numbered: 1,
            label_format: "B1-{n}",
            sort_order: 1,
            active: 1,
        });
        expect(row("books", second)).toMatchObject({ code: "B2", sort_order: 2 });
    });

    test("skips a default code that is taken", () => {
        seedBook(db, { code: "B2" });
        expect(row("books", seedBook(db))).toMatchObject({ code: "B3" });
    });

    test("labels an unnumbered book with its short name", () => {
        const id = seedBook(db, {
            code: "CB",
            name: "The Chorus Book",
            shortName: "Chorus Book",
            numbered: false,
        });
        expect(row("books", id)).toMatchObject({
            numbered: 0,
            label_format: "Chorus Book",
        });
    });

    test("takes every field", () => {
        const id = seedBook(db, {
            code: "R",
            name: "Rejoice Hymns",
            shortName: "Rejoice",
            numbered: true,
            labelFormat: "R-{n}",
            sortOrder: 5,
            active: false,
        });
        expect(row("books", id)).toEqual({
            id,
            code: "R",
            name: "Rejoice Hymns",
            short_name: "Rejoice",
            numbered: 1,
            label_format: "R-{n}",
            sort_order: 5,
            active: 0,
        });
    });
});

describe("seedHymn and seedTune", () => {
    test("number their default titles and names", () => {
        expect(row("hymns", seedHymn(db))).toMatchObject({ title: "Hymn 1" });
        expect(row("hymns", seedHymn(db))).toMatchObject({ title: "Hymn 2" });
        expect(row("tunes", seedTune(db))).toMatchObject({ name: "TUNE 1" });
    });

    test("store aliases with their normalized forms", () => {
        const hymnId = seedHymn(db, {
            title: "Rejoice, the Lord Is King",
            aliases: ["Rejoice \u2013 the Lord Is King!"],
        });
        const tuneId = seedTune(db, { name: "DARWALL", aliases: ["Darwal"] });
        expect(
            db.prepare("SELECT hymn_id, alias, normalized FROM hymn_aliases").all()
        ).toEqual([
            {
                hymn_id: hymnId,
                alias: "Rejoice \u2013 the Lord Is King!",
                normalized: "rejoice \u2013 the lord is king",
            },
        ]);
        expect(
            db.prepare("SELECT tune_id, alias, normalized FROM tune_aliases").all()
        ).toEqual([{ tune_id: tuneId, alias: "Darwal", normalized: "DARWAL" }]);
    });
});

describe("seedSong", () => {
    test("makes a new hymn with no tune and no link by default", () => {
        const id = seedSong(db);
        expect(row("songs", id)).toEqual({
            id,
            hymn_id: expect.any(Number),
            tune_id: null,
            pco_song_id: null,
            linked_at: null,
            linked_by: null,
            notes: null,
        });
    });

    test("takes every field", () => {
        const hymnId = seedHymn(db);
        const tuneId = seedTune(db);
        const id = seedSong(db, {
            hymnId,
            tuneId,
            pcoSongId: "123",
            linkedAt: "2026-10-04T12:00:00.000Z",
            linkedBy: "manual",
            notes: "Slow",
        });
        expect(row("songs", id)).toEqual({
            id,
            hymn_id: hymnId,
            tune_id: tuneId,
            pco_song_id: "123",
            linked_at: "2026-10-04T12:00:00.000Z",
            linked_by: "manual",
            notes: "Slow",
        });
    });
});

describe("seedEntry", () => {
    test("numbers entries of a numbered book in turn by default", () => {
        const bookId = seedBook(db);
        const first = seedEntry(db, { bookId, songId: seedSong(db) });
        const second = seedEntry(db, { bookId, songId: seedSong(db) });
        expect(row("entries", first)).toMatchObject({ number: 1, position: null });
        expect(row("entries", second)).toMatchObject({ number: 2, position: null });
    });

    test("places entries of an unnumbered book in turn by default", () => {
        const bookId = seedBook(db, { numbered: false });
        seedEntry(db, { bookId, songId: seedSong(db) });
        const second = seedEntry(db, { bookId, songId: seedSong(db) });
        expect(row("entries", second)).toMatchObject({ number: null, position: 2 });
    });

    test("leaves the number out when a location is given", () => {
        const bookId = seedBook(db);
        const songId = seedSong(db);
        const id = seedEntry(db, {
            bookId,
            songId,
            locationLabel: "front cover",
            variantNote: "A Round",
        });
        expect(row("entries", id)).toEqual({
            id,
            book_id: bookId,
            song_id: songId,
            number: null,
            position: null,
            location_label: "front cover",
            variant_note: "A Round",
        });
    });
});
