import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { countCatalog, findCatalogSong } from "./catalog";
import { createCatalogSong, type NewCatalogSong } from "./catalogWrites";
import { findPcoSong } from "./pcoSongs";
import {
    openTestDb,
    seedBook,
    seedEntry,
    seedHymn,
    seedPcoSong,
    seedSong,
    seedTune,
} from "./testing";
import { withTransaction } from "./transaction";

let db: DatabaseSync;

beforeEach(() => {
    db = openTestDb();
});

afterEach(() => {
    db.close();
});

const NOW = new Date("2026-10-04T12:00:00.000Z");

/**
 * Rejoice and Great Hymns (numbered) and a Chorus Book (not); Amazing Grace
 * to NEW BRITAIN at R-130, Rejoice, the Lord Is King to DARWALL (also
 * DARWAL) with another title, a Doxology with no tune, and a chorus at
 * positions 1 and 2. In the mirror: two Planning Center songs.
 */
function seed() {
    const books = {
        rejoice: seedBook(db, { code: "R", name: "Rejoice Hymns" }),
        great: seedBook(db, { code: "G", name: "Great Hymns of the Faith" }),
        chorus: seedBook(db, { code: "CB", name: "Chorus Book", numbered: false }),
    };
    const hymns = {
        amazingGrace: seedHymn(db, { title: "Amazing Grace" }),
        rejoice: seedHymn(db, {
            title: "Rejoice, the Lord Is King",
            aliases: ["Rejoice - the Lord Is King!"],
        }),
        doxology: seedHymn(db, { title: "Doxology" }),
    };
    const tunes = {
        newBritain: seedTune(db, { name: "NEW BRITAIN" }),
        darwall: seedTune(db, { name: "DARWALL", aliases: ["DARWAL"] }),
        azmon: seedTune(db, { name: "AZMON" }),
    };
    const songs = {
        amazingGrace: seedSong(db, { hymnId: hymns.amazingGrace, tuneId: tunes.newBritain }),
        rejoice: seedSong(db, { hymnId: hymns.rejoice, tuneId: tunes.darwall }),
        doxology: seedSong(db, { hymnId: hymns.doxology }),
        chorus: seedSong(db, { hymnId: seedHymn(db, { title: "Jesus Loves Me" }) }),
        chorus2: seedSong(db, { hymnId: seedHymn(db, { title: "Deep and Wide" }) }),
    };
    seedEntry(db, { bookId: books.rejoice, songId: songs.amazingGrace, number: 130 });
    seedEntry(db, { bookId: books.chorus, songId: songs.chorus, position: 1 });
    seedEntry(db, { bookId: books.chorus, songId: songs.chorus2, position: 2 });
    seedPcoSong(db, { id: "1001", title: "Be Thou My Vision", ignoredAt: NOW.toISOString() });
    seedPcoSong(db, { id: "1002", title: "Amazing Grace" });
    return { books, hymns, tunes, songs };
}

/** A new hymn with no tune, no entry and no link, with these parts changed. */
function newSong(fields: Partial<NewCatalogSong> = {}): NewCatalogSong {
    return {
        hymn: { kind: "new", title: "Be Thou My Vision" },
        tune: { kind: "none" },
        entry: null,
        pcoSongId: null,
        ...fields,
    };
}

/** The new song's id, from a result that must be a success. */
function created(result: ReturnType<typeof createCatalogSong>): number {
    if (!result.ok) {
        throw new Error(`Expected a song, got ${JSON.stringify(result.problems)}`);
    }
    return result.songId;
}

