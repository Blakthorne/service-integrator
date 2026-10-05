import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
    countCatalog,
    findBook,
    findBookLabel,
    findCatalogMatches,
    findCatalogSong,
    findCatalogSongLabel,
    findTune,
    findTuneLabel,
    listBooks,
    listCatalogSongs,
    listTunes,
} from "./catalog";
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
    vi.restoreAllMocks();
});

/**
 * A small catalog with the shapes the real one has: a hymn in three books
 * with a variant, the Doxology on the front cover, a tune shared by two
 * hymns, a tune with an alias, a hymn sung to two tunes and to none, and an
 * unnumbered book.
 */
function seedCatalog() {
    const books = {
        // Inserted out of order, to show that sort_order wins.
        chorus: seedBook(db, {
            code: "CB",
            name: "Chorus Book",
            numbered: false,
            sortOrder: 3,
        }),
        great: seedBook(db, {
            code: "G",
            name: "Great Hymns of the Faith",
            shortName: "Great Hymns",
            sortOrder: 2,
        }),
        rejoice: seedBook(db, {
            code: "R",
            name: "Rejoice Hymns",
            shortName: "Rejoice",
            sortOrder: 1,
        }),
        empty: seedBook(db, { code: "X", name: "Empty Book", sortOrder: 4 }),
    };
    const tunes = {
        newBritain: seedTune(db, { name: "NEW BRITAIN", meter: "CM" }),
        oldHundredth: seedTune(db, { name: "OLD HUNDREDTH", meter: "LM" }),
        darwall: seedTune(db, { name: "DARWALL", aliases: ["DARWAL"] }),
        lynch: seedTune(db, { name: "LYNCH" }),
        thankYouLord: seedTune(db, { name: "THANK YOU, LORD" }),
        unused: seedTune(db, { name: "AZMON" }),
    };
    const hymns = {
        amazingGrace: seedHymn(db, {
            title: "Amazing Grace",
            firstLine: "Amazing grace! how sweet the sound",
            aliases: ["Amazing Grace! How Sweet the Sound"],
        }),
        doxology: seedHymn(db, { title: "Doxology" }),
        allPeople: seedHymn(db, { title: "All People That on Earth Do Dwell" }),
        rejoice: seedHymn(db, {
            title: "Rejoice, the Lord Is King",
            aliases: ["Rejoice \u2013 the Lord Is King!"],
        }),
        thankYouLord: seedHymn(db, { title: "Thank You, Lord" }),
    };
    const songs = {
        amazingGrace: seedSong(db, {
            hymnId: hymns.amazingGrace,
            tuneId: tunes.newBritain,
            pcoSongId: "1001",
            linkedAt: "2026-10-04T12:00:00.000Z",
            linkedBy: "import",
            notes: "Verse 4 optional",
        }),
        doxology: seedSong(db, {
            hymnId: hymns.doxology,
            tuneId: tunes.oldHundredth,
        }),
        allPeople: seedSong(db, {
            hymnId: hymns.allPeople,
            tuneId: tunes.oldHundredth,
        }),
        rejoice: seedSong(db, { hymnId: hymns.rejoice, tuneId: tunes.darwall }),
        thankYouLynch: seedSong(db, {
            hymnId: hymns.thankYouLord,
            tuneId: tunes.lynch,
        }),
        thankYouOwnTune: seedSong(db, {
            hymnId: hymns.thankYouLord,
            tuneId: tunes.thankYouLord,
        }),
        thankYouNoTune: seedSong(db, { hymnId: hymns.thankYouLord }),
    };
    // Inserted out of book order, to show the reads order them.
    const entries = {
        amazingGraceChorus: seedEntry(db, {
            bookId: books.chorus,
            songId: songs.amazingGrace,
            position: 2,
        }),
        amazingGraceDescant: seedEntry(db, {
            bookId: books.rejoice,
            songId: songs.amazingGrace,
            number: 109,
            variantNote: "Descant - last stanza only",
        }),
        amazingGraceGreat: seedEntry(db, {
            bookId: books.great,
            songId: songs.amazingGrace,
            number: 247,
        }),
        amazingGraceRejoice: seedEntry(db, {
            bookId: books.rejoice,
            songId: songs.amazingGrace,
            number: 108,
        }),
        doxologyRejoice: seedEntry(db, {
            bookId: books.rejoice,
            songId: songs.doxology,
            number: 14,
        }),
        doxologyFrontCover: seedEntry(db, {
            bookId: books.great,
            songId: songs.doxology,
            locationLabel: "front cover",
        }),
        allPeopleGreat: seedEntry(db, {
            bookId: books.great,
            songId: songs.allPeople,
            number: 30,
        }),
        rejoiceGreat: seedEntry(db, {
            bookId: books.great,
            songId: songs.rejoice,
            number: 143,
        }),
        rejoiceRejoice: seedEntry(db, {
            bookId: books.rejoice,
            songId: songs.rejoice,
            number: 43,
        }),
        thankYouLynch: seedEntry(db, {
            bookId: books.rejoice,
            songId: songs.thankYouLynch,
            number: 561,
        }),
        thankYouOwnTune: seedEntry(db, {
            bookId: books.rejoice,
            songId: songs.thankYouOwnTune,
            number: 266,
        }),
        thankYouNoTune: seedEntry(db, {
            bookId: books.great,
            songId: songs.thankYouNoTune,
            number: 221,
        }),
        thankYouChorus: seedEntry(db, {
            bookId: books.chorus,
            songId: songs.thankYouOwnTune,
            position: 1,
        }),
    };
    return { books, tunes, hymns, songs, entries };
}

