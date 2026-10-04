import { describe, expect, test } from "vitest";
import type { CatalogSongOption, MirroredPcoSong, UnlinkedPcoSong } from "@/lib/domain";
import {
    PICKER_LIMIT,
    describeHymnOption,
    describePickerMatches,
    describeSongOption,
    describeTuneOption,
    filterUnlinkedPcoSongs,
    searchHymnOptions,
    searchSongOptions,
    searchTuneOptions,
    type HymnOption,
    type TuneOption,
} from "./pickers";

function songOption(
    songId: number,
    title: string,
    tuneName: string | null,
    labels: string[] = [],
    pcoSongId: string | null = null
): CatalogSongOption {
    return { songId, title, tuneName, labels, pcoSongId };
}

/** Song options by title, as Reconcile gets them. */
const SONGS = [
    songOption(1, "Abba, Father", "ABBA, FATHER", ["R-42"]),
    songOption(2, "Abba, Father", "PRITCHARD", ["R-7"]),
    songOption(3, "Amazing Grace", "NEW BRITAIN", ["R-130", "G-236"], "1001"),
    songOption(4, "Doxology", null, ["G-Front Cover"]),
    songOption(5, "Grace Greater than Our Sin", "MOODY", ["R-396"]),
    songOption(6, "Jesus' Name Above All Names", null, []),
];

/** The song ids a search finds, in order. */
function songIds(query: string, limit?: number): number[] {
    return searchSongOptions(SONGS, query, limit).matches.map(({ songId }) => songId);
}

describe("searchSongOptions", () => {
    test("finds nothing until something is typed", () => {
        expect(searchSongOptions(SONGS, "")).toEqual({ matches: [], total: 0 });
        expect(searchSongOptions(SONGS, " -- ")).toEqual({ matches: [], total: 0 });
    });

    test("finds a song by an entry's label, in any case and spacing, or by its number", () => {
        expect(songIds("R-396")).toEqual([5]);
        expect(songIds("r 130")).toEqual([3]);
        expect(songIds("g front cover")).toEqual([4]);
        expect(songIds("396")).toEqual([5]);
    });

    test("puts a title the search starts before one that only holds its words", () => {
        expect(songIds("grace")).toEqual([5, 3]);
        expect(songIds("amazing grace")).toEqual([3]);
    });

    test("finds a song by its tune's name, and by words in any order", () => {
        expect(songIds("pritchard")).toEqual([2]);
        expect(songIds("father abba")).toEqual([1, 2]);
    });

    test("ignores case, punctuation and apostrophes", () => {
        expect(songIds("JESUS NAME")).toEqual([6]);
        expect(songIds("abba father")).toEqual([1, 2]);
    });

    test("shows at most the limit, and counts every match", () => {
        expect(PICKER_LIMIT).toBe(8);
        expect(searchSongOptions(SONGS, "a", 2)).toEqual({
            matches: [SONGS[0], SONGS[1]],
            total: 5,
        });
    });
});

const HYMNS: HymnOption[] = [
    { id: 1, title: "Amazing Grace", aliases: [], tunes: ["NEW BRITAIN"] },
    { id: 2, title: "Holy, Holy, Holy", aliases: [], tunes: ["NICAEA"] },
    { id: 3, title: "Holy, Holy, Holy", aliases: [], tunes: [null] },
    {
        id: 4,
        title: "Rejoice, the Lord Is King",
        aliases: ["Rejoice - the Lord Is King!"],
        tunes: ["DARWALL"],
    },
    { id: 5, title: "The King of Love My Shepherd Is", aliases: [], tunes: ["ST. COLUMBA"] },
];

describe("searchHymnOptions", () => {
    const ids = (query: string) => searchHymnOptions(HYMNS, query).matches.map(({ id }) => id);

    test("finds hymns by title, the closest first", () => {
        expect(ids("holy")).toEqual([2, 3]);
        expect(ids("king")).toEqual([4, 5]);
        expect(ids("the king")).toEqual([5, 4]);
    });

    test("finds a hymn by another title, or by its tune", () => {
        expect(ids("rejoice the lord")).toEqual([4]);
        expect(ids("holy nicaea")).toEqual([2]);
        expect(ids("st columba")).toEqual([5]);
    });
});

