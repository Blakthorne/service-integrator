import { describe, expect, test } from "vitest";
import type { LabelledEntry } from "./domain";
import {
    buildCatalogIndex,
    chooseAutoLinks,
    readTuneHint,
    suggestLinks,
    tunesNamedBy,
    type AutoLinkablePcoSong,
    type IndexableSong,
} from "./reconcile";

/** The fields of a test song: its tune as [id, name], or null for an unknown tune. */
interface SongSpec {
    id: number;
    hymnId: number;
    title: string;
    tune: [number, string] | null;
    aliases?: string[];
    tuneAliases?: string[];
    pcoSongId?: string | null;
    labels?: string[];
}

/** An entry labelled "R-130" or "G-236": Rejoice is book 1, Great Hymns book 2. */
function entry(songId: number, label: string, index: number): LabelledEntry {
    const [bookCode, number] = label.split("-");
    return {
        id: songId * 100 + index,
        bookId: bookCode === "R" ? 1 : 2,
        songId,
        number: Number(number),
        position: null,
        locationLabel: null,
        variantNote: null,
        bookCode,
        label,
    };
}

function song(spec: SongSpec): IndexableSong {
    return {
        id: spec.id,
        hymnId: spec.hymnId,
        title: spec.title,
        aliases: spec.aliases ?? [],
        tuneId: spec.tune?.[0] ?? null,
        tuneName: spec.tune?.[1] ?? null,
        tuneAliases: spec.tuneAliases ?? [],
        pcoSongId: spec.pcoSongId ?? null,
        entries: (spec.labels ?? []).map((label, index) => entry(spec.id, label, index)),
    };
}

/** A part of the real catalog: hymns sung to one tune, to several, and to an unknown one. */
const SONGS = {
    amazingGrace: song({ id: 1, hymnId: 1, title: "Amazing Grace", tune: [1, "NEW BRITAIN"], labels: ["R-130", "G-236"] }),
    abbaFather: song({ id: 2, hymnId: 2, title: "Abba, Father", tune: [2, "ABBA, FATHER"], labels: ["R-42"] }),
    abbaFatherPritchard: song({ id: 3, hymnId: 2, title: "Abba, Father", tune: [3, "PRITCHARD"], labels: ["R-7"] }),
    tonguesAzmon: song({ id: 4, hymnId: 3, title: "O for a Thousand Tongues", tune: [4, "AZMON"], labels: ["R-19", "G-46"] }),
    tonguesLyngham: song({ id: 5, hymnId: 3, title: "O for a Thousand Tongues", tune: [5, "LYNGHAM"], labels: ["R-18"] }),
    rejoice: song({
        id: 6,
        hymnId: 4,
        title: "Rejoice, the Lord Is King",
        aliases: ["Rejoice \u2013 the Lord Is King!"],
        tune: [6, "DARWALL"],
        tuneAliases: ["DARWAL"],
        labels: ["R-43", "G-143"],
    }),
    gloriaGreatorex: song({ id: 7, hymnId: 5, title: "Glory Be to the Father", tune: [7, "GLORIA PATRI (GREATOREX)"], labels: ["R-572"] }),
    gloriaMeineke: song({ id: 8, hymnId: 5, title: "Glory Be to the Father", tune: [8, "GLORIA PATRI (MEINEKE)"], labels: ["R-573"] }),
    thankYouLynch: song({ id: 9, hymnId: 6, title: "Thank You, Lord", tune: [9, "LYNCH"], labels: ["R-561"] }),
    thankYouOwnTune: song({ id: 10, hymnId: 6, title: "Thank You, Lord", tune: [10, "THANK YOU, LORD"], labels: ["R-266"] }),
    thankYouNoTune: song({ id: 11, hymnId: 6, title: "Thank You, Lord", tune: null, labels: ["G-221"] }),
    jordan: song({ id: 12, hymnId: 7, title: "In Jordan\u2019s Stream", tune: [11, "BRIDGEWATER"], labels: ["G-189"] }),
    strife: song({ id: 13, hymnId: 8, title: "The Strife Is O\u2019er", tune: [12, "VICTORY"], labels: ["G-133"] }),
    assurance: song({ id: 14, hymnId: 9, title: "Blessed Assurance", tune: [13, "ASSURANCE"], labels: ["R-381", "G-255"] }),
    america: song({ id: 15, hymnId: 10, title: "America the Beautiful", tune: [14, "MATERNA"], labels: ["R-699", "G-531"] }),
    doxology: song({ id: 16, hymnId: 11, title: "Doxology", tune: [15, "OLD HUNDREDTH"], labels: ["R-14"] }),
    allPeople: song({ id: 17, hymnId: 12, title: "All People That on Earth Do Dwell", tune: [15, "OLD HUNDREDTH"], labels: ["G-8"] }),
    jesusSavesLimpsfield: song({ id: 18, hymnId: 13, title: "Jesus Saves", tune: [16, "LIMPSFIELD"], labels: ["R-341"] }),
    jesusSaves: song({ id: 19, hymnId: 13, title: "Jesus Saves", tune: [17, "JESUS SAVES"], labels: ["R-342", "G-231"] }),
};