type Catalog = ReturnType<typeof seedCatalog>;

/** The labels of a row's entries, in order. */
const labels = (song: { entries: { label: string }[] }) =>
    song.entries.map(({ label }) => label);

/** Count the statements a read prepares. */
function countQueries(read: () => unknown): number {
    const prepare = vi.spyOn(db, "prepare");
    read();
    const count = prepare.mock.calls.length;
    prepare.mockRestore();
    return count;
}

describe("listCatalogSongs", () => {
    test("is empty for an empty catalog", () => {
        expect(listCatalogSongs(db)).toEqual([]);
    });

    test("lists every song by title, then tune name, an unknown tune last", () => {
        seedCatalog();
        expect(
            listCatalogSongs(db).map(({ title, tuneName }) => [title, tuneName])
        ).toEqual([
            ["All People That on Earth Do Dwell", "OLD HUNDREDTH"],
            ["Amazing Grace", "NEW BRITAIN"],
            ["Doxology", "OLD HUNDREDTH"],
            ["Rejoice, the Lord Is King", "DARWALL"],
            ["Thank You, Lord", "LYNCH"],
            ["Thank You, Lord", "THANK YOU, LORD"],
            ["Thank You, Lord", null],
        ]);
    });

    test("gives each song its aliases, its link and its entries, labelled, in book order", () => {
        const { books, hymns, tunes, songs, entries } = seedCatalog();
        const amazingGrace = listCatalogSongs(db).find(
            ({ id }) => id === songs.amazingGrace
        );
        expect(amazingGrace).toEqual({
            id: songs.amazingGrace,
            hymnId: hymns.amazingGrace,
            title: "Amazing Grace",
            aliases: ["Amazing Grace! How Sweet the Sound"],
            tuneId: tunes.newBritain,
            tuneName: "NEW BRITAIN",
            tuneAliases: [],
            pcoSongId: "1001",
            linkedBy: "import",
            lastScheduledAt: null,
            entries: [
                {
                    id: entries.amazingGraceRejoice,
                    bookId: books.rejoice,
                    songId: songs.amazingGrace,
                    number: 108,
                    position: null,
                    locationLabel: null,
                    variantNote: null,
                    bookCode: "R",
                    label: "R-108",
                },
                {
                    id: entries.amazingGraceDescant,
                    bookId: books.rejoice,
                    songId: songs.amazingGrace,
                    number: 109,
                    position: null,
                    locationLabel: null,
                    variantNote: "Descant - last stanza only",
                    bookCode: "R",
                    label: "R-109",
                },
                {
                    id: entries.amazingGraceGreat,
                    bookId: books.great,
                    songId: songs.amazingGrace,
                    number: 247,
                    position: null,
                    locationLabel: null,
                    variantNote: null,
                    bookCode: "G",
                    label: "G-247",
                },
                {
                    id: entries.amazingGraceChorus,
                    bookId: books.chorus,
                    songId: songs.amazingGrace,
                    number: null,
                    position: 2,
                    locationLabel: null,
                    variantNote: null,
                    bookCode: "CB",
                    label: "Chorus Book",
                },
            ],
        });
    });

    test("labels a front cover entry, and gives a tune's aliases and a tune-less song", () => {
        const { songs } = seedCatalog();
        const rows = new Map(listCatalogSongs(db).map((row) => [row.id, row]));
        expect(labels(rows.get(songs.doxology)!)).toEqual(["R-14", "G-Front Cover"]);
        expect(rows.get(songs.rejoice)).toMatchObject({
            aliases: ["Rejoice \u2013 the Lord Is King!"],
            tuneAliases: ["DARWAL"],
        });
        expect(rows.get(songs.thankYouNoTune)).toMatchObject({
            tuneId: null,
            tuneName: null,
            tuneAliases: [],
            pcoSongId: null,
            entries: [expect.objectContaining({ label: "G-221" })],
        });
    });

    test("gives each song its link and when its Planning Center song was last scheduled", () => {
        const { songs } = seedCatalog();
        seedPcoSong(db, { id: "1001", lastScheduledAt: "2026-09-27T08:00:00Z" });
        seedPcoSong(db, { id: "1016", lastScheduledAt: null });
        db.prepare(
            "UPDATE songs SET pco_song_id = '1016', linked_by = 'auto' WHERE id = ?"
        ).run(songs.doxology);
        db.prepare(
            "UPDATE songs SET pco_song_id = '1404', linked_by = 'manual' WHERE id = ?"
        ).run(songs.allPeople);
        const rows = new Map(listCatalogSongs(db).map((row) => [row.id, row]));
        const link = (id: number) => {
            const { pcoSongId, linkedBy, lastScheduledAt } = rows.get(id)!;
            return { pcoSongId, linkedBy, lastScheduledAt };
        };
        expect(link(songs.amazingGrace)).toEqual({
            pcoSongId: "1001",
            linkedBy: "import",
            lastScheduledAt: "2026-09-27T08:00:00Z",
        });
        // Linked, but never scheduled.
        expect(link(songs.doxology)).toEqual({
            pcoSongId: "1016",
            linkedBy: "auto",
            lastScheduledAt: null,
        });
        // Linked to a song the mirror lacks.
        expect(link(songs.allPeople)).toEqual({
            pcoSongId: "1404",
            linkedBy: "manual",
            lastScheduledAt: null,
        });
        expect(link(songs.rejoice)).toEqual({
            pcoSongId: null,
            linkedBy: null,
            lastScheduledAt: null,
        });
    });

    test("runs four queries, however many songs there are", () => {
        seedCatalog();
        expect(countQueries(() => listCatalogSongs(db))).toBe(4);
    });
});