const TUNES: TuneOption[] = [
    { id: 1, name: "DARWALL", aliases: ["DARWAL"], meter: "6.6.6.6.8.8" },
    { id: 2, name: "NEW BRITAIN", aliases: [], meter: "C.M." },
    { id: 3, name: "ST. ANNE", aliases: [], meter: "C.M." },
    { id: 4, name: "ANNE'S TUNE", aliases: [], meter: null },
];

describe("searchTuneOptions", () => {
    const ids = (query: string) => searchTuneOptions(TUNES, query).matches.map(({ id }) => id);

    test("finds tunes by name or other name, in any case and punctuation", () => {
        expect(ids("darwal")).toEqual([1]);
        expect(ids("st anne")).toEqual([3]);
        expect(ids("anne")).toEqual([4, 3]);
        expect(ids("britain")).toEqual([2]);
    });
});

function unlinked(id: string, title: string, author: string | null = null): UnlinkedPcoSong {
    const pcoSong: MirroredPcoSong = {
        id,
        title,
        author,
        copyright: null,
        ccliNumber: null,
        admin: null,
        themes: null,
        hidden: false,
        lastScheduledAt: null,
        createdAt: null,
        updatedAt: null,
        syncedAt: "2026-10-04T12:00:00.000Z",
        removedAt: null,
        ignoredAt: null,
        autoLinkBlockedAt: null,
    };
    return { pcoSong, suggestions: [] };
}

describe("filterUnlinkedPcoSongs", () => {
    const ROWS = [
        unlinked("1", "Shout to the Lord", "Darlene Zschech"),
        unlinked("2", "Abba, Father (PRITCHARD)"),
        unlinked("3", "In Christ Alone", "Keith Getty and Stuart Townend"),
    ];
    const ids = (query: string) => filterUnlinkedPcoSongs(ROWS, query).map(({ pcoSong }) => pcoSong.id);

    test("keeps every row for an empty search", () => {
        expect(ids("")).toEqual(["1", "2", "3"]);
        expect(ids(" ")).toEqual(["1", "2", "3"]);
    });

    test("finds rows by words of the title or the author, in any order", () => {
        expect(ids("lord shout")).toEqual(["1"]);
        expect(ids("pritchard")).toEqual(["2"]);
        expect(ids("getty")).toEqual(["3"]);
        expect(ids("zzz")).toEqual([]);
    });
});

describe("the lines under an option", () => {
    test("give a song's tune and labels", () => {
        expect(describeSongOption(SONGS[2])).toBe("NEW BRITAIN · R-130, G-236");
        expect(describeSongOption(SONGS[3])).toBe("no tune · G-Front Cover");
        expect(describeSongOption(SONGS[5])).toBe("no tune");
    });

    test("give the tunes a hymn is sung to", () => {
        expect(describeHymnOption(HYMNS[0])).toBe("Sung to NEW BRITAIN");
        expect(describeHymnOption({ ...HYMNS[0], tunes: ["NEW BRITAIN", null] })).toBe(
            "Sung to NEW BRITAIN, no tune"
        );
        expect(describeHymnOption({ ...HYMNS[0], tunes: [] })).toBe("No song yet");
    });

    test("give a tune's meter and other names", () => {
        expect(describeTuneOption(TUNES[0])).toBe("6.6.6.6.8.8 · also DARWAL");
        expect(describeTuneOption(TUNES[1])).toBe("C.M.");
        expect(describeTuneOption(TUNES[3])).toBe("");
    });
});

describe("describePickerMatches", () => {
    test("prompts before anything is typed", () => {
        expect(describePickerMatches(" ", { matches: [], total: 0 })).toBe("Type to search.");
    });

    test("counts the matches, and says when typing more would narrow them", () => {
        expect(describePickerMatches("zz", { matches: [], total: 0 })).toBe("Nothing matches.");
        expect(describePickerMatches("grace", { matches: [1], total: 1 })).toBe("1 match.");
        expect(describePickerMatches("grace", { matches: [1, 2], total: 2 })).toBe("2 matches.");
        expect(describePickerMatches("a", { matches: [1, 2], total: 54 })).toBe(
            "Showing 2 of 54 matches: type more to narrow them."
        );
    });
});