const CATALOG = Object.values(SONGS);

/** The catalog with some songs changed, such as linked. */
function catalogWith(...changed: IndexableSong[]): IndexableSong[] {
    return CATALOG.map((original) => changed.find(({ id }) => id === original.id) ?? original);
}

const INDEX = buildCatalogIndex(CATALOG);

/** Each suggestion as [song id, reason]. */
function suggest(title: string, index = INDEX): [number, string][] {
    return suggestLinks({ title }, index).map(({ songId, reason }) => [songId, reason]);
}

/** A Planning Center song in the mirror, still in Planning Center, neither ignored nor blocked. */
function pco(
    id: string,
    title: string,
    fields: Partial<AutoLinkablePcoSong> = {}
): AutoLinkablePcoSong {
    return { id, title, removedAt: null, ignoredAt: null, autoLinkBlockedAt: null, ...fields };
}

const AT = "2026-10-04T12:00:00.000Z";

describe("buildCatalogIndex", () => {
    test("indexes songs by their hymn's normalized title and aliases", () => {
        expect(INDEX.titles.get("abba, father")).toEqual([2, 3]);
        expect(INDEX.titles.get("in jordan's stream")).toEqual([12]);
        expect(INDEX.aliases.get("rejoice \u2013 the lord is king")).toEqual([6]);
        expect(INDEX.songs.get(6)).toBe(SONGS.rejoice);
    });

    test("indexes tunes by their normalized names and aliases", () => {
        expect(INDEX.tunes.get("DARWALL")).toEqual(new Set([6]));
        expect(INDEX.tunes.get("DARWAL")).toEqual(new Set([6]));
        expect(INDEX.tunes.get("OLD HUNDREDTH")).toEqual(new Set([15]));
        expect(INDEX.tunes.get("GLORIA PATRI (MEINEKE)")).toEqual(new Set([8]));
    });

    test("records which Planning Center song each linked song is linked to", () => {
        const index = buildCatalogIndex(
            catalogWith({ ...SONGS.amazingGrace, pcoSongId: "1001" })
        );
        expect([...index.linked]).toEqual([["1001", SONGS.amazingGrace.id]]);
        expect(INDEX.linked.size).toBe(0);
    });

    test("is empty for an empty catalog", () => {
        const index = buildCatalogIndex([]);
        expect(index.songs.size + index.titles.size + index.tunes.size).toBe(0);
    });
});

describe("readTuneHint", () => {
    test("splits a trailing parenthetical off the title", () => {
        expect(readTuneHint("Abba, Father (PRITCHARD)")).toEqual({
            base: "Abba, Father",
            names: ["PRITCHARD"],
        });
    });

    test("offers all of the parenthetical, and its last group when that differs", () => {
        expect(readTuneHint("Glory Be to the Father (Gloria Patri (Meineke))")).toEqual({
            base: "Glory Be to the Father",
            names: ["Gloria Patri (Meineke)"],
        });
        expect(readTuneHint("Abba, Father (Descant) (PRITCHARD)")).toEqual({
            base: "Abba, Father",
            names: ["Descant) (PRITCHARD", "PRITCHARD"],
        });
    });

    test("is null for a title that does not end in one", () => {
        expect(readTuneHint("Amazing Grace")).toBeNull();
        expect(readTuneHint("O (Come) All Ye Faithful")).toBeNull();
    });
});

