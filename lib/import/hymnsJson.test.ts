import { beforeAll, describe, expect, test } from "vitest";
import { hymnCatalog } from "@/lib/hymnCatalog";
import type { RawHymn } from "@/lib/unusedHymns";
import { planHymnsJsonImport, SEED_BOOKS, type HymnsJsonImport } from "./hymnsJson";
import { parsePlannedRows } from "./rows";

/** A record: in Rejoice at `r` and Great Hymns at `g` (-1 for neither), to `tune` ("" for none). */
function record(title: string, tune: string, r: number, g: number): RawHymn {
    return {
        song_title: title,
        tune_name: tune,
        rejoice_hymns: r,
        great_hymns_of_the_faith: g,
    };
}

describe("planHymnsJsonImport on the real hymns.json", () => {
    let seed: HymnsJsonImport;

    beforeAll(() => {
        seed = planHymnsJsonImport(hymnCatalog);
    });

    test("reads every record", () => {
        expect(seed.report.input).toEqual({
            records: 929,
            recordsWithoutTune: 110,
            recordsByBook: { R: 708, G: 539 },
        });
    });

    test("plans the hand-counted rows", () => {
        expect(seed.report.planned).toEqual({
            books: 2,
            hymns: 895,
            hymnAliases: 4,
            tunes: 768,
            tuneAliases: 1,
            songs: 921,
            songsWithoutTune: 107,
            entries: 1247,
        });
        expect(seed.report.entriesByBook).toEqual({ R: 708, G: 539 });
        expect(seed.rows.hymns).toHaveLength(895);
        expect(seed.rows.tunes).toHaveLength(768);
        expect(seed.rows.songs).toHaveLength(921);
        expect(seed.rows.entries).toHaveLength(1247);
    });

    test("creates Rejoice Hymns and Great Hymns of the Faith, numbered", () => {
        expect(seed.rows.books).toEqual([
            {
                code: "R",
                name: "Rejoice Hymns",
                shortName: "Rejoice",
                numbered: true,
                labelFormat: "R-{n}",
                sortOrder: 1,
            },
            {
                code: "G",
                name: "Great Hymns of the Faith",
                shortName: "Great Hymns",
                numbered: true,
                labelFormat: "G-{n}",
                sortOrder: 2,
            },
        ]);
    });

    test("puts the Doxology on Great Hymns' front cover, the only entry without a number", () => {
        expect(seed.rows.entries.filter((entry) => entry.number === null)).toEqual([
            {
                bookCode: "G",
                hymnKey: "doxology",
                tuneKey: "OLD HUNDREDTH",
                number: null,
                position: null,
                locationLabel: "front cover",
                variantNote: null,
            },
        ]);
    });

    test("gives Amazing Grace a Rejoice and a Great Hymns number", () => {
        const amazingGrace = seed.rows.entries.filter(
            (entry) => entry.hymnKey === "amazing grace"
        );
        expect(amazingGrace.map(({ bookCode }) => bookCode)).toEqual(["R", "G"]);
        expect(new Set(amazingGrace.map(({ tuneKey }) => tuneKey)).size).toBe(1);
    });

    test("merges the three split pairs it can, and flags Thank You, Lord", () => {
        expect(seed.report.splitPairs).toEqual([
            {
                title: "Give of Your Best to the Master",
                label: "G-369",
                outcome: "merged",
                tunes: ["PINKSTON"],
            },
            {
                title: "Thank You, Lord",
                label: "G-221",
                outcome: "ambiguous",
                tunes: ["LYNCH", "THANK YOU, LORD"],
            },
            {
                title: "We've a Story to Tell to the Nations",
                label: "G-423",
                outcome: "merged",
                tunes: ["MESSAGE"],
            },
        ]);
        expect(
            seed.rows.entries
                .filter(({ hymnKey }) => hymnKey === "give of your best to the master")
                .map(({ bookCode, number, tuneKey }) => [bookCode, number, tuneKey])
        ).toEqual([
            ["R", 416, "PINKSTON"],
            ["G", 369, "PINKSTON"],
        ]);
    });

    test("turns the eight descants and rounds into variant notes", () => {
        expect(seed.report.variants).toEqual([
            {
                record: "America the Beautiful (Descant - last stanza only)",
                title: "America the Beautiful",
                variantNote: "Descant - last stanza only",
                tune: "MATERNA",
                tuneFromBase: true,
                sharesSong: true,
                labels: ["R-700"],
            },
            {
                record: "Father, I Adore You (A Round)",
                title: "Father, I Adore You",
                variantNote: "A Round",
                tune: "MARANATHA",
                tuneFromBase: false,
                sharesSong: false,
                labels: ["R-6"],
            },
            {
                record: "Hark! The Herald Angels Sing (Descant - last stanza only)",
                title: "Hark! the Herald Angels Sing",
                variantNote: "Descant - last stanza only",
                tune: "MENDELSSOHN",
                tuneFromBase: false,
                sharesSong: true,
                labels: ["R-228"],
            },
            {
                record: "How Great Thou Art (Descant - Last Chorus only)",
                title: "How Great Thou Art",
                variantNote: "Descant - Last Chorus only",
                tune: "HOW GREAT THOU ART",
                tuneFromBase: false,
                sharesSong: true,
                labels: ["R-29"],
            },
            {
                record: "I'll Walk with Him Always (A Round)",
                title: "I'll Walk with Him Always",
                variantNote: "A Round",
                tune: "ALWAYS",
                tuneFromBase: false,
                sharesSong: false,
                labels: ["R-446"],
            },
            {
                record: "Jesus Loves Me (A Round)",
                title: "Jesus Loves Me",
                variantNote: "A Round",
                tune: "LEOTA",
                tuneFromBase: false,
                sharesSong: false,
                labels: ["R-693"],
            },
            {
                record: "King of Kings (A Round)",
                title: "King of Kings",
                variantNote: "A Round",
                tune: "KING OF KINGS",
                tuneFromBase: false,
                sharesSong: false,
                labels: ["R-81"],
            },
            {
                record: "Like A River Glorious (Descant - last stanza only)",
                title: "Like a River Glorious",
                variantNote: "Descant - last stanza only",
                tune: "WYE VALLEY",
                tuneFromBase: false,
                sharesSong: true,
                labels: ["R-550"],
            },
        ]);
    });

    test("files a descant under its hymn's song, and a round to another tune as its own", () => {
        const ofHymn = (hymnKey: string) =>
            seed.rows.entries
                .filter((entry) => entry.hymnKey === hymnKey)
                .map(({ bookCode, number, tuneKey, variantNote }) => [
                    `${bookCode}-${number}`,
                    tuneKey,
                    variantNote,
                ]);
        expect(ofHymn("hark! the herald angels sing")).toEqual([
            ["R-227", "MENDELSSOHN", null],
            ["G-93", "MENDELSSOHN", null],
            ["R-228", "MENDELSSOHN", "Descant - last stanza only"],
        ]);
        expect(ofHymn("jesus loves me")).toEqual([
            ["R-690", "CHINA", null],
            ["G-479", "CHINA", null],
            ["R-693", "LEOTA", "A Round"],
        ]);
    });

    test("applies and lists every fix of the merge list", () => {
        expect(seed.report.merges).toEqual([
            { kind: "tune-alias", from: "DARWAL", to: "DARWALL", records: 1 },
            {
                kind: "hymn-alias",
                from: "Rejoice – the Lord Is King",
                to: "Rejoice, the Lord Is King",
                records: 1,
            },
            {
                kind: "hymn-alias",
                from: "Hallelujah, What a Savior!",
                to: "Hallelujah! What a Savior",
                records: 1,
            },
            {
                kind: "title-fix",
                from: "Is Your All on the Alter?",
                to: "Is Your All on the Altar?",
                records: 1,
            },
            {
                kind: "title-fix",
                from: "Hark! Ten Thousands Harps and Voices",
                to: "Hark! Ten Thousand Harps and Voices",
                records: 1,
            },
        ]);
        expect(seed.rows.tunes.filter(({ aliases }) => aliases.length > 0)).toEqual([
            {
                key: "DARWALL",
                name: "DARWALL",
                aliases: [{ alias: "DARWAL", normalized: "DARWAL" }],
            },
        ]);
        expect(seed.rows.hymns.filter(({ aliases }) => aliases.length > 0)).toEqual([
            {
                key: "hallelujah! what a savior",
                title: "Hallelujah! What a Savior",
                aliases: [
                    {
                        alias: "Hallelujah, What a Savior!",
                        normalized: "hallelujah, what a savior",
                    },
                ],
            },
            {
                key: "hark! ten thousand harps and voices",
                title: "Hark! Ten Thousand Harps and Voices",
                aliases: [
                    {
                        alias: "Hark! Ten Thousands Harps and Voices",
                        normalized: "hark! ten thousands harps and voices",
                    },
                ],
            },
            {
                key: "is your all on the altar",
                title: "Is Your All on the Altar?",
                aliases: [
                    {
                        alias: "Is Your All on the Alter?",
                        normalized: "is your all on the alter",
                    },
                ],
            },
            {
                key: "rejoice, the lord is king",
                title: "Rejoice, the Lord Is King",
                aliases: [
                    {
                        alias: "Rejoice – the Lord Is King!",
                        normalized: "rejoice – the lord is king",
                    },
                ],
            },
        ]);
    });

    test("makes each merged pair one song with an entry in each book", () => {
        const ofHymn = (hymnKey: string) =>
            seed.rows.entries
                .filter((entry) => entry.hymnKey === hymnKey)
                .map(({ bookCode, number, tuneKey }) => [bookCode, number, tuneKey]);
        expect(ofHymn("rejoice, the lord is king")).toEqual([
            ["G", 143, "DARWALL"],
            ["R", 43, "DARWALL"],
        ]);
        expect(ofHymn("hallelujah! what a savior")).toEqual([
            ["R", 286, "MAN OF SORROWS"],
            ["G", 127, "MAN OF SORROWS"],
        ]);
    });

    test("lists the 107 songs without a tune, Thank You, Lord flagged as ambiguous", () => {
        const { songsWithoutTune } = seed.report;
        expect(songsWithoutTune).toHaveLength(107);
        expect(songsWithoutTune.filter(({ reason }) => reason !== "no-tune")).toEqual([
            {
                title: "Thank You, Lord",
                labels: ["G-221"],
                reason: "ambiguous-split-pair",
            },
        ]);
        expect(songsWithoutTune[0]).toEqual({
            title: "A Flag to Follow",
            labels: ["G-391"],
            reason: "no-tune",
        });
    });

    test("lists the nearly identical titles it did not merge", () => {
        expect(seed.report.possibleDuplicates).toEqual([
            {
                titles: ["At the Name of Jesus", "The Name of Jesus"],
                labels: [["R-55", "R-56"], ["G-64"]],
            },
            {
                titles: ["I Want to Be Like Jesus", "O I Want to Be Like Jesus"],
                labels: [["R-449"], ["G-320"]],
            },
            {
                titles: ["In My Heart", "Into My Heart"],
                labels: [["G-457"], ["R-370"]],
            },
            {
                titles: ["Speak, Lord", "Speak, O Lord"],
                labels: [["R-512"], ["R-513"]],
            },
            {
                titles: ["Walk in the Light", "Walking in the Light"],
                labels: [["G-273"], ["G-482"]],
            },
        ]);
    });

    test("leaves no entry out", () => {
        expect(seed.report.skippedEntries).toEqual([]);
    });

    test("plans rows that refer only to each other", () => {
        const { books, hymns, tunes, songs, entries } = seed.rows;
        const bookCodes = new Set(books.map(({ code }) => code));
        const hymnKeys = new Set(hymns.map(({ key }) => key));
        const tuneKeys = new Set(tunes.map(({ key }) => key));
        const songKeys = new Set(songs.map((song) => JSON.stringify([song.hymnKey, song.tuneKey])));
        expect(hymnKeys.size).toBe(hymns.length);
        expect(tuneKeys.size).toBe(tunes.length);
        expect(songKeys.size).toBe(songs.length);
        for (const song of songs) {
            expect(hymnKeys.has(song.hymnKey)).toBe(true);
            expect(song.tuneKey === null || tuneKeys.has(song.tuneKey)).toBe(true);
        }
        for (const entry of entries) {
            expect(bookCodes.has(entry.bookCode)).toBe(true);
            expect(songKeys.has(JSON.stringify([entry.hymnKey, entry.tuneKey]))).toBe(true);
        }
        const aliases = [...hymns, ...tunes].flatMap((row) => row.aliases);
        expect(new Set(aliases.map(({ normalized }) => normalized)).size).toBe(aliases.length);
    });

    test("plans rows that survive storage as JSON", () => {
        const stored = JSON.parse(JSON.stringify(seed.rows));
        expect(parsePlannedRows(stored)).toEqual(seed.rows);
    });

    test("plans the same rows and report every time", () => {
        expect(planHymnsJsonImport(hymnCatalog)).toEqual(seed);
    });
});

