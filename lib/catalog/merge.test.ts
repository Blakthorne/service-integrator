import { describe, expect, test } from "vitest";
import {
    joinNotes,
    planHymnMerge,
    planTuneMerge,
    type MergeEntry,
    type MergeHymn,
    type MergeSong,
    type MergeTune,
} from "./merge";

const REJOICE = { bookId: 1, bookName: "Rejoice Hymns" };
const GREAT = { bookId: 2, bookName: "Great Hymns of the Faith" };

let nextEntryId = 1;

/** An entry in a book, labelled. */
function entry(book: typeof REJOICE, label: string, variantNote: string | null = null): MergeEntry {
    return { id: nextEntryId++, ...book, label, variantNote };
}

function song(fields: Partial<MergeSong> & Pick<MergeSong, "id" | "hymnId" | "title">): MergeSong {
    return {
        tuneId: null,
        tuneName: null,
        pcoSongId: null,
        pcoTitle: null,
        notes: null,
        entries: [],
        marks: [],
        ...fields,
    };
}

function hymn(fields: Partial<MergeHymn> & Pick<MergeHymn, "id" | "title">): MergeHymn {
    return { firstLine: null, notes: null, aliases: [], songs: [], ...fields };
}

function tune(fields: Partial<MergeTune> & Pick<MergeTune, "id" | "name">): MergeTune {
    return { meter: null, notes: null, aliases: [], songs: [], ...fields };
}

const DARWALL = { tuneId: 10, tuneName: "DARWALL" };
const GOPSAL = { tuneId: 11, tuneName: "GOPSAL" };

/**
 * "Rejoice - the Lord Is King" (the source) and "Rejoice, the Lord Is King"
 * (the target), each to DARWALL; the source also to GOPSAL.
 */
function rejoiceHymns() {
    const source = hymn({
        id: 1,
        title: "Rejoice - the Lord Is King",
        aliases: ["Rejoice! The Lord Is King"],
        songs: [
            song({ id: 101, hymnId: 1, title: "Rejoice - the Lord Is King", ...DARWALL, entries: [entry(GREAT, "G-143")] }),
            song({ id: 102, hymnId: 1, title: "Rejoice - the Lord Is King", ...GOPSAL, entries: [entry(GREAT, "G-144")] }),
        ],
    });
    const target = hymn({
        id: 2,
        title: "Rejoice, the Lord Is King",
        songs: [song({ id: 201, hymnId: 2, title: "Rejoice, the Lord Is King", ...DARWALL, entries: [entry(REJOICE, "R-43")] })],
    });
    return { source, target };
}

