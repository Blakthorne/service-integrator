import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { PcoTagGroup } from "@/lib/domain";
import {
    findSongTags,
    listSongTagGroups,
    listTagIdsBySong,
    replaceSongTagGroups,
    replaceListedSongTags,
    replaceSongTags,
} from "./tags";
import {
    openTestDb,
    seedPcoSong,
    seedPcoSongTag,
    seedPcoTag,
    seedPcoTagGroup,
} from "./testing";

let db: DatabaseSync;

beforeEach(() => {
    db = openTestDb();
});

afterEach(() => {
    db.close();
});

/** A song tag group as Planning Center's listing gives it, with its tags as [id, name]. */
function group(
    id: string,
    name: string,
    tags: [string, string][],
    { allowMultiple = true, tagsFor = "song" }: { allowMultiple?: boolean; tagsFor?: string } = {}
): PcoTagGroup {
    return {
        id,
        name,
        tagsFor,
        allowMultiple,
        tags: tags.map(([tagId, tagName]) => ({ id: tagId, groupId: id, name: tagName })),
    };
}

/** The organization's one song tag group, as the spike found it. */
const TYPE = group("10", "Type", [
    ["101", "Hymn"],
    ["102", "Chorus"],
    ["103", "Special"],
]);

/** An arrangement group, which the mirror leaves out. */
const SPEED = group("20", "Speed", [["201", "Fast"]], { tagsFor: "arrangement" });

/** The (song, tag) rows stored, in order. */
function songTagRows(): [string, string][] {
    return db
        .prepare("SELECT pco_song_id, tag_id FROM pco_song_tags ORDER BY pco_song_id, tag_id")
        .all()
        .map((row) => [String(row.pco_song_id), String(row.tag_id)]);
}

/** Each stored tag as [id, group id, name], by id. */
function tagRows(): [string, string, string][] {
    return db
        .prepare("SELECT id, group_id, name FROM pco_tags ORDER BY id")
        .all()
        .map((row) => [String(row.id), String(row.group_id), String(row.name)]);
}

function groupIds(): string[] {
    return db
        .prepare("SELECT id FROM pco_tag_groups ORDER BY id")
        .all()
        .map((row) => String(row.id));
}

describe("replaceSongTagGroups", () => {
    test("stores the song tag groups and their tags, leaving out other groups", () => {
        expect(replaceSongTagGroups(db, [SPEED, TYPE])).toEqual({ groups: 1, tags: 3 });
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
        expect(groupIds()).toEqual(["10"]);
        expect(tagRows().map(([id]) => id)).toEqual(["101", "102", "103"]);
    });

    test("gives what is listed its current names and choice, and moves a tag with its group", () => {
        replaceSongTagGroups(db, [TYPE, group("11", "Season", [["111", "Advent"]])]);
        seedPcoSong(db, { id: "1001" });
        seedPcoSongTag(db, "1001", "103");

        expect(
            replaceSongTagGroups(db, [
                group("10", "Kind", [["101", "Hymns"], ["102", "Chorus"]], { allowMultiple: false }),
                group("11", "Season", [["111", "Advent"], ["103", "Special"]]),
            ])
        ).toEqual({ groups: 2, tags: 4 });
        expect(tagRows()).toEqual([
            ["101", "10", "Hymns"],
            ["102", "10", "Chorus"],
            ["103", "11", "Special"],
            ["111", "11", "Advent"],
        ]);
        expect(listSongTagGroups(db).map(({ name, allowMultiple }) => [name, allowMultiple])).toEqual([
            ["Kind", false],
            ["Season", true],
        ]);
        // The tag that moved keeps its songs.
        expect(songTagRows()).toEqual([["1001", "103"]]);
    });

    test("deletes the groups and tags no longer listed, which takes those tags off every song", () => {
        replaceSongTagGroups(db, [TYPE, group("11", "Season", [["111", "Advent"]])]);
        seedPcoSong(db, { id: "1001" });
        seedPcoSong(db, { id: "1002" });
        seedPcoSongTag(db, "1001", "101");
        seedPcoSongTag(db, "1001", "102");
        seedPcoSongTag(db, "1002", "111");

        expect(replaceSongTagGroups(db, [group("10", "Type", [["101", "Hymn"]])])).toEqual({
            groups: 1,
            tags: 1,
        });
        expect(groupIds()).toEqual(["10"]);
        expect(tagRows()).toEqual([["101", "10", "Hymn"]]);
        expect(songTagRows()).toEqual([["1001", "101"]]);
    });

    test("counts a group or a tag listed twice once, the first one", () => {
        expect(
            replaceSongTagGroups(db, [
                TYPE,
                group("10", "Type again", [["104", "Instrumental"]]),
                group("11", "Season", [["101", "Advent"], ["111", "Lent"]]),
            ])
        ).toEqual({ groups: 2, tags: 4 });
        expect(tagRows()).toEqual([
            ["101", "10", "Hymn"],
            ["102", "10", "Chorus"],
            ["103", "10", "Special"],
            ["111", "11", "Lent"],
        ]);
        expect(listSongTagGroups(db).map(({ name }) => name)).toEqual(["Season", "Type"]);
    });

    test("empties the mirror for a listing with no song groups", () => {
        replaceSongTagGroups(db, [TYPE]);
        seedPcoSong(db, { id: "1001" });
        seedPcoSongTag(db, "1001", "101");
        expect(replaceSongTagGroups(db, [SPEED])).toEqual({ groups: 0, tags: 0 });
        expect(groupIds()).toEqual([]);
        expect(tagRows()).toEqual([]);
        expect(songTagRows()).toEqual([]);
    });

    test("writes nothing when an id is not a Planning Center id", () => {
        replaceSongTagGroups(db, [TYPE]);
        expect(() =>
            replaceSongTagGroups(db, [group("10", "Type", [["101", "Hymn"], ["1x", "Bad"]])])
        ).toThrow(/CHECK constraint failed/);
        expect(tagRows().map(([id]) => id)).toEqual(["101", "102", "103"]);
    });
});

