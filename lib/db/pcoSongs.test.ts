import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { PcoLibrarySong } from "@/lib/domain";
import {
    clearPcoSongIgnored,
    findPcoSong,
    findPcoSongs,
    listIgnoredPcoSongs,
    listPcoSongs,
    listUnlinkedPcoSongs,
    markMissingPcoSongsRemoved,
    markPcoSongAutoLinkBlocked,
    markPcoSongIgnored,
    upsertPcoSongs,
} from "./pcoSongs";
import { openTestDb, seedPcoSong, seedSong } from "./testing";

let db: DatabaseSync;

beforeEach(() => {
    db = openTestDb();
});

afterEach(() => {
    db.close();
});

const T1 = new Date("2026-10-04T12:00:00.000Z");
const T2 = new Date("2026-10-04T13:00:00.000Z");
const T3 = new Date("2026-10-04T14:00:00.000Z");

/** A library song as the sync reads it; Amazing Grace unless told otherwise. */
function librarySong(
    id: string,
    fields: Partial<PcoLibrarySong> = {}
): PcoLibrarySong {
    return {
        id,
        title: "Amazing Grace",
        author: "John Newton",
        copyright: "Public Domain",
        ccliNumber: 22025,
        admin: null,
        themes: "Grace",
        hidden: false,
        lastScheduledAt: "2026-09-27T08:00:00Z",
        createdAt: "2019-01-01T00:00:00Z",
        updatedAt: "2026-09-27T08:00:00Z",
        ...fields,
    };
}

const titles = (songs: { title: string }[]) => songs.map(({ title }) => title);

describe("upsertPcoSongs", () => {
    test("adds the songs the mirror lacks, with every field, synced now", () => {
        expect(
            upsertPcoSongs(db, [librarySong("101"), librarySong("102", { hidden: true })], T1)
        ).toEqual({ added: 2, updated: 0 });
        expect(findPcoSong(db, "101")).toEqual({
            ...librarySong("101"),
            syncedAt: T1.toISOString(),
            removedAt: null,
            ignoredAt: null,
            autoLinkBlockedAt: null,
        });
        expect(findPcoSong(db, "102")?.hidden).toBe(true);
    });

    test("counts a song as updated only when one of its fields changed, and marks every song synced", () => {
        upsertPcoSongs(db, [librarySong("101"), librarySong("102"), librarySong("103")], T1);
        expect(
            upsertPcoSongs(
                db,
                [
                    librarySong("101"),
                    librarySong("102", { lastScheduledAt: "2026-10-04T08:00:00Z" }),
                    librarySong("103", { author: null }),
                    librarySong("104"),
                ],
                T2
            )
        ).toEqual({ added: 1, updated: 2 });
        expect(findPcoSong(db, "101")?.syncedAt).toBe(T2.toISOString());
        expect(findPcoSong(db, "102")?.lastScheduledAt).toBe("2026-10-04T08:00:00Z");
        expect(findPcoSong(db, "103")?.author).toBeNull();
    });

    test.each<[string, Partial<PcoLibrarySong>]>([
        ["title", { title: "Amazing Grace!" }],
        ["copyright", { copyright: null }],
        ["CCLI number", { ccliNumber: 1 }],
        ["admin", { admin: "Admin Co" }],
        ["themes", { themes: null }],
        ["hidden flag", { hidden: true }],
        ["creation time", { createdAt: null }],
        ["update time", { updatedAt: "2026-10-01T08:00:00Z" }],
    ])("counts a change of the %s as an update", (_field, change) => {
        upsertPcoSongs(db, [librarySong("101")], T1);
        expect(upsertPcoSongs(db, [librarySong("101", change)], T2)).toEqual({
            added: 0,
            updated: 1,
        });
    });

    test("brings back a removed song, counting it as updated", () => {
        upsertPcoSongs(db, [librarySong("101")], T1);
        markMissingPcoSongsRemoved(db, [], T2, T2);
        expect(upsertPcoSongs(db, [librarySong("101")], T3)).toEqual({
            added: 0,
            updated: 1,
        });
        expect(findPcoSong(db, "101")?.removedAt).toBeNull();
    });

    test("keeps the ignored and blocked marks", () => {
        seedPcoSong(db, {
            id: "101",
            ignoredAt: T1.toISOString(),
            autoLinkBlockedAt: T1.toISOString(),
        });
        upsertPcoSongs(db, [librarySong("101")], T2);
        expect(findPcoSong(db, "101")).toMatchObject({
            title: "Amazing Grace",
            ignoredAt: T1.toISOString(),
            autoLinkBlockedAt: T1.toISOString(),
        });
    });

    test("takes a song listed twice once, with its last fields", () => {
        expect(
            upsertPcoSongs(
                db,
                [librarySong("101"), librarySong("101", { title: "Amazing Grace!" })],
                T1
            )
        ).toEqual({ added: 1, updated: 1 });
        expect(listPcoSongs(db).map(({ id, title }) => [id, title])).toEqual([
            ["101", "Amazing Grace!"],
        ]);
    });

    test("writes nothing when a song cannot be stored", () => {
        expect(() =>
            upsertPcoSongs(db, [librarySong("101"), librarySong("not an id")], T1)
        ).toThrow(/CHECK constraint failed/);
        expect(listPcoSongs(db)).toEqual([]);
    });
});

