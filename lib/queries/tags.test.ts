import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { findSongTags, listSongTagGroups, replaceSongTagGroups } from "@/lib/db/tags";
import { openTestDb, seedPcoSong, seedPcoSongTag } from "@/lib/db/testing";
import {
    PCO_BASE,
    calledUrls,
    json,
    listPage,
    songResource,
    stubFetchRoutes,
    stubPcoCredentials,
    stubPcoPacer,
    tagGroupResource,
    tagResource,
} from "@/lib/pco/testing";

const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/lib/db", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/db")>()),
    getDb,
}));

import {
    describeTagsSync,
    getPcoSongTags,
    getSongTagGroups,
    getTagIdsBySong,
    syncTags,
} from "./tags";

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

const TAG_GROUPS = `${PCO_BASE}/tag_groups?include=tags&per_page=100`;

/** The first page of the songs with tag `tagId`, and the page after it. */
const songsWithTag = (tagId: string) => `${PCO_BASE}/songs?where[song_tag_ids]=${tagId}&per_page=100`;
const moreSongsWithTag = (tagId: string) =>
    `${PCO_BASE}/songs?offset=100&per_page=100&where[song_tag_ids]=${tagId}`;

/**
 * Planning Center's tag groups: "Type" for songs (Hymn, Chorus and Special,
 * which no song has), and "Speed", an arrangement group.
 */
const GROUPS = listPage(
    [
        tagGroupResource("10", { name: "Type" }, ["101", "102", "103"]),
        tagGroupResource("20", { name: "Speed", tags_for: "arrangement" }, ["201"]),
    ],
    {
        included: [
            tagResource("101", { name: "Hymn" }),
            tagResource("102", { name: "Chorus" }),
            tagResource("103", { name: "Special" }),
            tagResource("201", { name: "Fast" }),
        ],
    }
);

/** Hymn on two pages (1001, 1002, then 1003 and 1004, which the mirror lacks); Chorus on 1002; Special on none. */
function stubTags(routes: Record<string, unknown> = {}) {
    return stubFetchRoutes({
        [TAG_GROUPS]: GROUPS,
        [songsWithTag("101")]: listPage([songResource("1001"), songResource("1002")], {
            next: moreSongsWithTag("101"),
            total: 4,
        }),
        [moreSongsWithTag("101")]: listPage([songResource("1003"), songResource("1004")], {
            total: 4,
        }),
        [songsWithTag("102")]: listPage([songResource("1002")]),
        [songsWithTag("103")]: listPage([]),
        ...routes,
    });
}

/** The (song, tag) rows stored, in order. */
function songTagRows(): [string, string][] {
    return db
        .prepare("SELECT pco_song_id, tag_id FROM pco_song_tags ORDER BY pco_song_id, tag_id")
        .all()
        .map((row) => [String(row.pco_song_id), String(row.tag_id)]);
}