/** When a listing began, a moment before it, and when its sync wrote. */
const BEFORE = new Date("2026-10-04T11:59:59.000Z");
const STARTED = new Date("2026-10-04T12:00:00.000Z");
const WROTE = new Date("2026-10-04T12:00:30.000Z");

/** When each song's tags were last written, by song id. */
function writtenAt(): Record<string, string> {
    return Object.fromEntries(
        db
            .prepare("SELECT pco_song_id, written_at FROM pco_song_tags_written ORDER BY pco_song_id")
            .all()
            .map((row) => [String(row.pco_song_id), String(row.written_at)])
    );
}

describe("replaceListedSongTags", () => {
    beforeEach(() => {
        replaceSongTagGroups(db, [TYPE]);
        for (const id of ["1001", "1002", "1003"]) {
            seedPcoSong(db, { id });
        }
    });

    test("gives every song exactly the tags the listing gives it, and records when", () => {
        seedPcoSongTag(db, "1003", "101");
        seedPcoSongTag(db, "1003", "102");
        const listing = new Map([
            ["101", ["1001", "1002"]],
            ["102", ["1002"]],
            ["103", []],
        ]);

        expect(replaceListedSongTags(db, listing, STARTED, WROTE)).toEqual({
            tagged: 3,
            skipped: 0,
            kept: 0,
        });
        // 1003 is listed with no tag any more, so it has none.
        expect(songTagRows()).toEqual([
            ["1001", "101"],
            ["1002", "101"],
            ["1002", "102"],
        ]);
        expect(writtenAt()).toEqual({
            "1001": WROTE.toISOString(),
            "1002": WROTE.toISOString(),
            "1003": WROTE.toISOString(),
        });
    });

    test("takes a tag the listing leaves out off every song", () => {
        seedPcoSongTag(db, "1001", "102");
        expect(replaceListedSongTags(db, new Map([["101", ["1001"]]]), STARTED, WROTE)).toMatchObject({
            tagged: 1,
        });
        expect(songTagRows()).toEqual([["1001", "101"]]);
    });

    test("skips the songs the mirror does not have yet, and counts a song listed twice once", () => {
        expect(
            replaceListedSongTags(
                db,
                new Map([
                    ["101", ["1001", "9999", "1001", "8888"]],
                    ["102", ["9999"]],
                ]),
                STARTED,
                WROTE
            )
        ).toEqual({ tagged: 1, skipped: 3, kept: 0 });
        expect(songTagRows()).toEqual([["1001", "101"]]);
    });

    test("leaves as saved a song whose tags were written after the listing began", () => {
        replaceSongTags(db, "1002", ["102"], new Date("2026-10-04T12:00:10.000Z"));
        // Saved before the listing began, or as it began: the listing was
        // read after the save, so it is the newer, and wins.
        replaceSongTags(db, "1001", ["103"], STARTED);
        replaceSongTags(db, "1003", ["103"], BEFORE);
        const listing = new Map([
            ["101", ["1001", "1002", "1003"]],
            ["103", []],
        ]);

        expect(replaceListedSongTags(db, listing, STARTED, WROTE)).toEqual({
            tagged: 2,
            skipped: 0,
            kept: 1,
        });
        expect(songTagRows()).toEqual([
            ["1001", "101"],
            ["1002", "102"],
            ["1003", "101"],
        ]);
        expect(writtenAt()).toEqual({
            "1001": WROTE.toISOString(),
            "1002": "2026-10-04T12:00:10.000Z",
            "1003": WROTE.toISOString(),
        });
    });

    test("never takes its own last write for a save, however soon the next listing begins", () => {
        replaceListedSongTags(db, new Map([["101", ["1001"]]]), STARTED, WROTE);
        // The next listing begins the moment the last one was written.
        expect(replaceListedSongTags(db, new Map([["102", ["1001"]]]), WROTE, WROTE)).toEqual({
            tagged: 1,
            skipped: 0,
            kept: 0,
        });
        expect(songTagRows()).toEqual([["1001", "102"]]);
    });

    test("refuses a tag the mirror does not have, writing nothing", () => {
        seedPcoSongTag(db, "1001", "101");
        expect(() =>
            replaceListedSongTags(
                db,
                new Map([
                    ["101", []],
                    ["999", ["1001"]],
                ]),
                STARTED,
                WROTE
            )
        ).toThrow('The tag mirror has no tag "999"');
        expect(songTagRows()).toEqual([["1001", "101"]]);
        expect(writtenAt()).toEqual({});
    });
});