describe("findCatalogSong", () => {
    let catalog: Catalog;

    beforeEach(() => {
        catalog = seedCatalog();
    });

    test("gives the song with its hymn, tune, link and entries", () => {
        const { hymns, tunes, songs } = catalog;
        const detail = findCatalogSong(db, songs.amazingGrace);
        expect(detail).toMatchObject({
            id: songs.amazingGrace,
            hymnId: hymns.amazingGrace,
            tuneId: tunes.newBritain,
            pcoSongId: "1001",
            linkedAt: "2026-10-04T12:00:00.000Z",
            linkedBy: "import",
            notes: "Verse 4 optional",
            hymn: {
                id: hymns.amazingGrace,
                title: "Amazing Grace",
                firstLine: "Amazing grace! how sweet the sound",
                notes: null,
                aliases: ["Amazing Grace! How Sweet the Sound"],
            },
            tune: {
                id: tunes.newBritain,
                name: "NEW BRITAIN",
                meter: "CM",
                notes: null,
                aliases: [],
            },
            otherTunes: [],
            otherHymns: [],
        });
        expect(labels(detail!)).toEqual(["R-108", "R-109", "G-247", "Chorus Book"]);
    });

    test("gives the hymn's other tunes by tune name, the unknown one last", () => {
        const { songs } = catalog;
        const detail = findCatalogSong(db, songs.thankYouOwnTune);
        expect(detail?.otherTunes.map(({ id }) => id)).toEqual([
            songs.thankYouLynch,
            songs.thankYouNoTune,
        ]);
        expect(detail?.otherTunes[0]).toMatchObject({
            title: "Thank You, Lord",
            tuneName: "LYNCH",
            entries: [expect.objectContaining({ label: "R-561" })],
        });
        expect(detail?.otherHymns).toEqual([]);
    });

    test("gives the tune's other hymns by title", () => {
        const { songs } = catalog;
        const extra = seedSong(db, {
            hymnId: seedHymn(db, { title: "Be Present at Our Table, Lord" }),
            tuneId: catalog.tunes.oldHundredth,
        });
        const detail = findCatalogSong(db, songs.doxology);
        expect(detail?.otherHymns.map(({ id, title }) => [id, title])).toEqual([
            [songs.allPeople, "All People That on Earth Do Dwell"],
            [extra, "Be Present at Our Table, Lord"],
        ]);
        expect(detail?.otherTunes).toEqual([]);
        expect(labels(detail!)).toEqual(["R-14", "G-Front Cover"]);
    });

    test("gives a tune-less song no tune and no other hymns, not the other tune-less songs", () => {
        const { songs } = catalog;
        seedSong(db, { hymnId: seedHymn(db, { title: "Another Tune-less Hymn" }) });
        const detail = findCatalogSong(db, songs.thankYouNoTune);
        expect(detail?.tune).toBeNull();
        expect(detail?.tuneId).toBeNull();
        expect(detail?.otherHymns).toEqual([]);
        expect(detail?.otherTunes.map(({ tuneName }) => tuneName)).toEqual([
            "LYNCH",
            "THANK YOU, LORD",
        ]);
    });

    test("gives the tune's aliases", () => {
        expect(findCatalogSong(db, catalog.songs.rejoice)?.tune?.aliases).toEqual([
            "DARWAL",
        ]);
    });

    test("leaves out a link source this build does not know", () => {
        db.prepare("UPDATE songs SET linked_by = 'newer' WHERE id = ?").run(
            catalog.songs.amazingGrace
        );
        expect(findCatalogSong(db, catalog.songs.amazingGrace)?.linkedBy).toBeNull();
    });

    test("is null for a song that does not exist", () => {
        expect(findCatalogSong(db, 9999)).toBeNull();
    });

    test("runs five queries", () => {
        expect(countQueries(() => findCatalogSong(db, catalog.songs.doxology))).toBe(5);
    });
});