describe("tunesNamedBy", () => {
    test("finds the tunes a hint names, by name or alias, in any case", () => {
        expect(tunesNamedBy(readTuneHint("Abba, Father (PRITCHARD)"), INDEX)).toEqual(
            new Set([3])
        );
        expect(tunesNamedBy(readTuneHint("Rejoice (Darwal)"), INDEX)).toEqual(new Set([6]));
        expect(
            tunesNamedBy(readTuneHint("Glory Be to the Father (Gloria Patri (Meineke))"), INDEX)
        ).toEqual(new Set([8]));
    });

    test("finds none for a parenthetical that names no tune, or no parenthetical", () => {
        expect(tunesNamedBy(readTuneHint("America the Beautiful (Descant)"), INDEX)).toEqual(
            new Set()
        );
        expect(tunesNamedBy(null, INDEX)).toEqual(new Set());
    });
});

describe("suggestLinks", () => {
    test("suggests the hymn whose title the Planning Center title is, with its tune and entries", () => {
        expect(suggestLinks({ title: "Amazing Grace" }, INDEX)).toEqual([
            {
                songId: 1,
                title: "Amazing Grace",
                tuneName: "NEW BRITAIN",
                entries: SONGS.amazingGrace.entries,
                reason: "exact",
                pcoSongId: null,
            },
        ]);
    });

    test.each([
        ["case and trailing punctuation", "AMAZING GRACE!", 1],
        ["spacing", "  Amazing   Grace ", 1],
        ["a straight apostrophe for a curly one", "In Jordan's Stream", 12],
        ["a curly apostrophe for a curly one", "The Strife Is O\u2019er", 13],
        ["a left quotation mark for an apostrophe", "The Strife Is O\u2018er", 13],
    ])("matches a title exactly despite %s", (_case, title, songId) => {
        expect(suggest(title)).toEqual([[songId, "exact"]]);
    });

    test("suggests a hymn by its alias", () => {
        expect(suggest("Rejoice \u2013 the Lord Is King")).toEqual([[6, "alias"]]);
    });

    test("suggests every tune of a hymn sung to several, by tune name", () => {
        expect(suggest("O for a Thousand Tongues")).toEqual([
            [4, "exact"],
            [5, "exact"],
        ]);
        expect(suggest("Jesus Saves!")).toEqual([
            [19, "exact"],
            [18, "exact"],
        ]);
    });

    test("puts a song whose tune is unknown after the hymn's other tunes", () => {
        expect(suggest("Thank You, Lord")).toEqual([
            [9, "exact"],
            [10, "exact"],
            [11, "exact"],
        ]);
    });

    test("puts the tune a trailing parenthetical names first, then the hymn's other tunes", () => {
        expect(suggest("Abba, Father (PRITCHARD)")).toEqual([
            [3, "tune-hint"],
            [2, "near"],
        ]);
        expect(suggest("Thank You, Lord (Lynch)")).toEqual([
            [9, "tune-hint"],
            [10, "near"],
            [11, "near"],
        ]);
    });

    test("reads a tune named by an alias, in any case", () => {
        expect(suggest("Rejoice, the Lord Is King (Darwal)")).toEqual([[6, "tune-hint"]]);
    });

    test("reads a tune whose name has parentheses of its own", () => {
        expect(suggest("Glory Be to the Father (Gloria Patri (Meineke))")).toEqual([
            [8, "tune-hint"],
            [7, "near"],
        ]);
    });

    test("reads a tune named in the last of several parentheticals", () => {
        expect(suggest("Abba, Father (Descant) (PRITCHARD)")).toEqual([
            [3, "tune-hint"],
            [2, "near"],
        ]);
    });

    test("takes a tune hint after a hymn's alias", () => {
        expect(suggest("Rejoice \u2013 the Lord Is King! (DARWALL)")).toEqual([[6, "tune-hint"]]);
    });

    test("offers the hymn as a near match when the parenthetical names none of its tunes", () => {
        expect(suggest("America the Beautiful (Descant)")).toEqual([[15, "near"]]);
        expect(suggest("Amazing Grace (AZMON)")).toEqual([[1, "near"]]);
        expect(suggest("O for a Thousand Tongues (Key of G)")).toEqual([
            [4, "near"],
            [5, "near"],
        ]);
    });

    test("offers a title a letter or two away as a near match", () => {
        expect(suggest("Blesed Assurance")).toEqual([[14, "near"]]);
        expect(suggest("O for a Thousand Tongue")).toEqual([
            [4, "near"],
            [5, "near"],
        ]);
        expect(suggest("Blesed Assurance (ASSURANCE)")).toEqual([[14, "near"]]);
    });

    test("puts a song linked to another Planning Center song after the unlinked ones, saying which", () => {
        const index = buildCatalogIndex(
            catalogWith({ ...SONGS.tonguesAzmon, pcoSongId: "1004" })
        );
        expect(
            suggestLinks({ title: "O for a Thousand Tongues" }, index).map(
                ({ songId, pcoSongId }) => [songId, pcoSongId]
            )
        ).toEqual([
            [5, null],
            [4, "1004"],
        ]);
    });

    test("keeps the strongest reason that finds a song", () => {
        // The title, and nearly its alias "Rejoice \u2013 the Lord Is King!".
        expect(suggest("Rejoice, the Lord Is King")).toEqual([[6, "exact"]]);
    });

    test.each(["Shout to the Lord", "", "   ", "(Instrumental)"])(
        "suggests nothing for %j",
        (title) => {
            expect(suggest(title)).toEqual([]);
        }
    );
});

