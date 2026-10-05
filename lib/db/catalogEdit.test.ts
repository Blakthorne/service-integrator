import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { EntryPlacement, NewEntryInput } from "@/lib/catalog/validation";
import { findCatalogSong } from "./catalog";
import {
    addEntry,
    addHymnAlias,
    addTuneAlias,
    deleteEntry,
    editEntry,
    editHymn,
    editTune,
    moveEntry,
    removeHymnAlias,
    removeTuneAlias,
} from "./catalogEdit";
import {
    openTestDb,
    seedBook,
    seedEntry,
    seedHymn,
    seedPcoSong,
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

/**
 * Rejoice Hymns (numbered) and a Chorus Book (not). Amazing Grace to NEW
 * BRITAIN at R-108, with a descant at R-109; A Charge to Keep at R-396;
 * three choruses at positions 1 to 3; and a song in no book.
 */
function seed() {
    const books = {
        rejoice: seedBook(db, { code: "R", name: "Rejoice Hymns" }),
        chorus: seedBook(db, { code: "CB", name: "Chorus Book", numbered: false }),
    };
    const songs = {
        amazingGrace: seedSong(db, {
            hymnId: seedHymn(db, { title: "Amazing Grace" }),
            tuneId: seedTune(db, { name: "NEW BRITAIN" }),
        }),
        charge: seedSong(db, {
            hymnId: seedHymn(db, { title: "A Charge to Keep I Have" }),
            tuneId: seedTune(db, { name: "BOYLSTON" }),
        }),
        alleluia: seedSong(db, { hymnId: seedHymn(db, { title: "Alleluia" }) }),
        deepAndWide: seedSong(db, { hymnId: seedHymn(db, { title: "Deep and Wide" }) }),
        jesusLovesMe: seedSong(db, { hymnId: seedHymn(db, { title: "Jesus Loves Me" }) }),
        unplaced: seedSong(db, { hymnId: seedHymn(db, { title: "Be Thou My Vision" }) }),
    };
    const entries = {
        amazingGrace: seedEntry(db, { bookId: books.rejoice, songId: songs.amazingGrace, number: 108 }),
        descant: seedEntry(db, {
            bookId: books.rejoice,
            songId: songs.amazingGrace,
            number: 109,
            variantNote: "Descant",
        }),
        charge: seedEntry(db, { bookId: books.rejoice, songId: songs.charge, number: 396 }),
        alleluia: seedEntry(db, { bookId: books.chorus, songId: songs.alleluia, position: 1 }),
        deepAndWide: seedEntry(db, { bookId: books.chorus, songId: songs.deepAndWide, position: 2 }),
        jesusLovesMe: seedEntry(db, { bookId: books.chorus, songId: songs.jesusLovesMe, position: 3 }),
    };
    return { books, songs, entries };
}

/** A book's entries as [entry id, position], in its order. */
function order(bookId: number): [number, number | null][] {
    return db
        .prepare("SELECT id, position FROM entries WHERE book_id = ? ORDER BY position, id")
        .all(bookId)
        .map((row) => [Number(row.id), row.position === null ? null : Number(row.position)]);
}

function entryRow(entryId: number) {
    return db
        .prepare("SELECT book_id, song_id, number, position, location_label, variant_note FROM entries WHERE id = ?")
        .get(entryId);
}

function entryCount(): number {
    return Number(db.prepare("SELECT count(*) AS n FROM entries").get()?.n);
}

function newEntry(fields: Partial<NewEntryInput> & Pick<NewEntryInput, "songId" | "bookId">): NewEntryInput {
    return { placement: { kind: "end" }, variantNote: null, ...fields };
}

const at = (number: number): EntryPlacement => ({ kind: "number", number });

describe("addEntry", () => {
    test("adds a song to a numbered book at a number", () => {
        const { books, songs } = seed();
        const result = addEntry(db, newEntry({ songId: songs.unplaced, bookId: books.rejoice, placement: at(400) }));
        expect(result).toEqual({ ok: true, entryId: expect.any(Number), label: "R-400" });
        expect(findCatalogSong(db, songs.unplaced)?.entries.map(({ label }) => label)).toEqual(["R-400"]);
    });

    test("adds a song to a numbered book at a location", () => {
        const { books, songs } = seed();
        const result = addEntry(
            db,
            newEntry({
                songId: songs.unplaced,
                bookId: books.rejoice,
                placement: { kind: "location", locationLabel: "front cover" },
            })
        );
        expect(result).toMatchObject({ ok: true, label: "R-Front Cover" });
        if (result.ok) {
            expect(entryRow(result.entryId)).toMatchObject({ number: null, position: null, location_label: "front cover" });
        }
    });

    test("adds a variant entry beside a song's plain one", () => {
        const { books, songs } = seed();
        expect(
            addEntry(
                db,
                newEntry({ songId: songs.charge, bookId: books.rejoice, placement: at(397), variantNote: "Descant" })
            )
        ).toMatchObject({ ok: true, label: "R-397" });
    });

    test("appends to a book without numbers", () => {
        const { books, songs, entries } = seed();
        const result = addEntry(db, newEntry({ songId: songs.unplaced, bookId: books.chorus }));
        expect(result).toMatchObject({ ok: true, label: "Chorus Book" });
        const entryId = result.ok ? result.entryId : 0;
        expect(order(books.chorus)).toEqual([
            [entries.alleluia, 1],
            [entries.deepAndWide, 2],
            [entries.jesusLovesMe, 3],
            [entryId, 4],
        ]);
    });

    test("inserts at a position in a book without numbers, moving the rest down", () => {
        const { books, songs, entries } = seed();
        const result = addEntry(
            db,
            newEntry({ songId: songs.unplaced, bookId: books.chorus, placement: { kind: "position", position: 2 } })
        );
        const entryId = result.ok ? result.entryId : 0;
        expect(order(books.chorus)).toEqual([
            [entries.alleluia, 1],
            [entryId, 2],
            [entries.deepAndWide, 3],
            [entries.jesusLovesMe, 4],
        ]);
    });

    test("puts a position past the end at the end", () => {
        const { books, songs } = seed();
        const result = addEntry(
            db,
            newEntry({ songId: songs.unplaced, bookId: books.chorus, placement: { kind: "position", position: 99 } })
        );
        expect(result.ok && entryRow(result.entryId)?.position).toBe(4);
    });

    test("refuses a number another song has, naming it", () => {
        const { books, songs } = seed();
        expect(
            addEntry(db, newEntry({ songId: songs.unplaced, bookId: books.rejoice, placement: at(396) }))
        ).toEqual({
            ok: false,
            problems: [
                {
                    reason: "number-taken",
                    part: "placement",
                    message: 'R-396 is taken by "A Charge to Keep I Have (BOYLSTON)".',
                    existing: { kind: "song", songId: songs.charge, label: "A Charge to Keep I Have (BOYLSTON)" },
                },
            ],
        });
    });

    test("refuses a second plain entry of a song in a book, naming the first", () => {
        const { books, songs } = seed();
        expect(
            addEntry(db, newEntry({ songId: songs.amazingGrace, bookId: books.rejoice, placement: at(500) }))
        ).toEqual({
            ok: false,
            problems: [
                {
                    reason: "song-already-in-book",
                    part: "variantNote",
                    message:
                        'This song is already in Rejoice Hymns as R-108. Give this entry a variant note, such as "Descant", to tell the two apart.',
                    existing: null,
                },
            ],
        });
        expect(addEntry(db, newEntry({ songId: songs.alleluia, bookId: books.chorus }))).toMatchObject({
            ok: false,
            problems: [{ reason: "song-already-in-book", message: expect.stringContaining("in Chorus Book at position 1.") }],
        });
    });

    test("refuses a second entry with the same variant note", () => {
        const { books, songs } = seed();
        expect(
            addEntry(
                db,
                newEntry({ songId: songs.amazingGrace, bookId: books.rejoice, placement: at(500), variantNote: "Descant" })
            )
        ).toMatchObject({
            ok: false,
            problems: [
                {
                    reason: "song-already-in-book",
                    message: 'This song is already in Rejoice Hymns as R-109 with the variant note "Descant".',
                },
            ],
        });
    });

    test("gives every problem at once: a taken number and a song already in the book", () => {
        const { books, songs } = seed();
        const result = addEntry(db, newEntry({ songId: songs.amazingGrace, bookId: books.rejoice, placement: at(396) }));
        expect(result.ok ? [] : result.problems.map(({ reason }) => reason)).toEqual([
            "number-taken",
            "song-already-in-book",
        ]);
    });

    test("refuses a placement the book does not take", () => {
        const { books, songs } = seed();
        expect(addEntry(db, newEntry({ songId: songs.unplaced, bookId: books.rejoice }))).toEqual({
            ok: false,
            problems: [
                {
                    reason: "entry-not-placed",
                    part: "placement",
                    message: "Rejoice Hymns numbers its songs: give the song's number, or where the book has it.",
                    existing: null,
                },
            ],
        });
        expect(
            addEntry(db, newEntry({ songId: songs.unplaced, bookId: books.chorus, placement: at(4) }))
        ).toMatchObject({
            ok: false,
            problems: [
                {
                    reason: "entry-not-placed",
                    message: "Chorus Book has no numbers: place the song by its position in the book.",
                },
            ],
        });
    });

    test("refuses a song or a book that is not in the catalog", () => {
        seed();
        expect(addEntry(db, newEntry({ songId: 999, bookId: 999, placement: at(1) }))).toEqual({
            ok: false,
            problems: [
                { reason: "song-not-found", part: "song", message: "That song is not in the catalog.", existing: null },
                {
                    reason: "book-not-found",
                    part: "book",
                    message: "That book is not in the catalog. Choose one from the list.",
                    existing: null,
                },
            ],
        });
    });

    test("writes nothing when it refuses", () => {
        const { books, songs } = seed();
        const before = entryCount();
        addEntry(db, newEntry({ songId: songs.alleluia, bookId: books.chorus, placement: { kind: "position", position: 1 } }));
        expect(entryCount()).toBe(before);
    });
});

describe("editEntry", () => {
    test("changes a number, keeping a number the entry itself has", () => {
        const { entries } = seed();
        expect(editEntry(db, { entryId: entries.charge, placement: at(397), variantNote: null })).toEqual({
            ok: true,
            entryId: entries.charge,
            label: "R-397",
        });
        expect(editEntry(db, { entryId: entries.charge, placement: at(397), variantNote: null })).toMatchObject({
            ok: true,
        });
        expect(entryRow(entries.charge)).toMatchObject({ number: 397 });
    });

    test("moves an entry from a number to a location and back", () => {
        const { entries } = seed();
        editEntry(db, {
            entryId: entries.charge,
            placement: { kind: "location", locationLabel: "back cover" },
            variantNote: null,
        });
        expect(entryRow(entries.charge)).toMatchObject({ number: null, location_label: "back cover" });
        editEntry(db, { entryId: entries.charge, placement: at(396), variantNote: null });
        expect(entryRow(entries.charge)).toMatchObject({ number: 396, location_label: null });
    });

    test("changes the variant note", () => {
        const { entries } = seed();
        expect(
            editEntry(db, { entryId: entries.descant, placement: at(109), variantNote: "Descant - last stanza only" })
        ).toMatchObject({ ok: true });
        expect(entryRow(entries.descant)).toMatchObject({ variant_note: "Descant - last stanza only" });
    });

    test("refuses a number another entry has, and a variant note that makes a twin", () => {
        const { entries } = seed();
        expect(editEntry(db, { entryId: entries.descant, placement: at(396), variantNote: null })).toMatchObject({
            ok: false,
            problems: [{ reason: "number-taken" }, { reason: "song-already-in-book" }],
        });
        expect(entryRow(entries.descant)).toMatchObject({ number: 109, variant_note: "Descant" });
    });

    test("moves an entry of a book without numbers to a position, and to the end", () => {
        const { books, entries } = seed();
        editEntry(db, { entryId: entries.jesusLovesMe, placement: { kind: "position", position: 1 }, variantNote: null });
        expect(order(books.chorus)).toEqual([
            [entries.jesusLovesMe, 1],
            [entries.alleluia, 2],
            [entries.deepAndWide, 3],
        ]);
        editEntry(db, { entryId: entries.jesusLovesMe, placement: { kind: "end" }, variantNote: "A Round" });
        expect(order(books.chorus)).toEqual([
            [entries.alleluia, 1],
            [entries.deepAndWide, 2],
            [entries.jesusLovesMe, 3],
        ]);
        expect(entryRow(entries.jesusLovesMe)).toMatchObject({ variant_note: "A Round" });
    });

    test("refuses a placement the book does not take, and an entry that is not there", () => {
        const { entries } = seed();
        expect(editEntry(db, { entryId: entries.alleluia, placement: at(1), variantNote: null })).toMatchObject({
            ok: false,
            problems: [{ reason: "entry-not-placed" }],
        });
        expect(editEntry(db, { entryId: 999, placement: at(1), variantNote: null })).toEqual({
            ok: false,
            problems: [
                {
                    reason: "entry-not-found",
                    part: "entry",
                    message: "That entry is not in the catalog. It may have been deleted.",
                    existing: null,
                },
            ],
        });
    });
});

describe("deleteEntry", () => {
    test("deletes an entry of a numbered book", () => {
        const { songs, entries } = seed();
        expect(deleteEntry(db, entries.descant)).toEqual({ ok: true, songId: songs.amazingGrace, label: "R-109" });
        expect(entryRow(entries.descant)).toBeUndefined();
    });

    test("closes the gap in a book without numbers", () => {
        const { books, entries } = seed();
        deleteEntry(db, entries.alleluia);
        expect(order(books.chorus)).toEqual([
            [entries.deepAndWide, 1],
            [entries.jesusLovesMe, 2],
        ]);
    });

    test("refuses an entry that is not there", () => {
        seed();
        expect(deleteEntry(db, 999)).toMatchObject({ ok: false, problems: [{ reason: "entry-not-found" }] });
    });
});

describe("moveEntry", () => {
    test("swaps an entry with the one above or below it", () => {
        const { books, entries } = seed();
        expect(moveEntry(db, entries.deepAndWide, "up")).toEqual({ ok: true, changed: true, position: 1 });
        expect(order(books.chorus)).toEqual([
            [entries.deepAndWide, 1],
            [entries.alleluia, 2],
            [entries.jesusLovesMe, 3],
        ]);
        expect(moveEntry(db, entries.alleluia, "down")).toEqual({ ok: true, changed: true, position: 3 });
        expect(order(books.chorus)).toEqual([
            [entries.deepAndWide, 1],
            [entries.jesusLovesMe, 2],
            [entries.alleluia, 3],
        ]);
    });

    test("leaves the first entry where it is when moved up, and the last when moved down", () => {
        const { entries } = seed();
        expect(moveEntry(db, entries.alleluia, "up")).toEqual({ ok: true, changed: false, position: 1 });
        expect(moveEntry(db, entries.jesusLovesMe, "down")).toEqual({ ok: true, changed: false, position: 3 });
    });

    test("refuses an entry of a numbered book, and one that is not there", () => {
        const { entries } = seed();
        expect(moveEntry(db, entries.charge, "up")).toMatchObject({
            ok: false,
            problems: [
                {
                    reason: "entry-not-placed",
                    message: "Rejoice Hymns numbers its songs: change the entry's number instead.",
                },
            ],
        });
        expect(moveEntry(db, 999, "down")).toMatchObject({ ok: false, problems: [{ reason: "entry-not-found" }] });
    });

    test("makes positions with gaps 1, 2, 3, … once it moves an entry", () => {
        const { books, entries } = seed();
        db.prepare("UPDATE entries SET position = position * 10 WHERE book_id = ?").run(books.chorus);
        moveEntry(db, entries.jesusLovesMe, "up");
        expect(order(books.chorus)).toEqual([
            [entries.alleluia, 1],
            [entries.jesusLovesMe, 2],
            [entries.deepAndWide, 3],
        ]);
    });
});

/**
 * Three hymns and two tunes: "Rejoice - the Lord Is King" (also "Rejoice,
 * the Lord Is King") to DARWALL (also DARWAL), Amazing Grace to NEW
 * BRITAIN, and "Is Your All on the Alter?" with no tune.
 */
function seedNames() {
    const tunes = {
        darwall: seedTune(db, { name: "DARWALL", aliases: ["DARWAL"] }),
        newBritain: seedTune(db, { name: "NEW BRITAIN", meter: "CM" }),
    };
    const hymns = {
        rejoice: seedHymn(db, {
            title: "Rejoice - the Lord Is King",
            aliases: ["Rejoice, the Lord Is King"],
        }),
        amazingGrace: seedHymn(db, { title: "Amazing Grace", firstLine: "Amazing grace! how sweet the sound" }),
        alter: seedHymn(db, { title: "Is Your All on the Alter?" }),
    };
    const songs = {
        rejoice: seedSong(db, { hymnId: hymns.rejoice, tuneId: tunes.darwall }),
        amazingGrace: seedSong(db, { hymnId: hymns.amazingGrace, tuneId: tunes.newBritain }),
        alter: seedSong(db, { hymnId: hymns.alter }),
    };
    return { tunes, hymns, songs };
}

function hymnRow(hymnId: number) {
    return db.prepare("SELECT title, first_line, notes FROM hymns WHERE id = ?").get(hymnId);
}

function tuneRow(tuneId: number) {
    return db.prepare("SELECT name, meter, notes FROM tunes WHERE id = ?").get(tuneId);
}

function hymnAliases(hymnId: number): string[] {
    return db
        .prepare("SELECT alias FROM hymn_aliases WHERE hymn_id = ? ORDER BY alias")
        .all(hymnId)
        .map((row) => String(row.alias));
}

function tuneAliases(tuneId: number): string[] {
    return db
        .prepare("SELECT alias FROM tune_aliases WHERE tune_id = ? ORDER BY alias")
        .all(tuneId)
        .map((row) => String(row.alias));
}

describe("editHymn", () => {
    test("changes the title, first line and notes, leaving no old title behind when nothing matches it", () => {
        const { hymns } = seedNames();
        expect(
            editHymn(db, {
                hymnId: hymns.alter,
                title: "Is Your All on the Altar?",
                firstLine: "You have longed for sweet peace",
                notes: "Elisha Hoffman, 1900",
            })
        ).toEqual({ ok: true, hymnId: hymns.alter, aliasKept: null, aliasDropped: null });
        expect(hymnRow(hymns.alter)).toEqual({
            title: "Is Your All on the Altar?",
            first_line: "You have longed for sweet peace",
            notes: "Elisha Hoffman, 1900",
        });
        expect(hymnAliases(hymns.alter)).toEqual([]);
    });

    test("keeps the old title as another title when a Planning Center song is titled that way", () => {
        const { hymns } = seedNames();
        seedPcoSong(db, { title: "Is Your All on the Alter" });
        expect(
            editHymn(db, { hymnId: hymns.alter, title: "Is Your All on the Altar?", firstLine: null, notes: null })
        ).toMatchObject({ ok: true, aliasKept: "Is Your All on the Alter?", aliasDropped: null });
        expect(hymnAliases(hymns.alter)).toEqual(["Is Your All on the Alter?"]);
    });

    test("keeps it for a title that matches before a trailing parenthetical, and for a linked song", () => {
        const { hymns, songs } = seedNames();
        seedPcoSong(db, { title: "Amazing Grace (NEW BRITAIN)" });
        expect(
            editHymn(db, { hymnId: hymns.amazingGrace, title: "Amazing Grace! How Sweet the Sound", firstLine: null, notes: null })
        ).toMatchObject({ ok: true, aliasKept: "Amazing Grace" });

        const linked = seedPcoSong(db, { title: "Is Your All on the Alter?" });
        db.prepare("UPDATE songs SET pco_song_id = ? WHERE id = ?").run(linked, songs.alter);
        expect(
            editHymn(db, { hymnId: hymns.alter, title: "Is Your All on the Altar?", firstLine: null, notes: null })
        ).toMatchObject({ ok: true, aliasKept: "Is Your All on the Alter?" });
    });

    test("does not keep it for a song deleted from Planning Center or ignored", () => {
        const { hymns } = seedNames();
        seedPcoSong(db, { title: "Is Your All on the Alter?", removedAt: "2026-10-01T00:00:00.000Z" });
        seedPcoSong(db, { title: "Is Your All on the Alter", ignoredAt: "2026-10-01T00:00:00.000Z" });
        expect(
            editHymn(db, { hymnId: hymns.alter, title: "Is Your All on the Altar?", firstLine: null, notes: null })
        ).toMatchObject({ ok: true, aliasKept: null });
        expect(hymnAliases(hymns.alter)).toEqual([]);
    });

    test("keeps nothing for a title that changes only in case or punctuation", () => {
        const { hymns } = seedNames();
        seedPcoSong(db, { title: "Amazing Grace" });
        expect(
            editHymn(db, { hymnId: hymns.amazingGrace, title: "amazing grace!", firstLine: null, notes: null })
        ).toMatchObject({ ok: true, aliasKept: null, aliasDropped: null });
        expect(hymnRow(hymns.amazingGrace)).toMatchObject({ title: "amazing grace!", first_line: null });
    });

    test("drops another title that the new title now is", () => {
        const { hymns } = seedNames();
        seedPcoSong(db, { title: "Rejoice - the Lord Is King!" });
        expect(
            editHymn(db, { hymnId: hymns.rejoice, title: "Rejoice, the Lord Is King", firstLine: null, notes: null })
        ).toMatchObject({
            ok: true,
            aliasKept: "Rejoice - the Lord Is King",
            aliasDropped: "Rejoice, the Lord Is King",
        });
        expect(hymnAliases(hymns.rejoice)).toEqual(["Rejoice - the Lord Is King"]);
    });

    test("refuses a title another hymn has, or has as another title, pointing at it", () => {
        const { hymns, songs } = seedNames();
        expect(
            editHymn(db, { hymnId: hymns.alter, title: "Amazing  Grace", firstLine: null, notes: null })
        ).toEqual({
            ok: false,
            problems: [
                {
                    reason: "name-taken",
                    part: "title",
                    message:
                        'The catalog already has a hymn titled "Amazing Grace". To make the two one, merge this hymn into it.',
                    existing: { kind: "song", songId: songs.amazingGrace, label: "Amazing Grace (NEW BRITAIN)" },
                },
            ],
        });
        expect(
            editHymn(db, { hymnId: hymns.alter, title: "Rejoice, the Lord Is King!", firstLine: null, notes: null })
        ).toMatchObject({
            ok: false,
            problems: [
                {
                    reason: "name-taken",
                    message:
                        '"Rejoice, the Lord Is King" is another title of "Rejoice - the Lord Is King". To make the two one, merge this hymn into it.',
                },
            ],
        });
        expect(hymnRow(hymns.alter)).toMatchObject({ title: "Is Your All on the Alter?" });
    });

    test("refuses a hymn that is not in the catalog", () => {
        expect(editHymn(db, { hymnId: 999, title: "X", firstLine: null, notes: null })).toEqual({
            ok: false,
            problems: [
                { reason: "hymn-not-found", part: "hymn", message: "That hymn is not in the catalog.", existing: null },
            ],
        });
    });
});

describe("editTune", () => {
    test("changes the name, meter and notes", () => {
        const { tunes } = seedNames();
        expect(
            editTune(db, { tuneId: tunes.newBritain, name: "NEW BRITAIN (AMAZING GRACE)", meter: "C.M.", notes: "American" })
        ).toEqual({ ok: true, tuneId: tunes.newBritain, aliasKept: null, aliasDropped: null });
        expect(tuneRow(tunes.newBritain)).toEqual({
            name: "NEW BRITAIN (AMAZING GRACE)",
            meter: "C.M.",
            notes: "American",
        });
    });

    test("keeps the old name when a Planning Center song names it in a parenthetical", () => {
        const { tunes } = seedNames();
        seedPcoSong(db, { title: "Amazing Grace (New Britain)" });
        expect(
            editTune(db, { tuneId: tunes.newBritain, name: "AMAZING GRACE", meter: null, notes: null })
        ).toMatchObject({ ok: true, aliasKept: "NEW BRITAIN" });
        expect(tuneAliases(tunes.newBritain)).toEqual(["NEW BRITAIN"]);
    });

    test("drops another name that the new name now is, and refuses a name another tune has", () => {
        const { tunes } = seedNames();
        expect(editTune(db, { tuneId: tunes.darwall, name: "Darwal", meter: null, notes: null })).toMatchObject({
            ok: true,
            aliasKept: null,
            aliasDropped: "DARWAL",
        });
        expect(tuneAliases(tunes.darwall)).toEqual([]);
        expect(
            editTune(db, { tuneId: tunes.darwall, name: "new  britain", meter: null, notes: null })
        ).toEqual({
            ok: false,
            problems: [
                {
                    reason: "name-taken",
                    part: "name",
                    message: "The catalog already has the tune NEW BRITAIN. To make the two one, merge this tune into it.",
                    existing: { kind: "tune", tuneId: tunes.newBritain, label: "NEW BRITAIN" },
                },
            ],
        });
        expect(editTune(db, { tuneId: 999, name: "X", meter: null, notes: null })).toMatchObject({
            ok: false,
            problems: [{ reason: "tune-not-found", part: "tune" }],
        });
    });
});

describe("addHymnAlias and removeHymnAlias", () => {
    test("add another title, and remove it by any spelling of it", () => {
        const { hymns } = seedNames();
        expect(addHymnAlias(db, { hymnId: hymns.amazingGrace, alias: "Amazing Grace! How Sweet the Sound" })).toEqual({
            ok: true,
            alias: "Amazing Grace! How Sweet the Sound",
        });
        expect(hymnAliases(hymns.amazingGrace)).toEqual(["Amazing Grace! How Sweet the Sound"]);
        expect(removeHymnAlias(db, { hymnId: hymns.amazingGrace, alias: "amazing grace!  how sweet the sound" })).toEqual({
            ok: true,
            alias: "Amazing Grace! How Sweet the Sound",
        });
        expect(hymnAliases(hymns.amazingGrace)).toEqual([]);
    });

    test("refuse the hymn's own title, a title it has already, and another hymn's", () => {
        const { hymns, songs } = seedNames();
        const refusal = (alias: string) => {
            const result = addHymnAlias(db, { hymnId: hymns.rejoice, alias });
            return result.ok ? null : result.problems[0];
        };
        expect(refusal("rejoice - the lord is king")).toMatchObject({
            reason: "alias-is-name",
            part: "alias",
            message: '"rejoice - the lord is king" is the hymn\'s title.',
        });
        expect(refusal("Rejoice, the Lord Is King!")).toMatchObject({
            reason: "alias-exists",
            message: '"Rejoice, the Lord Is King" is already another title of this hymn.',
        });
        expect(refusal("Amazing Grace")).toMatchObject({
            reason: "name-taken",
            existing: { kind: "song", songId: songs.amazingGrace },
        });
        db.prepare("INSERT INTO hymn_aliases (hymn_id, alias, normalized) VALUES (?, 'Grace', 'grace')").run(
            hymns.amazingGrace
        );
        expect(refusal("Grace")).toMatchObject({
            reason: "name-taken",
            message: '"Grace" is another title of "Amazing Grace". To make the two one, merge this hymn into it.',
        });
        expect(hymnAliases(hymns.rejoice)).toEqual(["Rejoice, the Lord Is King"]);
    });

    test("refuse a hymn that is not there, and a title it does not have", () => {
        const { hymns } = seedNames();
        expect(addHymnAlias(db, { hymnId: 999, alias: "X" })).toMatchObject({
            ok: false,
            problems: [{ reason: "hymn-not-found", part: "hymn", message: "That hymn is not in the catalog." }],
        });
        expect(removeHymnAlias(db, { hymnId: hymns.alter, alias: "Nothing" })).toEqual({
            ok: false,
            problems: [
                {
                    reason: "alias-not-found",
                    part: "alias",
                    message: '"Nothing" is not another title of this hymn. It may have been removed already.',
                    existing: null,
                },
            ],
        });
    });
});

describe("addTuneAlias and removeTuneAlias", () => {
    test("add another name, refuse names that are taken, and remove it", () => {
        const { tunes } = seedNames();
        expect(addTuneAlias(db, { tuneId: tunes.newBritain, alias: "Amazing Grace" })).toEqual({
            ok: true,
            alias: "Amazing Grace",
        });
        expect(addTuneAlias(db, { tuneId: tunes.newBritain, alias: "AMAZING GRACE" })).toMatchObject({
            ok: false,
            problems: [{ reason: "alias-exists", message: "Amazing Grace is already another name of this tune." }],
        });
        expect(addTuneAlias(db, { tuneId: tunes.newBritain, alias: "new britain" })).toMatchObject({
            ok: false,
            problems: [{ reason: "alias-is-name", message: "new britain is the tune's name." }],
        });
        expect(addTuneAlias(db, { tuneId: tunes.newBritain, alias: "darwal" })).toMatchObject({
            ok: false,
            problems: [
                {
                    reason: "name-taken",
                    message: "DARWAL is another name of the tune DARWALL. To make the two one, merge this tune into it.",
                    existing: { kind: "tune", tuneId: tunes.darwall, label: "DARWALL" },
                },
            ],
        });
        expect(removeTuneAlias(db, { tuneId: tunes.newBritain, alias: "amazing grace" })).toEqual({
            ok: true,
            alias: "Amazing Grace",
        });
        expect(removeTuneAlias(db, { tuneId: tunes.newBritain, alias: "Amazing Grace" })).toMatchObject({
            ok: false,
            problems: [{ reason: "alias-not-found" }],
        });
        expect(addTuneAlias(db, { tuneId: 999, alias: "X" })).toMatchObject({
            ok: false,
            problems: [{ reason: "tune-not-found", part: "tune", message: "That tune is not in the catalog." }],
        });
    });
});
