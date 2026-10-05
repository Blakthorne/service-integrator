import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { findCatalogSong, findTune } from "./catalog";
import {
    applyHymnMerge,
    applyTuneMerge,
    previewHymnMerge,
    previewTuneMerge,
    readMergeHymn,
} from "./catalogMerge";
import {
    openTestDb,
    seedBook,
    seedEntry,
    seedHymn,
    seedPcoSong,
    seedSong,
    seedSongMark,
    seedTune,
} from "./testing";

let db: DatabaseSync;

beforeEach(() => {
    db = openTestDb();
});

afterEach(() => {
    db.close();
});

const LINKED_AT = "2026-10-01T09:00:00.000Z";

/**
 * Two spellings of one hymn, each sung to DARWALL, and the first to GOPSAL
 * too; each also has a song with no tune. The source's DARWALL song is in
 * Great Hymns (G-143) and linked to a Planning Center song; the target's is
 * in Rejoice (R-43). Another hymn, Ye Holy Angels Bright, is sung to
 * DARWALL.
 */
function seed() {
    const books = {
        rejoice: seedBook(db, { code: "R", name: "Rejoice Hymns" }),
        great: seedBook(db, { code: "G", name: "Great Hymns of the Faith" }),
    };
    const tunes = {
        darwall: seedTune(db, { name: "DARWALL", meter: "6.6.6.6.8.8" }),
        gopsal: seedTune(db, { name: "GOPSAL" }),
        darwal: seedTune(db, { name: "DARWAL", notes: "A misspelling" }),
    };
    const hymns = {
        source: seedHymn(db, {
            title: "Rejoice - the Lord Is King",
            firstLine: "Rejoice, the Lord is King!",
            notes: "Charles Wesley",
            aliases: ["Rejoice! The Lord Is King"],
        }),
        target: seedHymn(db, { title: "Rejoice, the Lord Is King", notes: "From Hymns for Our Lord's Resurrection" }),
        angels: seedHymn(db, { title: "Ye Holy Angels Bright" }),
    };
    seedPcoSong(db, { id: "1001", title: "Rejoice the Lord Is King" });
    const songs = {
        sourceDarwall: seedSong(db, {
            hymnId: hymns.source,
            tuneId: tunes.darwall,
            pcoSongId: "1001",
            linkedAt: LINKED_AT,
            linkedBy: "auto",
            notes: "Sing stanza 4 a cappella",
        }),
        sourceGopsal: seedSong(db, { hymnId: hymns.source, tuneId: tunes.gopsal }),
        sourceNoTune: seedSong(db, { hymnId: hymns.source }),
        targetDarwall: seedSong(db, { hymnId: hymns.target, tuneId: tunes.darwall, notes: "Brass on the last stanza" }),
        targetNoTune: seedSong(db, { hymnId: hymns.target }),
        angels: seedSong(db, { hymnId: hymns.angels, tuneId: tunes.darwal }),
    };
    const entries = {
        sourceDarwall: seedEntry(db, { bookId: books.great, songId: songs.sourceDarwall, number: 143 }),
        sourceGopsal: seedEntry(db, { bookId: books.rejoice, songId: songs.sourceGopsal, number: 44 }),
        sourceNoTune: seedEntry(db, { bookId: books.great, songId: songs.sourceNoTune, number: 144 }),
        targetDarwall: seedEntry(db, { bookId: books.rejoice, songId: songs.targetDarwall, number: 43 }),
        targetNoTune: seedEntry(db, { bookId: books.rejoice, songId: songs.targetNoTune, number: 45 }),
        angels: seedEntry(db, { bookId: books.rejoice, songId: songs.angels, number: 300 }),
    };
    return { books, tunes, hymns, songs, entries };
}

function count(table: string): number {
    return Number(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n);
}

/** Every table's rows, to show a refused merge writes nothing. */
function snapshot() {
    return Object.fromEntries(
        ["hymns", "hymn_aliases", "tunes", "tune_aliases", "songs", "entries", "song_marks"].map((table) => [
            table,
            db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
        ])
    );
}