describe("findCatalogSongLabel", () => {
    test("is the title with the tune, or the title alone, or null", () => {
        const { songs } = seedCatalog();
        expect(findCatalogSongLabel(db, songs.amazingGrace)).toBe(
            "Amazing Grace (NEW BRITAIN)"
        );
        expect(findCatalogSongLabel(db, songs.thankYouNoTune)).toBe("Thank You, Lord");
        expect(findCatalogSongLabel(db, 9999)).toBeNull();
    });
});

describe("findCatalogMatches", () => {
    test("gives the songs linked to Planning Center songs, by Planning Center id, with their entries in book order", () => {
        const { songs } = seedCatalog();
        db.prepare("UPDATE songs SET pco_song_id = '1016' WHERE id = ?").run(songs.doxology);
        const matches = findCatalogMatches(db, ["1001", "1016", "404", "1001"]);
        expect([...matches.keys()].sort()).toEqual(["1001", "1016"]);
        expect(matches.get("1001")).toEqual({
            songId: songs.amazingGrace,
            title: "Amazing Grace",
            tuneName: "NEW BRITAIN",
            entries: listCatalogSongs(db).find(({ id }) => id === songs.amazingGrace)?.entries,
        });
        expect(labels(matches.get("1001")!)).toEqual(["R-108", "R-109", "G-247", "Chorus Book"]);
        expect(matches.get("1016")).toMatchObject({
            songId: songs.doxology,
            title: "Doxology",
            tuneName: "OLD HUNDREDTH",
        });
        expect(labels(matches.get("1016")!)).toEqual(["R-14", "G-Front Cover"]);
    });

    test("gives a linked song with no tune and no entries", () => {
        const song = seedSong(db, { pcoSongId: "1002" });
        expect(findCatalogMatches(db, ["1002"]).get("1002")).toMatchObject({
            songId: song,
            tuneName: null,
            entries: [],
        });
    });

    test("runs two queries, however many ids, and none for none", () => {
        seedCatalog();
        expect(countQueries(() => findCatalogMatches(db, ["1001"]))).toBe(2);
        expect(
            countQueries(() =>
                findCatalogMatches(
                    db,
                    Array.from({ length: 50 }, (_, i) => String(1000 + i))
                )
            )
        ).toBe(2);
        expect(countQueries(() => findCatalogMatches(db, []))).toBe(0);
    });
});

