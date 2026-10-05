import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { linkSong, unlinkSong } from "@/lib/db/links";
import { findPcoSong, listPcoSongs, upsertPcoSongs } from "@/lib/db/pcoSongs";
import {
    openTestDb,
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
import { describePcoSongsSync, syncPcoSongs } from "./sync";

let db: DatabaseSync;

beforeEach(() => {
    db = openTestDb();
    stubPcoCredentials();
});

afterEach(() => {
    db.close();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

const FIRST_PAGE = `${PCO_BASE}/songs?per_page=100`;
const SECOND_PAGE = `${PCO_BASE}/songs?offset=100&per_page=100`;

const T1 = new Date("2026-10-04T12:00:00.000Z");
const T2 = new Date("2026-10-04T13:00:00.000Z");
const T3 = new Date("2026-10-04T14:00:00.000Z");

/** Answer the library listing with these songs, over two pages when there are more than two. */
function stubLibrary(songs: ReturnType<typeof songResource>[]) {
    const [first, rest] = [songs.slice(0, 2), songs.slice(2)];
    return stubFetchRoutes(
        rest.length === 0
            ? { [FIRST_PAGE]: listPage(first, { total: songs.length }) }
            : {
                  [FIRST_PAGE]: listPage(first, { next: SECOND_PAGE, total: songs.length }),
                  [SECOND_PAGE]: listPage(rest, { total: songs.length }),
              }
    );
}

/** Amazing Grace to one tune, Abba, Father to two. */
function seedCatalog() {
    const abbaFather = seedHymn(db, { title: "Abba, Father" });
    return {
        amazingGrace: seedSong(db, {
            hymnId: seedHymn(db, { title: "Amazing Grace" }),
            tuneId: seedTune(db, { name: "NEW BRITAIN" }),
        }),
        abbaFather: seedSong(db, {
            hymnId: abbaFather,
            tuneId: seedTune(db, { name: "ABBA, FATHER" }),
        }),
        abbaFatherPritchard: seedSong(db, {
            hymnId: abbaFather,
            tuneId: seedTune(db, { name: "PRITCHARD" }),
        }),
    };
}

/** The library as Planning Center lists it at first. */
const LIBRARY = [
    songResource("1001", { title: "Amazing Grace" }),
    songResource("1002", { title: "Abba, Father" }),
    songResource("1003", { title: "Abba, Father (PRITCHARD)" }),
    songResource("1099", { title: "Shout to the Lord", last_scheduled_at: null }),
];

/** Each catalog song's link, as [id, PCO song id, how]. */
function links(): [number, string | null, string | null][] {
    return db
        .prepare("SELECT id, pco_song_id, linked_by FROM songs ORDER BY id")
        .all()
        .map((row) => [
            Number(row.id),
            row.pco_song_id === null ? null : String(row.pco_song_id),
            row.linked_by === null ? null : String(row.linked_by),
        ]);
}

describe("syncPcoSongs", () => {
    test("mirrors the library and makes the auto-links it allows", async () => {
        const acquire = vi.spyOn(stubPcoPacer(), "acquire");
        const fetchMock = stubLibrary(LIBRARY);
        const { amazingGrace, abbaFather, abbaFatherPritchard } = seedCatalog();

        await expect(syncPcoSongs(db, () => T1)).resolves.toEqual({
            fetched: 4,
            added: 4,
            updated: 0,
            removed: 0,
            autoLinked: 2,
        });
        expect(calledUrls(fetchMock)).toEqual([FIRST_PAGE, SECOND_PAGE]);
        expect(acquire).toHaveBeenCalledTimes(2);
        expect(listPcoSongs(db).map(({ id, syncedAt }) => [id, syncedAt])).toEqual([
            ["1002", T1.toISOString()],
            ["1003", T1.toISOString()],
            ["1001", T1.toISOString()],
            ["1099", T1.toISOString()],
        ]);
        // The bare "Abba, Father" names neither of its hymn's tunes.
        expect(links()).toEqual([
            [amazingGrace, "1001", "auto"],
            [abbaFather, null, null],
            [abbaFatherPritchard, "1003", "auto"],
        ]);
    });

    test("counts what changed since the last sync, and marks the songs Planning Center dropped", async () => {
        stubPcoPacer();
        seedCatalog();
        stubLibrary(LIBRARY);
        await syncPcoSongs(db, () => T1);

        stubLibrary([
            songResource("1001", {
                title: "Amazing Grace",
                last_scheduled_at: "2026-10-04T08:00:00Z",
            }),
            songResource("1003", { title: "Abba, Father (PRITCHARD)" }),
            songResource("1099", { title: "Shout to the Lord", last_scheduled_at: null }),
            songResource("1100", { title: "Be Thou My Vision" }),
        ]);
        await expect(syncPcoSongs(db, () => T2)).resolves.toEqual({
            fetched: 4,
            added: 1,
            updated: 1,
            removed: 1,
            autoLinked: 0,
        });
        expect(findPcoSong(db, "1002")?.removedAt).toBe(T2.toISOString());
        expect(findPcoSong(db, "1001")?.lastScheduledAt).toBe("2026-10-04T08:00:00Z");

        // The dropped song comes back.
        stubLibrary([...LIBRARY, songResource("1100", { title: "Be Thou My Vision" })]);
        await expect(syncPcoSongs(db, () => T3)).resolves.toMatchObject({
            added: 0,
            updated: 2,
            removed: 0,
        });
        expect(findPcoSong(db, "1002")?.removedAt).toBeNull();
    });

    test("leaves linkable a song a page mirrored while the listing was read", async () => {
        stubPcoPacer();
        stubLibrary(LIBRARY);
        await syncPcoSongs(db, () => T1);

        // The next listing starts at T2 and is written at T3. Meanwhile a
        // song created after the listing passed it is linked from a page,
        // which mirrors it.
        const clock = vi.fn<() => Date>().mockReturnValueOnce(T2).mockReturnValue(T3);
        stubFetchRoutes({
            [FIRST_PAGE]: () => {
                upsertPcoSongs(
                    db,
                    [
                        {
                            id: "1200",
                            title: "Be Thou My Vision",
                            author: null,
                            copyright: null,
                            ccliNumber: null,
                            admin: null,
                            themes: null,
                            hidden: false,
                            lastScheduledAt: null,
                            createdAt: "2026-10-04T13:00:00Z",
                            updatedAt: "2026-10-04T13:00:00Z",
                        },
                    ],
                    new Date("2026-10-04T13:00:01.000Z")
                );
                return json(listPage(LIBRARY));
            },
        });
        await expect(syncPcoSongs(db, clock)).resolves.toMatchObject({ removed: 0 });
        expect(findPcoSong(db, "1200")?.removedAt).toBeNull();

        const vision = seedSong(db, { hymnId: seedHymn(db, { title: "Be Thou My Vision" }) });
        expect(linkSong(db, vision, "1200", "manual", T3)).toEqual({ ok: true, changed: true });
    });

    test("links a catalog song added since the last sync", async () => {
        stubPcoPacer();
        stubLibrary(LIBRARY);
        await syncPcoSongs(db, () => T1);
        const amazingGrace = seedSong(db, { hymnId: seedHymn(db, { title: "Amazing Grace" }) });

        stubLibrary(LIBRARY);
        await expect(syncPcoSongs(db, () => T2)).resolves.toMatchObject({ autoLinked: 1 });
        expect(links()).toEqual([[amazingGrace, "1001", "auto"]]);
    });

    test("does not make again an auto-link that was undone", async () => {
        stubPcoPacer();
        const { amazingGrace } = seedCatalog();
        stubLibrary(LIBRARY);
        await syncPcoSongs(db, () => T1);
        unlinkSong(db, amazingGrace, { pcoSongId: "1001", blockAutoLink: true }, T2);

        stubLibrary(LIBRARY);
        await expect(syncPcoSongs(db, () => T3)).resolves.toMatchObject({ autoLinked: 0 });
        expect(links()[0]).toEqual([amazingGrace, null, null]);
    });

    test("writes nothing when a page fails", async () => {
        stubPcoPacer();
        seedCatalog();
        // Synced the day before, with none of the listing's fields, so an
        // upsert at T1 would show.
        seedPcoSong(db, {
            id: "1001",
            title: "Amazing Grace",
            syncedAt: "2026-10-03T12:00:00.000Z",
        });
        stubFetchRoutes({
            [FIRST_PAGE]: listPage(LIBRARY.slice(0, 2), { next: SECOND_PAGE, total: 4 }),
            [SECOND_PAGE]: () => json({ errors: [] }, { status: 500 }),
        });

        await expect(syncPcoSongs(db, () => T1)).rejects.toMatchObject({
            name: "PcoError",
            status: 500,
        });
        expect(
            listPcoSongs(db).map(({ id, author, syncedAt }) => [id, author, syncedAt])
        ).toEqual([["1001", null, "2026-10-03T12:00:00.000Z"]]);
        expect(links().every(([, pcoSongId]) => pcoSongId === null)).toBe(true);
    });

    test("writes nothing when it got fewer songs than Planning Center listed", async () => {
        stubPcoPacer();
        seedCatalog();
        seedPcoSong(db, { id: "1002", title: "Abba, Father" });
        stubFetchRoutes({ [FIRST_PAGE]: listPage(LIBRARY.slice(0, 1), { total: 4 }) });

        await expect(syncPcoSongs(db, () => T1)).rejects.toThrow(
            "Planning Center listed 4 songs but sent 1"
        );
        expect(findPcoSong(db, "1002")?.removedAt).toBeNull();
        expect(findPcoSong(db, "1001")).toBeNull();
    });

    test("writes nothing when Planning Center lists no songs while the mirror has some", async () => {
        stubPcoPacer();
        seedPcoSong(db, { id: "1001", title: "Amazing Grace" });
        stubLibrary([]);

        await expect(syncPcoSongs(db, () => T1)).rejects.toThrow(
            "Planning Center listed no songs, though the mirror has some; nothing was changed"
        );
        expect(findPcoSong(db, "1001")?.removedAt).toBeNull();
    });

    test("takes an empty library for an empty mirror, or one whose songs are all removed", async () => {
        stubPcoPacer();
        stubLibrary([]);
        await expect(syncPcoSongs(db, () => T1)).resolves.toEqual({
            fetched: 0,
            added: 0,
            updated: 0,
            removed: 0,
            autoLinked: 0,
        });
        seedPcoSong(db, { id: "1001", removedAt: T1.toISOString() });
        stubLibrary([]);
        await expect(syncPcoSongs(db, () => T2)).resolves.toMatchObject({ removed: 0 });
    });
});

describe("describePcoSongsSync", () => {
    test("says what changed, leaving out what did not", () => {
        expect(
            describePcoSongsSync({
                fetched: 397,
                added: 2,
                updated: 0,
                removed: 1,
                autoLinked: 5,
            })
        ).toBe("Synced 397 songs: 2 added, 1 removed, 5 auto-linked");
        expect(
            describePcoSongsSync({
                fetched: 1,
                added: 1,
                updated: 1,
                removed: 1,
                autoLinked: 1,
            })
        ).toBe("Synced 1 song: 1 added, 1 updated, 1 removed, 1 auto-linked");
    });

    test("says when nothing changed", () => {
        expect(
            describePcoSongsSync({
                fetched: 397,
                added: 0,
                updated: 0,
                removed: 0,
                autoLinked: 0,
            })
        ).toBe("Synced 397 songs: no changes");
    });
});