function aliases(table: "hymn_aliases" | "tune_aliases", owner: "hymn_id" | "tune_id", id: number) {
    return db
        .prepare(`SELECT alias, normalized FROM ${table} WHERE ${owner} = ? ORDER BY alias`)
        .all(id);
}

describe("applyHymnMerge", () => {
    test("moves and merges the songs, gives the target the source's names and fields, and deletes the source", () => {
        const { hymns, songs, entries } = seed();
        const result = applyHymnMerge(db, hymns.source, hymns.target);
        expect(result).toMatchObject({
            ok: true,
            preview: {
                kind: "hymn",
                moves: [{ songId: songs.sourceGopsal, to: "Rejoice, the Lord Is King (GOPSAL)" }],
                merges: [
                    {
                        sourceSongId: songs.sourceDarwall,
                        targetSongId: songs.targetDarwall,
                        entries: ["G-143"],
                        notes: true,
                        link: { pcoSongId: "1001", title: "Rejoice the Lord Is King" },
                    },
                    {
                        sourceSongId: songs.sourceNoTune,
                        targetSongId: songs.targetNoTune,
                        entries: ["G-144"],
                    },
                ],
                aliasesAdded: ["Rejoice - the Lord Is King", "Rejoice! The Lord Is King"],
                detailTaken: "Rejoice, the Lord is King!",
                notesAdded: true,
                refusals: [],
            },
        });

        expect(db.prepare("SELECT id FROM hymns WHERE id = ?").get(hymns.source)).toBeUndefined();
        expect(
            db.prepare("SELECT id FROM songs WHERE id IN (?, ?)").all(songs.sourceDarwall, songs.sourceNoTune)
        ).toEqual([]);

        const target = findCatalogSong(db, songs.targetDarwall)!;
        expect(target.hymn).toEqual({
            id: hymns.target,
            title: "Rejoice, the Lord Is King",
            firstLine: "Rejoice, the Lord is King!",
            notes: "From Hymns for Our Lord's Resurrection\n\nCharles Wesley",
            aliases: ["Rejoice - the Lord Is King", "Rejoice! The Lord Is King"],
        });
        expect(target.entries.map(({ id, label }) => [id, label])).toEqual([
            [entries.targetDarwall, "R-43"],
            [entries.sourceDarwall, "G-143"],
        ]);
        expect(target).toMatchObject({
            pcoSongId: "1001",
            linkedAt: LINKED_AT,
            linkedBy: "auto",
            notes: "Brass on the last stanza\n\nSing stanza 4 a cappella",
        });
        expect(target.otherTunes.map(({ id, tuneName }) => [id, tuneName])).toEqual([
            [songs.sourceGopsal, "GOPSAL"],
            [songs.targetNoTune, null],
        ]);
        expect(findCatalogSong(db, songs.targetNoTune)?.entries.map(({ label }) => label)).toEqual(["R-45", "G-144"]);
        expect(aliases("hymn_aliases", "hymn_id", hymns.target)).toEqual([
            { alias: "Rejoice - the Lord Is King", normalized: "rejoice - the lord is king" },
            { alias: "Rejoice! The Lord Is King", normalized: "rejoice! the lord is king" },
        ]);
    });

    test("moves a song with no tune when the target has none (the partial index on tune-less songs)", () => {
        const { hymns, songs } = seed();
        db.prepare("DELETE FROM entries WHERE song_id = ?").run(songs.targetNoTune);
        db.prepare("DELETE FROM songs WHERE id = ?").run(songs.targetNoTune);
        const result = applyHymnMerge(db, hymns.source, hymns.target);
        expect(result.ok && result.preview.moves.map(({ songId }) => songId)).toEqual([
            songs.sourceGopsal,
            songs.sourceNoTune,
        ]);
        expect(
            db.prepare("SELECT hymn_id FROM songs WHERE tune_id IS NULL").all()
        ).toEqual([{ hymn_id: hymns.target }]);
    });

    test("moves the marks the target song lacks, fills an empty note, and keeps marks it does not know", () => {
        const { hymns, songs } = seed();
        seedSongMark(db, songs.sourceDarwall, { note: "For Easter" });
        seedSongMark(db, songs.sourceDarwall, { mark: "newer-mark" });
        seedSongMark(db, songs.targetDarwall, { note: null, createdAt: "2026-09-01T00:00:00.000Z" });
        seedSongMark(db, songs.sourceNoTune);
        applyHymnMerge(db, hymns.source, hymns.target);
        expect(
            db.prepare("SELECT song_id, mark, note, created_at FROM song_marks ORDER BY song_id, mark").all()
        ).toEqual([
            { song_id: songs.targetDarwall, mark: "newer-mark", note: null, created_at: "2026-10-04T12:00:00.000Z" },
            { song_id: songs.targetDarwall, mark: "to-learn", note: "For Easter", created_at: "2026-09-01T00:00:00.000Z" },
            { song_id: songs.targetNoTune, mark: "to-learn", note: null, created_at: "2026-10-04T12:00:00.000Z" },
        ]);
    });

    test("refuses, writing nothing, two songs that would merge linked to different Planning Center songs", () => {
        const { hymns, songs } = seed();
        seedPcoSong(db, { id: "2002", title: "Rejoice, the Lord Is King" });
        db.prepare("UPDATE songs SET pco_song_id = '2002' WHERE id = ?").run(songs.targetDarwall);
        const before = snapshot();
        expect(applyHymnMerge(db, hymns.source, hymns.target)).toMatchObject({
            ok: false,
            reason: "refused",
            preview: {
                refusals: [
                    {
                        reason: "linked-apart",
                        songIds: [songs.sourceDarwall, songs.targetDarwall],
                    },
                ],
            },
        });
        expect(snapshot()).toEqual(before);
    });

    test("refuses, writing nothing, a merged song with two plain entries in one book (the partial index on plain entries)", () => {
        const { hymns, books, songs } = seed();
        seedEntry(db, { bookId: books.rejoice, songId: songs.sourceDarwall, number: 42 });
        const before = snapshot();
        expect(applyHymnMerge(db, hymns.source, hymns.target)).toMatchObject({
            ok: false,
            reason: "refused",
            preview: {
                refusals: [
                    {
                        reason: "entry-collision",
                        message:
                            '"Rejoice, the Lord Is King (DARWALL)" would be in Rejoice Hymns twice: R-43 and R-42. Delete one of the entries, or give one a variant note, first.',
                    },
                ],
            },
        });
        expect(snapshot()).toEqual(before);
    });

    test("merges two songs whose entries in one book have different variant notes", () => {
        const { hymns, books, songs } = seed();
        seedEntry(db, { bookId: books.rejoice, songId: songs.sourceDarwall, number: 42, variantNote: "Descant" });
        expect(applyHymnMerge(db, hymns.source, hymns.target)).toMatchObject({ ok: true });
        expect(findCatalogSong(db, songs.targetDarwall)?.entries.map(({ label }) => label)).toEqual([
            "R-42",
            "R-43",
            "G-143",
        ]);
    });

    test("refuses a hymn merged into itself, and a hymn that is not there", () => {
        const { hymns } = seed();
        expect(applyHymnMerge(db, hymns.source, hymns.source)).toMatchObject({
            ok: false,
            reason: "refused",
            preview: { refusals: [{ reason: "same" }] },
        });
        expect(applyHymnMerge(db, 999, hymns.target)).toEqual({
            ok: false,
            reason: "source-not-found",
            message: "That hymn is not in the catalog. It may have been merged already.",
        });
        expect(applyHymnMerge(db, hymns.source, 999)).toEqual({
            ok: false,
            reason: "target-not-found",
            message: "The hymn to merge into is not in the catalog. Choose another.",
        });
        expect(count("hymns")).toBe(3);
    });

    test("plans afresh when it applies, so a change since the preview counts", () => {
        const { hymns, songs } = seed();
        const preview = previewHymnMerge(db, hymns.source, hymns.target);
        expect(preview.ok && preview.preview.refusals).toEqual([]);
        seedPcoSong(db, { id: "2002", title: "Rejoice, the Lord Is King" });
        db.prepare("UPDATE songs SET pco_song_id = '2002' WHERE id = ?").run(songs.targetDarwall);
        expect(applyHymnMerge(db, hymns.source, hymns.target)).toMatchObject({
            ok: false,
            reason: "refused",
            preview: { refusals: [{ reason: "linked-apart" }] },
        });
    });
});