describe("createCatalogSong", () => {
    test("adds a new hymn to a new tune, with its number in a book", () => {
        const { books } = seed();
        const songId = created(
            createCatalogSong(
                db,
                newSong({
                    tune: { kind: "new", name: "SLANE" },
                    entry: { kind: "number", bookId: books.great, number: 400 },
                }),
                NOW
            )
        );
        expect(findCatalogSong(db, songId)).toMatchObject({
            hymn: { title: "Be Thou My Vision", aliases: [] },
            tune: { name: "SLANE", aliases: [] },
            entries: [expect.objectContaining({ label: "G-400", number: 400, position: null })],
            pcoSongId: null,
            linkedBy: null,
        });
    });

    test("adds a hymn of the catalog to another tune of the catalog", () => {
        const { hymns, tunes } = seed();
        const songId = created(
            createCatalogSong(
                db,
                newSong({
                    hymn: { kind: "existing", hymnId: hymns.amazingGrace },
                    tune: { kind: "existing", tuneId: tunes.azmon },
                })
            )
        );
        const song = findCatalogSong(db, songId);
        expect(song).toMatchObject({ hymnId: hymns.amazingGrace, tuneId: tunes.azmon });
        expect(song?.otherTunes.map(({ tuneName }) => tuneName)).toEqual(["NEW BRITAIN"]);
    });

    test("adds a song with no tune", () => {
        seed();
        const songId = created(createCatalogSong(db, newSong()));
        expect(findCatalogSong(db, songId)).toMatchObject({ tuneId: null, tune: null });
    });

    test("puts an entry at a location of a numbered book", () => {
        const { books } = seed();
        const songId = created(
            createCatalogSong(
                db,
                newSong({
                    entry: { kind: "location", bookId: books.great, locationLabel: "back cover" },
                })
            )
        );
        expect(findCatalogSong(db, songId)?.entries).toEqual([
            expect.objectContaining({
                label: "G-Back Cover",
                number: null,
                position: null,
                locationLabel: "back cover",
            }),
        ]);
    });

    test("puts an entry at the end of a book without numbers", () => {
        const { books } = seed();
        const songId = created(
            createCatalogSong(db, newSong({ entry: { kind: "end", bookId: books.chorus } }))
        );
        expect(findCatalogSong(db, songId)?.entries).toEqual([
            expect.objectContaining({ label: "Chorus Book", number: null, position: 3 }),
        ]);
    });

    test("starts an empty book without numbers at position 1", () => {
        seed();
        const empty = seedBook(db, { code: "X", numbered: false });
        const songId = created(
            createCatalogSong(db, newSong({ entry: { kind: "end", bookId: empty } }))
        );
        expect(findCatalogSong(db, songId)?.entries[0]).toMatchObject({ position: 1 });
    });

    test("links the new song to a Planning Center song by hand, which leaves the ignored list", () => {
        seed();
        const songId = created(createCatalogSong(db, newSong({ pcoSongId: "1001" }), NOW));
        expect(findCatalogSong(db, songId)).toMatchObject({
            pcoSongId: "1001",
            linkedBy: "manual",
            linkedAt: NOW.toISOString(),
        });
        expect(findPcoSong(db, "1001")?.ignoredAt).toBeNull();
    });

    describe("refuses, and writes nothing,", () => {
        /** The problems of a create that must be refused, after checking it wrote nothing. */
        function refused(song: NewCatalogSong) {
            const before = countCatalog(db);
            const result = createCatalogSong(db, song, NOW);
            expect(countCatalog(db)).toEqual(before);
            if (result.ok) {
                throw new Error("Expected a refusal");
            }
            return result.problems;
        }

        test("a hymn the catalog does not have", () => {
            seed();
            expect(refused(newSong({ hymn: { kind: "existing", hymnId: 999 } }))).toEqual([
                {
                    reason: "hymn-not-found",
                    part: "hymn",
                    message: "That hymn is not in the catalog. Choose one from the list.",
                    existing: null,
                },
            ]);
        });

        test("a new hymn titled as one the catalog has, however it is written", () => {
            const { songs } = seed();
            expect(refused(newSong({ hymn: { kind: "new", title: "amazing  grace!" } }))).toEqual([
                {
                    reason: "hymn-title-taken",
                    part: "hymn",
                    message:
                        'The catalog already has a hymn titled "Amazing Grace". Choose it from the list, or give this one a title that tells them apart.',
                    existing: {
                        kind: "song",
                        songId: songs.amazingGrace,
                        label: "Amazing Grace (NEW BRITAIN)",
                    },
                },
            ]);
        });

        test("a new hymn titled as another title of one", () => {
            const { songs } = seed();
            expect(
                refused(newSong({ hymn: { kind: "new", title: "Rejoice - the Lord is King" } }))
            ).toEqual([
                {
                    reason: "hymn-title-taken",
                    part: "hymn",
                    message:
                        '"Rejoice - the Lord Is King!" is another title of "Rejoice, the Lord Is King", which the catalog has. Choose that hymn from the list instead.',
                    existing: {
                        kind: "song",
                        songId: songs.rejoice,
                        label: "Rejoice, the Lord Is King (DARWALL)",
                    },
                },
            ]);
        });

        test("a tune the catalog does not have", () => {
            seed();
            expect(refused(newSong({ tune: { kind: "existing", tuneId: 999 } }))).toEqual([
                {
                    reason: "tune-not-found",
                    part: "tune",
                    message: "That tune is not in the catalog. Choose one from the list.",
                    existing: null,
                },
            ]);
        });

        test("a new tune named as one the catalog has, in any case, or by another of its names", () => {
            const { tunes } = seed();
            expect(refused(newSong({ tune: { kind: "new", name: "new  britain" } }))).toEqual([
                {
                    reason: "tune-name-taken",
                    part: "tune",
                    message:
                        "The catalog already has the tune NEW BRITAIN. Choose it from the list instead.",
                    existing: { kind: "tune", tuneId: tunes.newBritain, label: "NEW BRITAIN" },
                },
            ]);
            expect(refused(newSong({ tune: { kind: "new", name: "Darwal" } }))).toEqual([
                {
                    reason: "tune-name-taken",
                    part: "tune",
                    message:
                        "DARWAL is another name of the tune DARWALL. Choose that tune from the list instead.",
                    existing: { kind: "tune", tuneId: tunes.darwall, label: "DARWALL" },
                },
            ]);
        });

        test("a song the hymn already has to that tune", () => {
            const { hymns, tunes, songs } = seed();
            expect(
                refused(
                    newSong({
                        hymn: { kind: "existing", hymnId: hymns.amazingGrace },
                        tune: { kind: "existing", tuneId: tunes.newBritain },
                    })
                )
            ).toEqual([
                {
                    reason: "song-exists",
                    part: "tune",
                    message: 'The catalog already has "Amazing Grace (NEW BRITAIN)".',
                    existing: {
                        kind: "song",
                        songId: songs.amazingGrace,
                        label: "Amazing Grace (NEW BRITAIN)",
                    },
                },
            ]);
        });

        test("a second song of a hymn with no tune", () => {
            const { hymns, songs } = seed();
            expect(refused(newSong({ hymn: { kind: "existing", hymnId: hymns.doxology } }))).toEqual([
                {
                    reason: "song-exists",
                    part: "tune",
                    message: 'The catalog already has "Doxology" with no tune.',
                    existing: { kind: "song", songId: songs.doxology, label: "Doxology" },
                },
            ]);
        });

        test("a book the catalog does not have", () => {
            seed();
            expect(
                refused(newSong({ entry: { kind: "number", bookId: 999, number: 1 } }))
            ).toEqual([
                {
                    reason: "book-not-found",
                    part: "entry",
                    message: "That book is not in the catalog. Choose one from the list.",
                    existing: null,
                },
            ]);
        });

        test("an entry its book does not take", () => {
            const { books } = seed();
            expect(refused(newSong({ entry: { kind: "end", bookId: books.rejoice } }))).toEqual([
                {
                    reason: "entry-not-placed",
                    part: "entry",
                    message:
                        "Rejoice Hymns numbers its songs: give the song's number, or where the book has it.",
                    existing: null,
                },
            ]);
            expect(
                refused(newSong({ entry: { kind: "number", bookId: books.chorus, number: 3 } }))
            ).toMatchObject([
                {
                    reason: "entry-not-placed",
                    message: "Chorus Book has no numbers: a new song goes at its end.",
                },
            ]);
        });

        test("a number another song has in the book", () => {
            const { books, songs } = seed();
            expect(
                refused(newSong({ entry: { kind: "number", bookId: books.rejoice, number: 130 } }))
            ).toEqual([
                {
                    reason: "number-taken",
                    part: "entry",
                    message: 'R-130 is taken by "Amazing Grace (NEW BRITAIN)".',
                    existing: {
                        kind: "song",
                        songId: songs.amazingGrace,
                        label: "Amazing Grace (NEW BRITAIN)",
                    },
                },
            ]);
        });

        test("with every problem it finds", () => {
            const { books } = seed();
            expect(
                refused(
                    newSong({
                        hymn: { kind: "new", title: "Doxology" },
                        tune: { kind: "new", name: "AZMON" },
                        entry: { kind: "number", bookId: books.rejoice, number: 130 },
                    })
                ).map(({ reason }) => reason)
            ).toEqual(["hymn-title-taken", "tune-name-taken", "number-taken"]);
        });

        test("without asking whether a hymn it cannot find has the song", () => {
            const { tunes } = seed();
            expect(
                refused(
                    newSong({
                        hymn: { kind: "existing", hymnId: 999 },
                        tune: { kind: "existing", tuneId: tunes.newBritain },
                    })
                ).map(({ reason }) => reason)
            ).toEqual(["hymn-not-found"]);
        });

        test("a link to a Planning Center song the mirror lacks", () => {
            seed();
            expect(refused(newSong({ pcoSongId: "4040" }))).toEqual([
                {
                    reason: "pco-song-not-found",
                    part: null,
                    message: "There is no such Planning Center song.",
                    existing: null,
                },
            ]);
        });

        test("a link to a Planning Center song deleted from Planning Center", () => {
            seed();
            seedPcoSong(db, { id: "1003", title: "Gone", removedAt: NOW.toISOString() });
            expect(refused(newSong({ pcoSongId: "1003" }))).toMatchObject([
                { reason: "pco-song-removed", part: null },
            ]);
        });

        test("a link to a Planning Center song linked to another song, naming that song", () => {
            const { songs } = seed();
            db.prepare("UPDATE songs SET pco_song_id = '1002', linked_by = 'auto' WHERE id = ?").run(
                songs.amazingGrace
            );
            expect(refused(newSong({ pcoSongId: "1002" }))).toEqual([
                {
                    reason: "pco-song-linked",
                    part: null,
                    message:
                        'The Planning Center song "Amazing Grace" is already linked to "Amazing Grace (NEW BRITAIN)". Undo that link first.',
                    existing: {
                        kind: "song",
                        songId: songs.amazingGrace,
                        label: "Amazing Grace (NEW BRITAIN)",
                    },
                },
            ]);
        });
    });

    test("undoes only its own writes when refused inside another transaction", () => {
        seed();
        const result = withTransaction(db, () => {
            seedHymn(db, { title: "Kept" });
            return createCatalogSong(db, newSong({ pcoSongId: "4040" }));
        });
        expect(result).toMatchObject({ ok: false });
        const titles = db.prepare("SELECT title FROM hymns ORDER BY id").all();
        expect(titles.map(({ title }) => title)).toContain("Kept");
        expect(titles.map(({ title }) => title)).not.toContain("Be Thou My Vision");
    });
});