describe("listTunes", () => {
    test("is empty for an empty catalog", () => {
        expect(listTunes(db)).toEqual([]);
    });

    test("lists every tune by name with its aliases and song count", () => {
        const { tunes } = seedCatalog();
        expect(listTunes(db)).toEqual([
            { id: tunes.unused, name: "AZMON", meter: null, notes: null, aliases: [], songCount: 0 },
            { id: tunes.darwall, name: "DARWALL", meter: null, notes: null, aliases: ["DARWAL"], songCount: 1 },
            { id: tunes.lynch, name: "LYNCH", meter: null, notes: null, aliases: [], songCount: 1 },
            { id: tunes.newBritain, name: "NEW BRITAIN", meter: "CM", notes: null, aliases: [], songCount: 1 },
            { id: tunes.oldHundredth, name: "OLD HUNDREDTH", meter: "LM", notes: null, aliases: [], songCount: 2 },
            { id: tunes.thankYouLord, name: "THANK YOU, LORD", meter: null, notes: null, aliases: [], songCount: 1 },
        ]);
    });
});

describe("findTune", () => {
    test("gives the tune with its aliases and its songs by title", () => {
        const { tunes, songs } = seedCatalog();
        const tune = findTune(db, tunes.oldHundredth);
        expect(tune).toMatchObject({
            id: tunes.oldHundredth,
            name: "OLD HUNDREDTH",
            meter: "LM",
            notes: null,
            aliases: [],
        });
        expect(tune?.songs.map(({ id }) => id)).toEqual([songs.allPeople, songs.doxology]);
        expect(labels(tune!.songs[1])).toEqual(["R-14", "G-Front Cover"]);
        expect(findTune(db, tunes.darwall)?.aliases).toEqual(["DARWAL"]);
    });

    test("gives a tune no song uses, with no songs", () => {
        const { tunes } = seedCatalog();
        expect(findTune(db, tunes.unused)?.songs).toEqual([]);
    });

    test("is null for a tune that does not exist", () => {
        expect(findTune(db, 9999)).toBeNull();
    });
});

describe("findTuneLabel", () => {
    test("is the tune's name, or null", () => {
        const { tunes } = seedCatalog();
        expect(findTuneLabel(db, tunes.darwall)).toBe("DARWALL");
        expect(findTuneLabel(db, 9999)).toBeNull();
    });
});