describe("chooseAutoLinks", () => {
    test("links a title that is a hymn's title to the hymn's only song", () => {
        expect(chooseAutoLinks([pco("1001", "Amazing Grace")], INDEX)).toEqual([
            { pcoSongId: "1001", songId: 1 },
        ]);
    });

    test("links an alias, and a title with straight quotes for curly ones", () => {
        expect(
            chooseAutoLinks(
                [
                    pco("1006", "Rejoice \u2013 the Lord Is King!"),
                    pco("1012", "In Jordan's Stream"),
                ],
                INDEX
            )
        ).toEqual([
            { pcoSongId: "1006", songId: 6 },
            { pcoSongId: "1012", songId: 12 },
        ]);
    });

    test("links a title that names its tune, even for a hymn sung to several tunes", () => {
        expect(
            chooseAutoLinks(
                [
                    pco("1003", "Abba, Father (PRITCHARD)"),
                    pco("1005", "O for a Thousand Tongues (Lyngham)"),
                    pco("1008", "Glory Be to the Father (GLORIA PATRI (MEINEKE))"),
                    pco("1009", "Thank You, Lord (LYNCH)"),
                ],
                INDEX
            )
        ).toEqual([
            { pcoSongId: "1003", songId: 3 },
            { pcoSongId: "1005", songId: 5 },
            { pcoSongId: "1008", songId: 8 },
            { pcoSongId: "1009", songId: 9 },
        ]);
    });

    test("never links a hymn sung to several tunes, or to an unknown one, from its bare title", () => {
        expect(
            chooseAutoLinks(
                [
                    pco("1002", "Abba, Father"),
                    pco("1004", "O for a Thousand Tongues"),
                    pco("1018", "Jesus Saves!"),
                    pco("1010", "Thank You, Lord"),
                ],
                INDEX
            )
        ).toEqual([]);
    });

    test("never links on a near match", () => {
        expect(
            chooseAutoLinks(
                [
                    pco("1014", "Blesed Assurance"),
                    pco("1015", "America the Beautiful (Descant)"),
                    pco("1001", "Amazing Grace (AZMON)"),
                ],
                INDEX
            )
        ).toEqual([]);
    });

    test.each<[string, Partial<AutoLinkablePcoSong>]>([
        ["ignored", { ignoredAt: AT }],
        ["gone from Planning Center", { removedAt: AT }],
        ["blocked because an auto-link of it was undone", { autoLinkBlockedAt: AT }],
    ])("leaves alone a Planning Center song that is %s", (_state, fields) => {
        expect(chooseAutoLinks([pco("1001", "Amazing Grace", fields)], INDEX)).toEqual([]);
    });

    test("leaves alone a Planning Center song that is already linked", () => {
        const index = buildCatalogIndex(
            catalogWith({ ...SONGS.doxology, pcoSongId: "1001" })
        );
        expect(chooseAutoLinks([pco("1001", "Amazing Grace")], index)).toEqual([]);
    });

    test("never links a catalog song that is already linked", () => {
        const index = buildCatalogIndex(
            catalogWith({ ...SONGS.amazingGrace, pcoSongId: "999" })
        );
        expect(chooseAutoLinks([pco("1001", "Amazing Grace")], index)).toEqual([]);
    });

    test("never lets two Planning Center songs claim one catalog song", () => {
        expect(
            chooseAutoLinks(
                [pco("1001", "Amazing Grace"), pco("2001", "AMAZING GRACE!")],
                INDEX
            )
        ).toEqual([]);
        expect(
            chooseAutoLinks(
                [
                    pco("1006", "Rejoice, the Lord Is King"),
                    pco("2006", "Rejoice \u2013 the Lord Is King!"),
                ],
                INDEX
            )
        ).toEqual([]);
    });

    test.each<[string, Partial<AutoLinkablePcoSong>]>([
        ["ignored", { ignoredAt: AT }],
        ["blocked", { autoLinkBlockedAt: AT }],
    ])("counts the claim of a Planning Center song that is %s", (_state, fields) => {
        expect(
            chooseAutoLinks(
                [pco("1001", "Amazing Grace", fields), pco("2001", "Amazing Grace")],
                INDEX
            )
        ).toEqual([]);
    });

    test("counts the claim of a Planning Center song linked to another catalog song", () => {
        const index = buildCatalogIndex(
            catalogWith({ ...SONGS.doxology, pcoSongId: "1001" })
        );
        expect(
            chooseAutoLinks(
                [pco("1001", "Amazing Grace"), pco("2001", "Amazing Grace")],
                index
            )
        ).toEqual([]);
    });

    test("does not count a Planning Center song gone from Planning Center", () => {
        expect(
            chooseAutoLinks(
                [
                    pco("1001", "Amazing Grace", { removedAt: AT }),
                    pco("2001", "Amazing Grace"),
                ],
                INDEX
            )
        ).toEqual([{ pcoSongId: "2001", songId: 1 }]);
    });

    test("never links a title two hymns share", () => {
        const index = buildCatalogIndex([
            ...CATALOG,
            song({ id: 30, hymnId: 30, title: "Hallelujah", tune: [30, "HALLELUJAH"] }),
            song({ id: 31, hymnId: 31, title: "Hallelujah!", tune: [31, "BURNE"] }),
        ]);
        expect(chooseAutoLinks([pco("1030", "Hallelujah")], index)).toEqual([]);
        expect(suggest("Hallelujah", index)).toEqual([
            [30, "exact"],
            [31, "exact"],
        ]);
    });

    test("never links a title that is one hymn's title and another's alias", () => {
        const index = buildCatalogIndex([
            ...CATALOG,
            song({
                id: 30,
                hymnId: 30,
                title: "Amazing Grace! How Sweet the Sound",
                aliases: ["Amazing Grace"],
                tune: [30, "ARLINGTON"],
            }),
        ]);
        expect(chooseAutoLinks([pco("1001", "Amazing Grace")], index)).toEqual([]);
        expect(suggest("Amazing Grace", index)).toEqual([
            [1, "exact"],
            [30, "alias"],
        ]);
    });

    test("makes every link it may in one pass, in the order of the Planning Center songs", () => {
        expect(
            chooseAutoLinks(
                [
                    pco("1013", "The Strife Is O'er"),
                    pco("1004", "O for a Thousand Tongues"),
                    pco("1001", "Amazing Grace"),
                    pco("1016", "Doxology"),
                    pco("1017", "All People That on Earth Do Dwell"),
                ],
                INDEX
            )
        ).toEqual([
            { pcoSongId: "1013", songId: 13 },
            { pcoSongId: "1001", songId: 1 },
            { pcoSongId: "1016", songId: 16 },
            { pcoSongId: "1017", songId: 17 },
        ]);
    });

    test("chooses nothing for no songs, or an empty catalog", () => {
        expect(chooseAutoLinks([], INDEX)).toEqual([]);
        expect(chooseAutoLinks([pco("1001", "Amazing Grace")], buildCatalogIndex([]))).toEqual(
            []
        );
    });
});