describe("replaceSongTags", () => {
    beforeEach(() => {
        replaceSongTagGroups(db, [TYPE]);
        seedPcoSong(db, { id: "1001" });
        seedPcoSong(db, { id: "1002" });
    });

    test("gives the song exactly the tags listed, leaving other songs alone", () => {
        seedPcoSongTag(db, "1001", "103");
        seedPcoSongTag(db, "1002", "103");
        expect(replaceSongTags(db, "1001", ["101", "102"])).toEqual({ tagged: 2, skipped: 0 });
        expect(songTagRows()).toEqual([
            ["1001", "101"],
            ["1001", "102"],
            ["1002", "103"],
        ]);
    });

    test("skips the tags the mirror does not have yet, and counts a tag listed twice once", () => {
        expect(replaceSongTags(db, "1001", ["101", "777", "101"])).toEqual({
            tagged: 1,
            skipped: 1,
        });
        expect(songTagRows()).toEqual([["1001", "101"]]);
    });

    test("clears the song's tags when none is listed", () => {
        seedPcoSongTag(db, "1001", "101");
        expect(replaceSongTags(db, "1001", [])).toEqual({ tagged: 0, skipped: 0 });
        expect(songTagRows()).toEqual([]);
    });

    test("refuses a song the mirror does not have, writing nothing", () => {
        expect(() => replaceSongTags(db, "9999", ["101"])).toThrow(
            'The song mirror has no song "9999"'
        );
        expect(songTagRows()).toEqual([]);
        expect(writtenAt()).toEqual({});
    });

    test("records when the song's tags were written, a later write replacing it", () => {
        replaceSongTags(db, "1001", ["101"], STARTED);
        expect(writtenAt()).toEqual({ "1001": STARTED.toISOString() });
        replaceSongTags(db, "1001", [], WROTE);
        expect(writtenAt()).toEqual({ "1001": WROTE.toISOString() });
    });
});

describe("the reads", () => {
    beforeEach(() => {
        replaceSongTagGroups(db, [TYPE, group("11", "Season", [["111", "Advent"]])]);
        // An arrangement group stored by hand, which every read leaves out.
        seedPcoTagGroup(db, { id: "20", name: "Speed", tagsFor: "arrangement" });
        seedPcoTag(db, { id: "201", groupId: "20", name: "Fast" });
        seedPcoSong(db, { id: "1001" });
        seedPcoSong(db, { id: "1002" });
        seedPcoSong(db, { id: "1003" });
        for (const tagId of ["103", "111", "101", "201"]) {
            seedPcoSongTag(db, "1001", tagId);
        }
        seedPcoSongTag(db, "1002", "102");
    });

    test("listSongTagGroups gives the song groups by name, each with its tags by name", () => {
        expect(
            listSongTagGroups(db).map(({ name, tags }) => [name, tags.map((tag) => tag.name)])
        ).toEqual([
            ["Season", ["Advent"]],
            ["Type", ["Chorus", "Hymn", "Special"]],
        ]);
    });

    test("findSongTags gives a song's tags by group name, then by name", () => {
        expect(findSongTags(db, "1001")).toEqual([
            { id: "111", groupId: "11", name: "Advent" },
            { id: "101", groupId: "10", name: "Hymn" },
            { id: "103", groupId: "10", name: "Special" },
        ]);
        expect(findSongTags(db, "1003")).toEqual([]);
        expect(findSongTags(db, "9999")).toEqual([]);
    });

    test("listTagIdsBySong gives each tagged song's tag ids in the same order", () => {
        expect(listTagIdsBySong(db)).toEqual(
            new Map([
                ["1001", ["111", "101", "103"]],
                ["1002", ["102"]],
            ])
        );
    });
});