describe("previewHymnMerge", () => {
    test("plans without writing", () => {
        const { hymns } = seed();
        const before = snapshot();
        const result = previewHymnMerge(db, hymns.source, hymns.target);
        expect(result).toMatchObject({ ok: true, preview: { moves: [expect.anything()], merges: [expect.anything(), expect.anything()] } });
        expect(snapshot()).toEqual(before);
    });

    test("reads a hymn with its songs, their entries in book order, links and marks", () => {
        const { hymns, songs } = seed();
        seedSongMark(db, songs.sourceDarwall, { note: "For Easter" });
        expect(readMergeHymn(db, hymns.source)?.songs[0]).toEqual({
            id: songs.sourceDarwall,
            hymnId: hymns.source,
            title: "Rejoice - the Lord Is King",
            tuneId: expect.any(Number),
            tuneName: "DARWALL",
            pcoSongId: "1001",
            pcoTitle: "Rejoice the Lord Is King",
            notes: "Sing stanza 4 a cappella",
            entries: [
                {
                    id: expect.any(Number),
                    bookId: expect.any(Number),
                    bookName: "Great Hymns of the Faith",
                    label: "G-143",
                    variantNote: null,
                },
            ],
            marks: [{ mark: "to-learn", note: "For Easter", createdAt: "2026-10-04T12:00:00.000Z" }],
        });
        expect(readMergeHymn(db, 999)).toBeNull();
    });
});