describe("listBooks", () => {
    test("is empty for an empty catalog", () => {
        expect(listBooks(db)).toEqual([]);
    });

    test("lists the books in book order with their entry counts", () => {
        const { books } = seedCatalog();
        expect(listBooks(db)).toEqual([
            {
                id: books.rejoice,
                code: "R",
                name: "Rejoice Hymns",
                shortName: "Rejoice",
                numbered: true,
                labelFormat: "R-{n}",
                sortOrder: 1,
                active: true,
                entryCount: 6,
            },
            {
                id: books.great,
                code: "G",
                name: "Great Hymns of the Faith",
                shortName: "Great Hymns",
                numbered: true,
                labelFormat: "G-{n}",
                sortOrder: 2,
                active: true,
                entryCount: 5,
            },
            {
                id: books.chorus,
                code: "CB",
                name: "Chorus Book",
                shortName: "Chorus Book",
                numbered: false,
                labelFormat: "Chorus Book",
                sortOrder: 3,
                active: true,
                entryCount: 2,
            },
            expect.objectContaining({ code: "X", entryCount: 0 }),
        ]);
    });
});

describe("findBook", () => {
    let catalog: Catalog;

    beforeEach(() => {
        catalog = seedCatalog();
    });

    test("finds a book by its code in any case", () => {
        expect(findBook(db, "G")?.id).toBe(catalog.books.great);
        expect(findBook(db, "g")?.id).toBe(catalog.books.great);
        expect(findBook(db, "cb")?.code).toBe("CB");
    });

    test("lists a numbered book's entries with the front cover first, then by number", () => {
        const { songs, hymns, tunes } = catalog;
        const great = findBook(db, "G");
        expect(great).toMatchObject({ code: "G", name: "Great Hymns of the Faith", numbered: true });
        expect(great?.entries.map(({ label, title }) => [label, title])).toEqual([
            ["G-Front Cover", "Doxology"],
            ["G-30", "All People That on Earth Do Dwell"],
            ["G-143", "Rejoice, the Lord Is King"],
            ["G-221", "Thank You, Lord"],
            ["G-247", "Amazing Grace"],
        ]);
        expect(great?.entries[0]).toMatchObject({
            songId: songs.doxology,
            hymnId: hymns.doxology,
            tuneId: tunes.oldHundredth,
            tuneName: "OLD HUNDREDTH",
            pcoSongId: null,
            number: null,
            locationLabel: "front cover",
            bookCode: "G",
        });
        expect(great?.entries[3]).toMatchObject({ tuneId: null, tuneName: null });
        expect(great?.entries[4]).toMatchObject({ pcoSongId: "1001" });
    });

    test("lists a song's variant entries beside its plain ones", () => {
        expect(
            findBook(db, "R")?.entries.map(({ label, variantNote }) => [label, variantNote])
        ).toEqual([
            ["R-14", null],
            ["R-43", null],
            ["R-108", null],
            ["R-109", "Descant - last stanza only"],
            ["R-266", null],
            ["R-561", null],
        ]);
    });

    test("lists an unnumbered book's entries by position", () => {
        const chorus = findBook(db, "CB");
        expect(chorus?.entries.map(({ title, position, label }) => [title, position, label])).toEqual([
            ["Thank You, Lord", 1, "Chorus Book"],
            ["Amazing Grace", 2, "Chorus Book"],
        ]);
    });

    test("gives a book with no entries, and null for a code no book has", () => {
        expect(findBook(db, "X")?.entries).toEqual([]);
        expect(findBook(db, "Q")).toBeNull();
    });

    test("runs two queries", () => {
        expect(countQueries(() => findBook(db, "G"))).toBe(2);
    });
});

describe("findBookLabel", () => {
    test("is the book's name, found in any case, or null", () => {
        seedCatalog();
        expect(findBookLabel(db, "g")).toBe("Great Hymns of the Faith");
        expect(findBookLabel(db, "Q")).toBeNull();
    });
});

describe("countCatalog", () => {
    test("is all zero for an empty catalog", () => {
        expect(countCatalog(db)).toEqual({
            books: 0,
            hymns: 0,
            tunes: 0,
            songs: 0,
            entries: 0,
        });
    });

    test("counts each kind of row", () => {
        seedCatalog();
        expect(countCatalog(db)).toEqual({
            books: 4,
            hymns: 5,
            tunes: 6,
            songs: 7,
            entries: 13,
        });
    });
});