describe("syncTags", () => {
    beforeEach(() => {
        for (const id of ["1001", "1002", "1003"]) {
            seedPcoSong(db, { id });
        }
    });

    test("reads the song groups, then the songs of each of their tags, paced, and mirrors them", async () => {
        const acquire = vi.spyOn(stubPcoPacer(), "acquire");
        const fetchMock = stubTags();

        await expect(syncTags(db)).resolves.toEqual({
            groups: 1,
            tags: 3,
            songTags: 4,
            skipped: 1,
        });
        // Each tag in turn, by name, and never the arrangement group's: only
        // ids from the fresh read of the song groups.
        expect(calledUrls(fetchMock)).toEqual([
            TAG_GROUPS,
            songsWithTag("102"),
            songsWithTag("101"),
            moreSongsWithTag("101"),
            songsWithTag("103"),
        ]);
        expect(acquire).toHaveBeenCalledTimes(5);
        expect(listSongTagGroups(db)).toEqual([
            {
                id: "10",
                name: "Type",
                tagsFor: "song",
                allowMultiple: true,
                tags: [
                    { id: "102", groupId: "10", name: "Chorus" },
                    { id: "101", groupId: "10", name: "Hymn" },
                    { id: "103", groupId: "10", name: "Special" },
                ],
            },
        ]);
        // 1004 is not in the song mirror yet, so it is skipped.
        expect(songTagRows()).toEqual([
            ["1001", "101"],
            ["1002", "101"],
            ["1002", "102"],
            ["1003", "101"],
        ]);
    });

    test("replaces what the last sync mirrored", async () => {
        stubPcoPacer();
        stubTags();
        await syncTags(db);

        stubFetchRoutes({
            [TAG_GROUPS]: listPage(
                [tagGroupResource("10", { name: "Type" }, ["101", "104"])],
                {
                    included: [
                        tagResource("101", { name: "Hymn" }),
                        tagResource("104", { name: "Invitation" }),
                    ],
                }
            ),
            [songsWithTag("101")]: listPage([songResource("1003")]),
            [songsWithTag("104")]: listPage([songResource("1001"), songResource("1002")]),
        });
        await expect(syncTags(db)).resolves.toEqual({
            groups: 1,
            tags: 2,
            songTags: 3,
            skipped: 0,
        });
        expect(songTagRows()).toEqual([
            ["1001", "104"],
            ["1002", "104"],
            ["1003", "101"],
        ]);
        expect(listSongTagGroups(db)[0].tags.map(({ name }) => name)).toEqual([
            "Hymn",
            "Invitation",
        ]);
    });

    test("writes nothing when a read fails", async () => {
        stubPcoPacer();
        stubTags();
        await syncTags(db);
        const before = { groups: listSongTagGroups(db), songTags: songTagRows() };

        stubTags({
            [TAG_GROUPS]: listPage([tagGroupResource("10", { name: "Kind" }, ["101", "102"])], {
                included: [tagResource("101", { name: "Hymn" }), tagResource("102", { name: "Chorus" })],
            }),
            [songsWithTag("102")]: () => json({ errors: [] }, { status: 500 }),
        });
        await expect(syncTags(db)).rejects.toMatchObject({ name: "PcoError", status: 500 });
        expect({ groups: listSongTagGroups(db), songTags: songTagRows() }).toEqual(before);
    });

    test("empties the mirror when Planning Center has no song tag groups", async () => {
        stubPcoPacer();
        stubTags();
        await syncTags(db);

        const fetchMock = stubFetchRoutes({ [TAG_GROUPS]: listPage([]) });
        await expect(syncTags(db)).resolves.toEqual({
            groups: 0,
            tags: 0,
            songTags: 0,
            skipped: 0,
        });
        expect(calledUrls(fetchMock)).toEqual([TAG_GROUPS]);
        expect(listSongTagGroups(db)).toEqual([]);
        expect(songTagRows()).toEqual([]);
    });
});

describe("describeTagsSync", () => {
    test("says what the sync mirrored", () => {
        expect(describeTagsSync({ groups: 1, tags: 5, songTags: 412, skipped: 0 })).toBe(
            "Synced 5 tags in 1 group: 412 song tags"
        );
        expect(describeTagsSync({ groups: 2, tags: 1, songTags: 1, skipped: 0 })).toBe(
            "Synced 1 tag in 2 groups: 1 song tag"
        );
        expect(describeTagsSync({ groups: 0, tags: 0, songTags: 0, skipped: 0 })).toBe(
            "Synced 0 tags in 0 groups: 0 song tags"
        );
    });

    test("says how many song tags were skipped, when some were", () => {
        expect(describeTagsSync({ groups: 1, tags: 5, songTags: 412, skipped: 3 })).toBe(
            "Synced 5 tags in 1 group: 412 song tags, 3 skipped (songs not mirrored yet)"
        );
    });
});

describe("the reads", () => {
    beforeEach(() => {
        replaceSongTagGroups(db, [
            {
                id: "10",
                name: "Type",
                tagsFor: "song",
                allowMultiple: true,
                tags: [
                    { id: "101", groupId: "10", name: "Hymn" },
                    { id: "102", groupId: "10", name: "Chorus" },
                ],
            },
        ]);
        seedPcoSong(db, { id: "1001" });
        seedPcoSong(db, { id: "1002" });
        seedPcoSongTag(db, "1001", "101");
        seedPcoSongTag(db, "1001", "102");
    });

    test("give the mirror's groups, each song's tag ids and a song's tags", () => {
        expect(getSongTagGroups()).toEqual(listSongTagGroups(db));
        expect(getTagIdsBySong()).toEqual({ "1001": ["102", "101"] });
        expect(getPcoSongTags("1001")).toEqual(findSongTags(db, "1001"));
        expect(getPcoSongTags("1002")).toEqual([]);
    });

    test("throw when the database cannot be read", () => {
        getDb.mockImplementation(() => {
            throw new Error("Could not open the database");
        });
        expect(() => getSongTagGroups()).toThrow("Could not open the database");
        expect(() => getTagIdsBySong()).toThrow("Could not open the database");
        expect(() => getPcoSongTags("1001")).toThrow("Could not open the database");
    });
});
