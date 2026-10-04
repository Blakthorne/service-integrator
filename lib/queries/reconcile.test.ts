import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { linkSong } from "@/lib/db/links";
import { findPcoSong } from "@/lib/db/pcoSongs";
import { finishSyncRun, startSyncRun } from "@/lib/db/syncRuns";
import {
    openTestDb,
    seedBook,
    seedEntry,
    seedHymn,
    seedPcoSong,
    seedSong,
    seedTune,
} from "@/lib/db/testing";
import {
    PCO_BASE,
    calledUrls,
    json,
    listPage,
    songResource,
    stubFetchRoutes,
    stubPcoCredentials,
    stubPcoPacer,
} from "@/lib/pco/testing";

// vi.hoisted: vi.mock factories run before the module's own declarations.
const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/lib/db", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/db")>()),
    getDb,
}));

import {
    RECENT_AUTO_LINK_DAYS,
    getReconcileData,
    ignorePcoSong,
    linkCatalogSong,
    mirrorPcoSong,
    syncPcoSongsNow,
    undoAutoLink,
    unignorePcoSong,
} from "./reconcile";

let db: DatabaseSync;

beforeEach(() => {
    db = openTestDb();
    getDb.mockReturnValue(db);
    stubPcoCredentials();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
    db.close();
    getDb.mockReset();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

const NOW = new Date("2026-10-04T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS);

/**
 * Amazing Grace auto-linked yesterday, Abba, Father to two tunes (PRITCHARD
 * auto-linked long ago), a tune-less Doxology on G's front cover; and in
 * the mirror, two unlinked songs, an ignored one and a removed one.
 */
function seed() {
    const rejoice = seedBook(db, { code: "R", name: "Rejoice Hymns" });
    const great = seedBook(db, { code: "G", name: "Great Hymns of the Faith" });
    const abbaFatherHymn = seedHymn(db, { title: "Abba, Father" });
    const songs = {
        amazingGrace: seedSong(db, {
            hymnId: seedHymn(db, { title: "Amazing Grace" }),
            tuneId: seedTune(db, { name: "NEW BRITAIN" }),
        }),
        abbaFather: seedSong(db, {
            hymnId: abbaFatherHymn,
            tuneId: seedTune(db, { name: "ABBA, FATHER" }),
        }),
        abbaFatherPritchard: seedSong(db, {
            hymnId: abbaFatherHymn,
            tuneId: seedTune(db, { name: "PRITCHARD" }),
        }),
        doxology: seedSong(db, { hymnId: seedHymn(db, { title: "Doxology" }) }),
    };
    seedEntry(db, { bookId: rejoice, songId: songs.amazingGrace, number: 130 });
    seedEntry(db, { bookId: great, songId: songs.amazingGrace, number: 236 });
    seedEntry(db, { bookId: rejoice, songId: songs.abbaFather, number: 42 });
    seedEntry(db, { bookId: rejoice, songId: songs.abbaFatherPritchard, number: 7 });
    seedEntry(db, { bookId: great, songId: songs.doxology, locationLabel: "front cover" });

    seedPcoSong(db, { id: "1001", title: "Amazing Grace" });
    seedPcoSong(db, { id: "1003", title: "Abba, Father (PRITCHARD)" });
    seedPcoSong(db, { id: "1002", title: "Abba, Father" });
    seedPcoSong(db, { id: "1050", title: "Shout to the Lord" });
    seedPcoSong(db, { id: "1099", title: "Old Chorus", ignoredAt: daysAgo(3).toISOString() });
    seedPcoSong(db, { id: "1098", title: "Gone", removedAt: daysAgo(2).toISOString() });
    linkSong(db, songs.amazingGrace, "1001", "auto", daysAgo(1));
    linkSong(db, songs.abbaFatherPritchard, "1003", "auto", daysAgo(RECENT_AUTO_LINK_DAYS + 1));
    return songs;
}

/** A catalog song's link columns. */
function linkOf(songId: number) {
    return db
        .prepare("SELECT pco_song_id, linked_by FROM songs WHERE id = ?")
        .get(songId);
}

describe("getReconcileData", () => {
    test("lists the unlinked Planning Center songs by title, each with its best suggestions", () => {
        const songs = seed();
        const { unlinked } = getReconcileData(NOW);
        expect(unlinked.map(({ pcoSong }) => pcoSong.id)).toEqual(["1002", "1050"]);
        expect(unlinked[0].pcoSong).toMatchObject({ title: "Abba, Father", ignoredAt: null });
        expect(unlinked[0].suggestions).toEqual([
            {
                songId: songs.abbaFather,
                title: "Abba, Father",
                tuneName: "ABBA, FATHER",
                entries: [expect.objectContaining({ label: "R-42" })],
                reason: "exact",
                pcoSongId: null,
            },
            expect.objectContaining({
                songId: songs.abbaFatherPritchard,
                reason: "exact",
                pcoSongId: "1003",
            }),
        ]);
        expect(unlinked[1].suggestions).toEqual([]);
    });

    test("gives each unlinked song at most three suggestions", () => {
        const hymnId = seedHymn(db, { title: "Glory Be to the Father" });
        for (const name of ["GREATOREX", "MEINEKE", "GLORIA PATRI", "OLD SCOTTISH CHANT"]) {
            seedSong(db, { hymnId, tuneId: seedTune(db, { name }) });
        }
        seedPcoSong(db, { title: "Glory Be to the Father" });
        expect(getReconcileData(NOW).unlinked[0].suggestions).toHaveLength(3);
    });

    test("lists the recent auto-links that still stand, with their entries", () => {
        const songs = seed();
        expect(getReconcileData(NOW).recentAutoLinks).toEqual([
            {
                songId: songs.amazingGrace,
                title: "Amazing Grace",
                tuneName: "NEW BRITAIN",
                entries: [
                    expect.objectContaining({ label: "R-130" }),
                    expect.objectContaining({ label: "G-236" }),
                ],
                pcoSongId: "1001",
                pcoTitle: "Amazing Grace",
                linkedAt: daysAgo(1).toISOString(),
            },
        ]);
    });

    test("lists the ignored songs still in Planning Center, and counts the catalog songs not in it", () => {
        seed();
        const data = getReconcileData(NOW);
        expect(data.ignored.map(({ id }) => id)).toEqual(["1099"]);
        expect(data.catalogSongsNotInPco).toBe(2);
    });

    test("gives the last song sync, and none before the first", () => {
        seed();
        expect(getReconcileData(NOW).lastSync).toBeNull();
        const id = startSyncRun(db, "pco-songs", daysAgo(1));
        finishSyncRun(db, id, { ok: true, message: "Synced 6 songs: no changes" }, daysAgo(1));
        startSyncRun(db, "backup", NOW);
        expect(getReconcileData(NOW).lastSync).toMatchObject({
            id,
            kind: "pco-songs",
            ok: true,
            message: "Synced 6 songs: no changes",
        });
    });

    test("lists every catalog song for a picker, by title then tune", () => {
        const songs = seed();
        expect(getReconcileData(NOW).catalogSongs).toEqual([
            {
                songId: songs.abbaFather,
                title: "Abba, Father",
                tuneName: "ABBA, FATHER",
                labels: ["R-42"],
                pcoSongId: null,
            },
            {
                songId: songs.abbaFatherPritchard,
                title: "Abba, Father",
                tuneName: "PRITCHARD",
                labels: ["R-7"],
                pcoSongId: "1003",
            },
            {
                songId: songs.amazingGrace,
                title: "Amazing Grace",
                tuneName: "NEW BRITAIN",
                labels: ["R-130", "G-236"],
                pcoSongId: "1001",
            },
            {
                songId: songs.doxology,
                title: "Doxology",
                tuneName: null,
                labels: ["G-Front Cover"],
                pcoSongId: null,
            },
        ]);
    });

    test("is empty before the first sync and the seed import", () => {
        expect(getReconcileData(NOW)).toEqual({
            unlinked: [],
            recentAutoLinks: [],
            ignored: [],
            catalogSongsNotInPco: 0,
            lastSync: null,
            catalogSongs: [],
        });
    });

    test("runs the same number of queries however many songs are unlinked", () => {
        seed();
        const prepare = vi.spyOn(db, "prepare");
        getReconcileData(NOW);
        const few = prepare.mock.calls.length;
        for (let i = 0; i < 20; i++) {
            seedPcoSong(db, { title: `Amazing Grace ${i}` });
        }
        prepare.mockClear();
        getReconcileData(NOW);
        expect(prepare.mock.calls.length).toBe(few);
    });
});

describe("mirrorPcoSong", () => {
    test("is true for a song the mirror has, without asking Planning Center", async () => {
        seed();
        const fetchMock = stubFetchRoutes({});
        await expect(mirrorPcoSong("1002")).resolves.toBe(true);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    test("reads a song the mirror lacks from Planning Center and stores it", async () => {
        const fetchMock = stubFetchRoutes({
            [`${PCO_BASE}/songs/1500`]: {
                data: songResource("1500", { title: "Be Thou My Vision" }),
            },
        });
        await expect(mirrorPcoSong("1500", NOW)).resolves.toBe(true);
        expect(calledUrls(fetchMock)).toEqual([`${PCO_BASE}/songs/1500`]);
        expect(findPcoSong(db, "1500")).toMatchObject({
            title: "Be Thou My Vision",
            syncedAt: NOW.toISOString(),
        });
    });

    test("is false for a song Planning Center does not have, or an id that is not one", async () => {
        const fetchMock = stubFetchRoutes({
            [`${PCO_BASE}/songs/404`]: () => json({ errors: [] }, { status: 404 }),
        });
        await expect(mirrorPcoSong("404")).resolves.toBe(false);
        await expect(mirrorPcoSong("../404")).resolves.toBe(false);
        expect(calledUrls(fetchMock)).toEqual([`${PCO_BASE}/songs/404`]);
        expect(findPcoSong(db, "404")).toBeNull();
    });

    test("lets any other failure through", async () => {
        stubFetchRoutes({
            [`${PCO_BASE}/songs/1500`]: () => json({ errors: [] }, { status: 500 }),
        });
        await expect(mirrorPcoSong("1500")).rejects.toMatchObject({
            name: "PcoError",
            status: 500,
        });
    });
});

describe("linkCatalogSong", () => {
    test("links a catalog song to a mirrored Planning Center song by hand", async () => {
        const { abbaFather } = seed();
        stubFetchRoutes({});
        await expect(linkCatalogSong(abbaFather, "1002")).resolves.toEqual({
            ok: true,
            changed: true,
        });
        expect(linkOf(abbaFather)).toEqual({ pco_song_id: "1002", linked_by: "manual" });
    });

    test("mirrors a Planning Center song first when the mirror lacks it", async () => {
        const { doxology } = seed();
        stubFetchRoutes({
            [`${PCO_BASE}/songs/1016`]: { data: songResource("1016", { title: "Doxology" }) },
        });
        await expect(linkCatalogSong(doxology, "1016")).resolves.toMatchObject({ ok: true });
        expect(findPcoSong(db, "1016")?.title).toBe("Doxology");
        expect(linkOf(doxology)).toEqual({ pco_song_id: "1016", linked_by: "manual" });
    });

    test("refuses a song Planning Center does not have", async () => {
        const { doxology } = seed();
        stubFetchRoutes({
            [`${PCO_BASE}/songs/404`]: () => json({ errors: [] }, { status: 404 }),
        });
        await expect(linkCatalogSong(doxology, "404")).resolves.toEqual({
            ok: false,
            reason: "pco-song-not-found",
            message: "There is no such Planning Center song.",
        });
        expect(linkOf(doxology)).toEqual({ pco_song_id: null, linked_by: null });
    });

    test("refuses a catalog song already linked to another Planning Center song", async () => {
        const { amazingGrace } = seed();
        await expect(linkCatalogSong(amazingGrace, "1002")).resolves.toEqual({
            ok: false,
            reason: "song-linked",
            message:
                '"Amazing Grace (NEW BRITAIN)" is already linked to the Planning Center song "Amazing Grace". Undo that link first.',
        });
    });
});

describe("undoAutoLink", () => {
    test("unlinks the songs and stops syncs from linking them again", () => {
        const { amazingGrace } = seed();
        expect(undoAutoLink(amazingGrace, "1001")).toEqual({ ok: true, pcoSongId: "1001" });
        expect(linkOf(amazingGrace)).toEqual({ pco_song_id: null, linked_by: null });
        expect(findPcoSong(db, "1001")?.autoLinkBlockedAt).not.toBeNull();
        expect(getReconcileData(NOW).unlinked.map(({ pcoSong }) => pcoSong.id)).toContain("1001");
    });

    test("refuses a link that has changed since the page showed it", () => {
        const { amazingGrace } = seed();
        expect(undoAutoLink(amazingGrace, "1002")).toMatchObject({
            ok: false,
            reason: "not-linked",
        });
        expect(linkOf(amazingGrace)).toMatchObject({ pco_song_id: "1001" });
    });
});

describe("ignorePcoSong and unignorePcoSong", () => {
    test("set a song aside and bring it back", () => {
        seed();
        expect(ignorePcoSong("1050", NOW)).toEqual({ ok: true });
        let data = getReconcileData(NOW);
        expect(data.ignored.map(({ id }) => id)).toEqual(["1099", "1050"]);
        expect(data.unlinked.map(({ pcoSong }) => pcoSong.id)).toEqual(["1002"]);

        expect(unignorePcoSong("1050")).toEqual({ ok: true });
        data = getReconcileData(NOW);
        expect(data.unlinked.map(({ pcoSong }) => pcoSong.id)).toEqual(["1002", "1050"]);
    });

    test("refuse to ignore a song linked to a catalog song", () => {
        seed();
        expect(ignorePcoSong("1001", NOW)).toEqual({
            ok: false,
            reason: "pco-song-linked",
            message:
                'The Planning Center song "Amazing Grace" is linked to "Amazing Grace (NEW BRITAIN)", so it cannot be ignored. Undo that link first.',
        });
        expect(findPcoSong(db, "1001")?.ignoredAt).toBeNull();
    });

    test("refuse a song the mirror lacks", () => {
        expect(ignorePcoSong("404", NOW)).toMatchObject({ reason: "pco-song-not-found" });
        expect(unignorePcoSong("404")).toMatchObject({ reason: "pco-song-not-found" });
    });
});

describe("syncPcoSongsNow", () => {
    test("runs the song sync as a job and gives its run", async () => {
        const { doxology } = seed();
        stubPcoPacer();
        stubFetchRoutes({
            [`${PCO_BASE}/songs?per_page=100`]: listPage([
                songResource("1001", { title: "Amazing Grace" }),
                songResource("1016", { title: "Doxology" }),
            ]),
        });
        await expect(syncPcoSongsNow()).resolves.toMatchObject({
            kind: "pco-songs",
            ok: true,
            counts: { fetched: 2, added: 1, autoLinked: 1 },
        });
        expect(linkOf(doxology)).toEqual({ pco_song_id: "1016", linked_by: "auto" });
    });

    test("gives a failed run rather than throwing", async () => {
        stubPcoPacer();
        stubFetchRoutes({
            [`${PCO_BASE}/songs?per_page=100`]: () => json({ errors: [] }, { status: 500 }),
        });
        await expect(syncPcoSongsNow()).resolves.toMatchObject({
            kind: "pco-songs",
            ok: false,
            message: expect.stringContaining("status: 500"),
        });
    });
});
