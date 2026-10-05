import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { EMPTY_NEW_SONG } from "@/lib/catalog/validation";
import { findCatalogSong } from "@/lib/db/catalog";
import { findPcoSong } from "@/lib/db/pcoSongs";
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
    songResource,
    stubFetchRoutes,
    stubPcoCredentials,
} from "@/lib/pco/testing";

// vi.hoisted: vi.mock factories run before the module's own declarations.
const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/lib/db", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/db")>()),
    getDb,
}));

import {
    createSong,
    getMirroredPcoSong,
    getNewSongBooks,
    getNewSongFormData,
    unlinkCatalogSong,
} from "./catalogEdit";

let db: DatabaseSync;

beforeEach(() => {
    db = openTestDb();
    getDb.mockReturnValue(db);
    stubPcoCredentials();
});

afterEach(() => {
    db.close();
    getDb.mockReset();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

const NOW = new Date("2026-10-04T12:00:00.000Z");

/**
 * Rejoice and Great Hymns, and an inactive book; Abba, Father to two tunes
 * and Amazing Grace to one, which is linked; in the mirror, the linked song
 * and an unlinked one.
 */
function seed() {
    const rejoice = seedBook(db, { code: "R", name: "Rejoice Hymns", shortName: "Rejoice" });
    seedBook(db, { code: "G", name: "Great Hymns of the Faith", shortName: "Great Hymns" });
    seedBook(db, { code: "OLD", name: "Old Book", active: false });
    const abbaFather = seedHymn(db, { title: "Abba, Father", aliases: ["Father, We Adore You"] });
    const tunes = {
        abbaFather: seedTune(db, { name: "ABBA, FATHER" }),
        pritchard: seedTune(db, { name: "PRITCHARD", meter: "8.7.8.7.D", aliases: ["PRICHARD"] }),
        newBritain: seedTune(db, { name: "NEW BRITAIN" }),
    };
    const songs = {
        abbaFather: seedSong(db, { hymnId: abbaFather, tuneId: tunes.abbaFather }),
        abbaFatherPritchard: seedSong(db, { hymnId: abbaFather, tuneId: tunes.pritchard }),
        amazingGrace: seedSong(db, {
            hymnId: seedHymn(db, { title: "Amazing Grace" }),
            tuneId: tunes.newBritain,
            pcoSongId: "1001",
            linkedAt: NOW.toISOString(),
            linkedBy: "auto",
        }),
    };
    seedEntry(db, { bookId: rejoice, songId: songs.amazingGrace, number: 130 });
    seedPcoSong(db, { id: "1001", title: "Amazing Grace", author: "John Newton" });
    seedPcoSong(db, { id: "1002", title: "Abba, Father (PRITCHARD)", author: "Unknown" });
    return { abbaFather, tunes, songs };
}

describe("getNewSongFormData", () => {
    test("lists every hymn with its tunes, every tune, and the active books, starting empty", async () => {
        const { abbaFather, tunes } = seed();
        const fetchMock = stubFetchRoutes({});
        const data = await getNewSongFormData(null);
        expect(data.hymns).toEqual([
            {
                id: abbaFather,
                title: "Abba, Father",
                aliases: ["Father, We Adore You"],
                tunes: ["ABBA, FATHER", "PRITCHARD"],
            },
            expect.objectContaining({ title: "Amazing Grace", tunes: ["NEW BRITAIN"] }),
        ]);
        expect(data.tunes).toEqual([
            { id: tunes.abbaFather, name: "ABBA, FATHER", aliases: [], meter: null },
            { id: tunes.newBritain, name: "NEW BRITAIN", aliases: [], meter: null },
            { id: tunes.pritchard, name: "PRITCHARD", aliases: ["PRICHARD"], meter: "8.7.8.7.D" },
        ]);
        expect(data.books.map(({ code }) => code)).toEqual(["R", "G"]);
        expect(data.books[0]).toEqual({
            id: expect.any(Number),
            code: "R",
            name: "Rejoice Hymns",
            shortName: "Rejoice",
            numbered: true,
            labelFormat: "R-{n}",
        });
        expect(data.pcoSong).toBeNull();
        expect(data.draft).toEqual(EMPTY_NEW_SONG);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    test("prefills the form from a mirrored Planning Center song, without asking Planning Center", async () => {
        const { abbaFather, tunes } = seed();
        const fetchMock = stubFetchRoutes({});
        const data = await getNewSongFormData("1002");
        expect(data.pcoSong).toEqual({
            id: "1002",
            title: "Abba, Father (PRITCHARD)",
            author: "Unknown",
            removed: false,
            linkedTo: null,
        });
        expect(data.draft.values).toMatchObject({
            hymn: "existing",
            hymnId: String(abbaFather),
            tune: "existing",
            tuneId: String(tunes.pritchard),
        });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    test("says when the Planning Center song is linked already, or deleted", async () => {
        const { songs } = seed();
        stubFetchRoutes({});
        expect((await getNewSongFormData("1001")).pcoSong?.linkedTo).toEqual({
            songId: songs.amazingGrace,
            label: "Amazing Grace (NEW BRITAIN)",
        });
        seedPcoSong(db, { id: "1003", title: "Gone", removedAt: NOW.toISOString() });
        expect((await getNewSongFormData("1003")).pcoSong?.removed).toBe(true);
    });

    test("mirrors a Planning Center song the mirror lacks, then prefills from it", async () => {
        seed();
        const fetchMock = stubFetchRoutes({
            [`${PCO_BASE}/songs/1500`]: {
                data: songResource("1500", { title: "Be Thou My Vision (SLANE)" }),
            },
        });
        const data = await getNewSongFormData("1500");
        expect(calledUrls(fetchMock)).toEqual([`${PCO_BASE}/songs/1500`]);
        expect(findPcoSong(db, "1500")?.title).toBe("Be Thou My Vision (SLANE)");
        expect(data.draft.values).toMatchObject({
            hymn: "new",
            hymnTitle: "Be Thou My Vision",
            tune: "new",
            tuneName: "SLANE",
        });
    });

    test("gives the empty form, with no song to link, for a song Planning Center does not have", async () => {
        seed();
        stubFetchRoutes({
            [`${PCO_BASE}/songs/404`]: () => json({ errors: [] }, { status: 404 }),
        });
        const data = await getNewSongFormData("404");
        expect(data.pcoSong).toBeNull();
        expect(data.draft).toEqual(EMPTY_NEW_SONG);
    });

    test("lets a Planning Center failure through", async () => {
        seed();
        stubFetchRoutes({
            [`${PCO_BASE}/songs/1500`]: () => json({ errors: [] }, { status: 500 }),
        });
        await expect(getNewSongFormData("1500")).rejects.toMatchObject({
            name: "PcoError",
            status: 500,
        });
    });
});

describe("getNewSongBooks", () => {
    test("gives the active books, as validation needs them", () => {
        seed();
        expect(getNewSongBooks()).toEqual([
            { id: expect.any(Number), name: "Rejoice Hymns", numbered: true },
            { id: expect.any(Number), name: "Great Hymns of the Faith", numbered: true },
        ]);
    });
});

describe("createSong", () => {
    test("adds the song and links it to a mirrored Planning Center song", async () => {
        const { abbaFather, tunes } = seed();
        stubFetchRoutes({});
        const newBritain = await createSong(
            {
                hymn: { kind: "existing", hymnId: abbaFather },
                tune: { kind: "existing", tuneId: tunes.newBritain },
                entry: null,
                pcoSongId: "1002",
            },
            NOW
        );
        expect(newBritain).toEqual({ ok: true, songId: expect.any(Number) });
        const songId = newBritain.ok ? newBritain.songId : 0;
        expect(findCatalogSong(db, songId)).toMatchObject({
            hymnId: abbaFather,
            tuneId: tunes.newBritain,
            pcoSongId: "1002",
            linkedBy: "manual",
        });
    });

    test("mirrors a Planning Center song the mirror lacks before linking it", async () => {
        seed();
        stubFetchRoutes({
            [`${PCO_BASE}/songs/1500`]: { data: songResource("1500", { title: "Be Thou My Vision" }) },
        });
        const result = await createSong(
            {
                hymn: { kind: "new", title: "Be Thou My Vision" },
                tune: { kind: "none" },
                entry: null,
                pcoSongId: "1500",
            },
            NOW
        );
        expect(result).toMatchObject({ ok: true });
        expect(findPcoSong(db, "1500")?.syncedAt).toBe(NOW.toISOString());
    });

    test("writes nothing for a Planning Center song that Planning Center does not have", async () => {
        seed();
        stubFetchRoutes({
            [`${PCO_BASE}/songs/404`]: () => json({ errors: [] }, { status: 404 }),
        });
        await expect(
            createSong({
                hymn: { kind: "new", title: "Be Thou My Vision" },
                tune: { kind: "none" },
                entry: null,
                pcoSongId: "404",
            })
        ).resolves.toEqual({
            ok: false,
            problems: [
                {
                    reason: "pco-song-not-found",
                    part: null,
                    message: "There is no such Planning Center song.",
                    existing: null,
                },
            ],
        });
        expect(db.prepare("SELECT count(*) AS n FROM hymns").get()?.n).toBe(2);
    });

    test("gives the catalog's refusals as they are", async () => {
        const { abbaFather, tunes, songs } = seed();
        stubFetchRoutes({});
        await expect(
            createSong({
                hymn: { kind: "existing", hymnId: abbaFather },
                tune: { kind: "existing", tuneId: tunes.pritchard },
                entry: null,
                pcoSongId: null,
            })
        ).resolves.toMatchObject({
            ok: false,
            problems: [
                {
                    reason: "song-exists",
                    existing: { kind: "song", songId: songs.abbaFatherPritchard },
                },
            ],
        });
    });
});

describe("getMirroredPcoSong", () => {
    test("gives a song of the mirror, or null", () => {
        seed();
        expect(getMirroredPcoSong("1001")).toMatchObject({ title: "Amazing Grace", author: "John Newton" });
        expect(getMirroredPcoSong("404")).toBeNull();
    });
});

describe("unlinkCatalogSong", () => {
    test("unlinks the song and stops syncs from linking that Planning Center song again", () => {
        const { songs } = seed();
        expect(unlinkCatalogSong(songs.amazingGrace, "1001")).toEqual({ ok: true, pcoSongId: "1001" });
        expect(findCatalogSong(db, songs.amazingGrace)).toMatchObject({
            pcoSongId: null,
            linkedBy: null,
            linkedAt: null,
        });
        expect(findPcoSong(db, "1001")?.autoLinkBlockedAt).not.toBeNull();
    });

    test("refuses a link that has changed since the page showed it", () => {
        const { songs } = seed();
        expect(unlinkCatalogSong(songs.amazingGrace, "1002")).toMatchObject({
            ok: false,
            reason: "not-linked",
        });
        expect(unlinkCatalogSong(songs.abbaFather, "1001")).toMatchObject({
            ok: false,
            reason: "not-linked",
        });
        expect(findCatalogSong(db, songs.amazingGrace)?.pcoSongId).toBe("1001");
    });
});
