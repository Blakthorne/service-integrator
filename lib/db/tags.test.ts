import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { PcoTagGroup } from "@/lib/domain";
import {
    findSongTags,
    listSongTagGroups,
    listTagIdsBySong,
    replaceSongTagGroups,
    replaceSongTags,
    replaceTagSongs,
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

describe("replaceTagSongs", () => {
    beforeEach(() => {
        replaceSongTagGroups(db, [TYPE]);
        for (const id of ["1001", "1002", "1003"]) {
            seedPcoSong(db, { id });
        }
    });

    test("gives the tag exactly the songs listed, leaving other tags alone", () => {
        seedPcoSongTag(db, "1003", "101");
        seedPcoSongTag(db, "1003", "102");
        expect(replaceTagSongs(db, "101", ["1001", "1002"])).toEqual({ tagged: 2, skipped: 0 });
        expect(songTagRows()).toEqual([
            ["1001", "101"],
            ["1002", "101"],
            ["1003", "102"],
        ]);
    });

    test("skips the songs the mirror does not have yet, and counts a song listed twice once", () => {
        expect(replaceTagSongs(db, "101", ["1001", "9999", "1001", "8888"])).toEqual({
            tagged: 1,
            skipped: 2,
        });
        expect(songTagRows()).toEqual([["1001", "101"]]);
    });

    test("takes the tag off every song when none is listed", () => {
        seedPcoSongTag(db, "1001", "101");
        expect(replaceTagSongs(db, "101", [])).toEqual({ tagged: 0, skipped: 0 });
        expect(songTagRows()).toEqual([]);
    });

    test("refuses a tag the mirror does not have, writing nothing", () => {
        seedPcoSongTag(db, "1001", "101");
        expect(() => replaceTagSongs(db, "999", ["1001"])).toThrow(
            'The tag mirror has no tag "999"'
        );
        expect(songTagRows()).toEqual([["1001", "101"]]);
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