describe("planHymnsJsonImport's rules", () => {
    test("gives a record an entry in each book it has a number in, and 0 is the front cover", () => {
        const { rows } = planHymnsJsonImport([
            record("Doxology", "OLD HUNDREDTH", 14, 0),
            record("Only in Rejoice", "TUNE A", 5, -1),
        ]);
        expect(
            rows.entries.map(({ bookCode, number, locationLabel }) => [bookCode, number, locationLabel])
        ).toEqual([
            ["R", 14, null],
            ["G", null, "front cover"],
            ["R", 5, null],
        ]);
    });

    test("refuses a number that is not -1, 0 or a whole number above 0", () => {
        for (const bad of [-2, 1.5, Number.NaN]) {
            expect(() =>
                planHymnsJsonImport([record("Hymn", "TUNE", bad, -1)])
            ).toThrow(
                `Record 1 ("Hymn") has rejoice_hymns ${JSON.stringify(bad)}; expected -1, 0 or a whole number above 0`
            );
        }
    });

    test("makes one hymn of titles that normalize alike, titled by the first record", () => {
        const { rows } = planHymnsJsonImport([
            record("Arise, My Soul, Arise", "LENOX", 666, -1),
            record("Arise, My Soul, Arise!", "TOWNER", -1, 223),
        ]);
        expect(rows.hymns).toEqual([
            { key: "arise, my soul, arise", title: "Arise, My Soul, Arise", aliases: [] },
        ]);
        expect(rows.songs).toEqual([
            { hymnKey: "arise, my soul, arise", tuneKey: "LENOX" },
            { hymnKey: "arise, my soul, arise", tuneKey: "TOWNER" },
        ]);
    });

    test("makes one tune of names that differ in case and spacing, named by the first record", () => {
        const { rows } = planHymnsJsonImport([
            record("Hymn A", "St.  Anne", 1, -1),
            record("Hymn B", "ST. ANNE", 2, -1),
        ]);
        expect(rows.tunes).toEqual([{ key: "ST. ANNE", name: "St.  Anne", aliases: [] }]);
    });

    test("makes one song with several entries of records with the same hymn and tune", () => {
        const { rows, report } = planHymnsJsonImport([
            record("Amazing Grace", "NEW BRITAIN", 108, -1),
            record("Amazing Grace!", "New Britain", -1, 247),
        ]);
        expect(rows.songs).toEqual([{ hymnKey: "amazing grace", tuneKey: "NEW BRITAIN" }]);
        expect(rows.entries.map(({ bookCode }) => bookCode)).toEqual(["R", "G"]);
        expect(report.planned.songs).toBe(1);
    });

    test("leaves a variant without a tune when its hymn has several", () => {
        const { report, rows } = planHymnsJsonImport([
            record("Abba, Father", "ABBA, FATHER", 42, -1),
            record("Abba, Father", "PRITCHARD", 7, -1),
            record("Abba, Father (Descant - last verse)", "", 8, -1),
        ]);
        expect(report.variants).toEqual([
            {
                record: "Abba, Father (Descant - last verse)",
                title: "Abba, Father",
                variantNote: "Descant - last verse",
                tune: null,
                tuneFromBase: false,
                sharesSong: false,
                labels: ["R-8"],
            },
        ]);
        expect(report.songsWithoutTune).toEqual([
            { title: "Abba, Father", labels: ["R-8"], reason: "variant-without-tune" },
        ]);
        expect(rows.entries.at(-1)).toMatchObject({ tuneKey: null, variantNote: "Descant - last verse" });
    });

    test("does not pair a Great Hymns record with a hymn that has no Rejoice tune", () => {
        const { report } = planHymnsJsonImport([
            record("Only in Great", "", -1, 12),
            record("Both Tune-less", "", 3, -1),
            record("Both Tune-less", "", -1, 4),
        ]);
        expect(report.splitPairs).toEqual([]);
        expect(report.songsWithoutTune).toEqual([
            { title: "Only in Great", labels: ["G-12"], reason: "no-tune" },
            { title: "Both Tune-less", labels: ["R-3", "G-4"], reason: "no-tune" },
        ]);
    });

    test("leaves out, and reports, an entry whose number another record has", () => {
        const { report, rows } = planHymnsJsonImport([
            record("First", "TUNE A", 10, -1),
            record("Second", "TUNE B", 10, 20),
        ]);
        expect(report.skippedEntries).toEqual([
            { record: "Second", label: "R-10", reason: "number-taken" },
        ]);
        expect(rows.entries.map(({ hymnKey, bookCode }) => [hymnKey, bookCode])).toEqual([
            ["first", "R"],
            ["second", "G"],
        ]);
        expect(report.planned.entries).toBe(2);
    });

    test("leaves out, and reports, a second entry of one song in one book", () => {
        const { report, rows } = planHymnsJsonImport([
            record("Hymn", "TUNE", 10, -1),
            record("Hymn!", "TUNE", 11, -1),
        ]);
        expect(report.skippedEntries).toEqual([
            { record: "Hymn!", label: "R-11", reason: "song-already-in-book" },
        ]);
        expect(rows.entries).toHaveLength(1);
    });

    test("reports a merge that matches no record", () => {
        const { report } = planHymnsJsonImport([record("Hymn", "TUNE", 1, -1)]);
        expect(report.merges.map(({ records }) => records)).toEqual([0, 0, 0, 0, 0]);
    });

    test("titles a fixed hymn by the merge list when no record spells it right", () => {
        const { rows } = planHymnsJsonImport([
            record("Is Your All on the Alter?", "HOFFMAN", 491, 381),
        ]);
        expect(rows.hymns).toEqual([
            {
                key: "is your all on the altar",
                title: "Is Your All on the Altar?",
                aliases: [{ alias: "Is Your All on the Alter?", normalized: "is your all on the alter" }],
            },
        ]);
    });

    test("labels entries with the seed books' formats", () => {
        expect(SEED_BOOKS.map(({ labelFormat }) => labelFormat)).toEqual(["R-{n}", "G-{n}"]);
    });
});