describe("applyTuneMerge and previewTuneMerge", () => {
    test("merge a misspelt tune into the right one, keyed by hymn", () => {
        const { tunes, songs } = seed();
        // A song of the target hymn to DARWAL, which merges into its DARWALL song.
        const targetDarwal = seedSong(db, {
            hymnId: db.prepare("SELECT hymn_id FROM songs WHERE id = ?").get(songs.targetDarwall)!.hymn_id as number,
            tuneId: tunes.darwal,
        });
        const preview = previewTuneMerge(db, tunes.darwal, tunes.darwall);
        expect(preview).toMatchObject({
            ok: true,
            preview: {
                kind: "tune",
                moves: [{ songId: songs.angels, from: "Ye Holy Angels Bright (DARWAL)", to: "Ye Holy Angels Bright (DARWALL)" }],
                merges: [{ sourceSongId: targetDarwal, targetSongId: songs.targetDarwall }],
                aliasesAdded: ["DARWAL"],
                detailTaken: null,
                notesAdded: true,
                refusals: [],
            },
        });
        expect(applyTuneMerge(db, tunes.darwal, tunes.darwall)).toMatchObject({ ok: true });
        const darwall = findTune(db, tunes.darwall)!;
        expect(darwall).toMatchObject({
            name: "DARWALL",
            meter: "6.6.6.6.8.8",
            notes: "A misspelling",
            aliases: ["DARWAL"],
        });
        expect(darwall.songs.map(({ id }) => id).sort()).toEqual(
            [songs.sourceDarwall, songs.targetDarwall, songs.angels].sort()
        );
        expect(findTune(db, tunes.darwal)).toBeNull();
        expect(aliases("tune_aliases", "tune_id", tunes.darwall)).toEqual([{ alias: "DARWAL", normalized: "DARWAL" }]);
    });

    test("refuse colliding entries, writing nothing, and a tune that is not there", () => {
        const { tunes, books, songs } = seed();
        const targetHymn = db.prepare("SELECT hymn_id FROM songs WHERE id = ?").get(songs.targetDarwall)!.hymn_id as number;
        const twin = seedSong(db, { hymnId: targetHymn, tuneId: tunes.darwal });
        seedEntry(db, { bookId: books.rejoice, songId: twin, number: 400 });
        const before = snapshot();
        expect(applyTuneMerge(db, tunes.darwal, tunes.darwall)).toMatchObject({
            ok: false,
            reason: "refused",
            preview: { refusals: [{ reason: "entry-collision" }] },
        });
        expect(snapshot()).toEqual(before);
        expect(previewTuneMerge(db, tunes.darwal, 999)).toMatchObject({ ok: false, reason: "target-not-found" });
    });
});