describe("markMissingPcoSongsRemoved", () => {
    test("marks the songs a complete listing lacks, and only those", () => {
        upsertPcoSongs(db, [librarySong("101"), librarySong("102"), librarySong("103")], T1);
        expect(markMissingPcoSongsRemoved(db, ["101", "103", "999"], T2, T2)).toBe(1);
        expect(listPcoSongs(db).map(({ id, removedAt }) => [id, removedAt])).toEqual([
            ["101", null],
            ["102", T2.toISOString()],
            ["103", null],
        ]);
    });

    test("leaves alone a song read since the listing began, which may be newer than the listing", () => {
        upsertPcoSongs(db, [librarySong("101")], T1);
        // A page mirrored this one at the moment the listing began.
        upsertPcoSongs(db, [librarySong("102")], T2);
        expect(markMissingPcoSongsRemoved(db, [], T2, T3)).toBe(1);
        expect(listPcoSongs(db).map(({ id, removedAt }) => [id, removedAt])).toEqual([
            ["101", T3.toISOString()],
            ["102", null],
        ]);
    });

    test("keeps the first time a song was found removed", () => {
        upsertPcoSongs(db, [librarySong("101")], T1);
        expect(markMissingPcoSongsRemoved(db, [], T2, T2)).toBe(1);
        expect(markMissingPcoSongsRemoved(db, [], T3, T3)).toBe(0);
        expect(findPcoSong(db, "101")?.removedAt).toBe(T2.toISOString());
    });
});

describe("the marks", () => {
    test("ignore and unignore a song", () => {
        const id = seedPcoSong(db);
        expect(markPcoSongIgnored(db, id, T1)).toBe(true);
        expect(markPcoSongIgnored(db, id, T2)).toBe(true);
        expect(findPcoSong(db, id)?.ignoredAt).toBe(T1.toISOString());
        expect(clearPcoSongIgnored(db, id)).toBe(true);
        expect(findPcoSong(db, id)?.ignoredAt).toBeNull();
    });

    test("block a song from auto-linking, keeping the first time", () => {
        const id = seedPcoSong(db);
        expect(markPcoSongAutoLinkBlocked(db, id, T1)).toBe(true);
        expect(markPcoSongAutoLinkBlocked(db, id, T2)).toBe(true);
        expect(findPcoSong(db, id)?.autoLinkBlockedAt).toBe(T1.toISOString());
    });

    test("are false for a song the mirror lacks", () => {
        expect(markPcoSongIgnored(db, "404", T1)).toBe(false);
        expect(clearPcoSongIgnored(db, "404")).toBe(false);
        expect(markPcoSongAutoLinkBlocked(db, "404", T1)).toBe(false);
    });
});

describe("the reads", () => {
    /** One song in each state the reads tell apart. */
    function seedStates() {
        const ids = {
            unlinked: seedPcoSong(db, { title: "Be Thou My Vision" }),
            secondUnlinked: seedPcoSong(db, { title: "abide with Me" }),
            linked: seedPcoSong(db, { title: "Amazing Grace" }),
            ignored: seedPcoSong(db, { title: "Shout to the Lord", ignoredAt: T1.toISOString() }),
            removed: seedPcoSong(db, { title: "Old Song", removedAt: T1.toISOString() }),
            removedIgnored: seedPcoSong(db, {
                title: "Old Chorus",
                removedAt: T1.toISOString(),
                ignoredAt: T1.toISOString(),
            }),
            blocked: seedPcoSong(db, {
                title: "Holy, Holy, Holy",
                autoLinkBlockedAt: T1.toISOString(),
            }),
        };
        seedSong(db, { pcoSongId: ids.linked });
        return ids;
    }

    test("findPcoSong gives one song, or null", () => {
        const { ignored } = seedStates();
        expect(findPcoSong(db, ignored)).toMatchObject({
            id: ignored,
            title: "Shout to the Lord",
            ignoredAt: T1.toISOString(),
        });
        expect(findPcoSong(db, "404")).toBeNull();
    });

    test("findPcoSongs gives the songs it has, by id", () => {
        const { unlinked, removed } = seedStates();
        const found = findPcoSongs(db, [unlinked, removed, "404"]);
        expect([...found.keys()].sort()).toEqual([unlinked, removed].sort());
        expect(found.get(removed)?.title).toBe("Old Song");
        expect(findPcoSongs(db, []).size).toBe(0);
    });

    test("listPcoSongs gives every song by title, without regard to case", () => {
        seedStates();
        expect(titles(listPcoSongs(db))).toEqual([
            "abide with Me",
            "Amazing Grace",
            "Be Thou My Vision",
            "Holy, Holy, Holy",
            "Old Chorus",
            "Old Song",
            "Shout to the Lord",
        ]);
    });

    test("listUnlinkedPcoSongs leaves out linked, ignored and removed songs", () => {
        seedStates();
        expect(titles(listUnlinkedPcoSongs(db))).toEqual([
            "abide with Me",
            "Be Thou My Vision",
            "Holy, Holy, Holy",
        ]);
    });

    test("listIgnoredPcoSongs gives the ignored songs still in Planning Center", () => {
        seedStates();
        expect(titles(listIgnoredPcoSongs(db))).toEqual(["Shout to the Lord"]);
    });
});