describe("planHymnMerge", () => {
    test("moves a song to a tune the target lacks, and merges one to a tune it has", () => {
        const { source, target } = rejoiceHymns();
        expect(planHymnMerge(source, target)).toEqual({
            kind: "hymn",
            source: { id: 1, name: "Rejoice - the Lord Is King" },
            target: { id: 2, name: "Rejoice, the Lord Is King" },
            moves: [
                {
                    songId: 102,
                    from: "Rejoice - the Lord Is King (GOPSAL)",
                    to: "Rejoice, the Lord Is King (GOPSAL)",
                    entries: ["G-144"],
                },
            ],
            merges: [
                {
                    sourceSongId: 101,
                    targetSongId: 201,
                    source: "Rejoice - the Lord Is King (DARWALL)",
                    target: "Rejoice, the Lord Is King (DARWALL)",
                    entries: ["G-143"],
                    marks: [],
                    notes: false,
                    link: null,
                },
            ],
            aliasesAdded: ["Rejoice - the Lord Is King", "Rejoice! The Lord Is King"],
            detailTaken: null,
            notesAdded: false,
            refusals: [],
        });
    });

    test("merges the two hymns' songs with no tune, as it does two to one tune", () => {
        const source = hymn({
            id: 1,
            title: "Thank You Lord",
            songs: [song({ id: 101, hymnId: 1, title: "Thank You Lord", entries: [entry(GREAT, "G-221")] })],
        });
        const target = hymn({
            id: 2,
            title: "Thank You, Lord",
            songs: [
                song({ id: 201, hymnId: 2, title: "Thank You, Lord", entries: [entry(REJOICE, "R-266")] }),
                song({ id: 202, hymnId: 2, title: "Thank You, Lord", tuneId: 12, tuneName: "LYNCH" }),
            ],
        });
        const preview = planHymnMerge(source, target);
        expect(preview.moves).toEqual([]);
        expect(preview.merges).toEqual([
            expect.objectContaining({ sourceSongId: 101, targetSongId: 201, entries: ["G-221"] }),
        ]);
        expect(preview.refusals).toEqual([]);
    });

    test("moves the marks the target song lacks, its notes, and its link when the target has none", () => {
        const { source, target } = rejoiceHymns();
        source.songs[0] = {
            ...source.songs[0],
            pcoSongId: "1001",
            pcoTitle: "Rejoice the Lord Is King",
            notes: "Key of C",
            marks: [{ mark: "to-learn", note: null, createdAt: "2026-10-01T00:00:00.000Z" }],
        };
        expect(planHymnMerge(source, target).merges[0]).toMatchObject({
            marks: ["to-learn"],
            notes: true,
            link: { pcoSongId: "1001", title: "Rejoice the Lord Is King" },
        });

        target.songs[0] = {
            ...target.songs[0],
            pcoSongId: null,
            marks: [{ mark: "to-learn", note: "Advent", createdAt: "2026-09-01T00:00:00.000Z" }],
        };
        expect(planHymnMerge(source, target).merges[0]).toMatchObject({ marks: [], link: { pcoSongId: "1001" } });
    });

    test("keeps the target song's link, moving none, when only the target song is linked", () => {
        const { source, target } = rejoiceHymns();
        target.songs[0] = { ...target.songs[0], pcoSongId: "2002", pcoTitle: "Rejoice, the Lord Is King" };
        const preview = planHymnMerge(source, target);
        expect(preview.merges[0].link).toBeNull();
        expect(preview.refusals).toEqual([]);
    });

    test("refuses two songs that would merge but are linked to different Planning Center songs", () => {
        const { source, target } = rejoiceHymns();
        source.songs[0] = { ...source.songs[0], pcoSongId: "1001", pcoTitle: "Rejoice (DARWALL)" };
        target.songs[0] = { ...target.songs[0], pcoSongId: "2002", pcoTitle: null };
        expect(planHymnMerge(source, target).refusals).toEqual([
            {
                reason: "linked-apart",
                message:
                    '"Rejoice - the Lord Is King (DARWALL)" and "Rejoice, the Lord Is King (DARWALL)" are linked to different Planning Center songs, "Rejoice (DARWALL)" and Planning Center song 2002. Unlink one of them first.',
                songIds: [101, 201],
            },
        ]);
    });

    test("refuses a merged song with two plain entries in one book", () => {
        const { source, target } = rejoiceHymns();
        source.songs[0] = { ...source.songs[0], entries: [entry(REJOICE, "R-44"), entry(GREAT, "G-143")] };
        expect(planHymnMerge(source, target).refusals).toEqual([
            {
                reason: "entry-collision",
                message:
                    '"Rejoice, the Lord Is King (DARWALL)" would be in Rejoice Hymns twice: R-43 and R-44. Delete one of the entries, or give one a variant note, first.',
                songIds: [101, 201],
            },
        ]);
    });

    test("refuses two entries in one book with the same variant note, and allows different ones", () => {
        const { source, target } = rejoiceHymns();
        target.songs[0] = { ...target.songs[0], entries: [entry(REJOICE, "R-43"), entry(REJOICE, "R-44", "Descant")] };
        source.songs[0] = { ...source.songs[0], entries: [entry(REJOICE, "R-45", "Descant")] };
        expect(planHymnMerge(source, target).refusals).toEqual([
            expect.objectContaining({
                reason: "entry-collision",
                message: expect.stringContaining('in Rejoice Hymns twice with the variant note "Descant": R-44 and R-45.'),
            }),
        ]);
        source.songs[0] = { ...source.songs[0], entries: [entry(REJOICE, "R-45", "A Round")] };
        expect(planHymnMerge(source, target).refusals).toEqual([]);
    });

    test("refuses a hymn merged into itself, planning nothing", () => {
        const { source } = rejoiceHymns();
        expect(planHymnMerge(source, source)).toMatchObject({
            moves: [],
            merges: [],
            aliasesAdded: [],
            refusals: [
                {
                    reason: "same",
                    message: "A hymn cannot be merged into itself. Choose another hymn.",
                    songIds: [],
                },
            ],
        });
    });

    test("gives the target the source's names but those it has, once each", () => {
        const source = hymn({
            id: 1,
            title: "Hallelujah, What a Savior!",
            aliases: ["Hallelujah! What a Savior", "Man of Sorrows"],
        });
        const target = hymn({ id: 2, title: "Hallelujah! What a Savior", aliases: ["Man of Sorrows! What a Name"] });
        expect(planHymnMerge(source, target).aliasesAdded).toEqual(["Hallelujah, What a Savior!", "Man of Sorrows"]);
    });

    test("takes the source's first line when the target has none, and adds its notes", () => {
        const source = hymn({ id: 1, title: "A", firstLine: "First line A", notes: "Notes A" });
        const target = hymn({ id: 2, title: "B" });
        expect(planHymnMerge(source, target)).toMatchObject({ detailTaken: "First line A", notesAdded: true });
        expect(planHymnMerge(source, { ...target, firstLine: "First line B" })).toMatchObject({ detailTaken: null });
        expect(planHymnMerge({ ...source, notes: null }, target)).toMatchObject({ notesAdded: false });
    });
});

describe("planTuneMerge", () => {
    test("merges the songs of one hymn, moves the others, and names the moved songs by the target tune", () => {
        const source = tune({
            id: 10,
            name: "DARWAL",
            meter: "6.6.6.6.8.8",
            songs: [
                song({ id: 101, hymnId: 1, title: "Rejoice, the Lord Is King", tuneId: 10, tuneName: "DARWAL", entries: [entry(GREAT, "G-143")] }),
                song({ id: 102, hymnId: 3, title: "Ye Holy Angels Bright", tuneId: 10, tuneName: "DARWAL" }),
            ],
        });
        const target = tune({
            id: 11,
            name: "DARWALL",
            aliases: ["DARWALL'S 148TH"],
            songs: [song({ id: 201, hymnId: 1, title: "Rejoice, the Lord Is King", tuneId: 11, tuneName: "DARWALL", entries: [entry(REJOICE, "R-43")] })],
        });
        expect(planTuneMerge(source, target)).toEqual({
            kind: "tune",
            source: { id: 10, name: "DARWAL" },
            target: { id: 11, name: "DARWALL" },
            moves: [
                {
                    songId: 102,
                    from: "Ye Holy Angels Bright (DARWAL)",
                    to: "Ye Holy Angels Bright (DARWALL)",
                    entries: [],
                },
            ],
            merges: [
                expect.objectContaining({
                    sourceSongId: 101,
                    targetSongId: 201,
                    source: "Rejoice, the Lord Is King (DARWAL)",
                    target: "Rejoice, the Lord Is King (DARWALL)",
                    entries: ["G-143"],
                }),
            ],
            aliasesAdded: ["DARWAL"],
            detailTaken: "6.6.6.6.8.8",
            notesAdded: false,
            refusals: [],
        });
    });

    test("refuses a tune merged into itself, and colliding entries", () => {
        const one = tune({ id: 10, name: "DARWALL" });
        expect(planTuneMerge(one, one).refusals).toEqual([
            { reason: "same", message: "A tune cannot be merged into itself. Choose another tune.", songIds: [] },
        ]);
        const source = tune({
            id: 10,
            name: "A",
            songs: [song({ id: 101, hymnId: 1, title: "H", tuneId: 10, tuneName: "A", entries: [entry(REJOICE, "R-1")] })],
        });
        const target = tune({
            id: 11,
            name: "B",
            songs: [song({ id: 201, hymnId: 1, title: "H", tuneId: 11, tuneName: "B", entries: [entry(REJOICE, "R-2")] })],
        });
        expect(planTuneMerge(source, target).refusals.map(({ reason }) => reason)).toEqual(["entry-collision"]);
    });

    test("leaves out a name that is the target's own, by the tune normalization", () => {
        const source = tune({ id: 10, name: "St. Anne", aliases: ["ST ANNE"] });
        const target = tune({ id: 11, name: "ST. ANNE" });
        expect(planTuneMerge(source, target).aliasesAdded).toEqual(["ST ANNE"]);
    });
});

describe("joinNotes", () => {
    test("puts the added notes after the kept ones, or gives whichever there is", () => {
        expect(joinNotes("Kept", "Added")).toBe("Kept\n\nAdded");
        expect(joinNotes(null, "Added")).toBe("Added");
        expect(joinNotes("Kept", null)).toBe("Kept");
        expect(joinNotes(null, null)).toBeNull();
    });
});
