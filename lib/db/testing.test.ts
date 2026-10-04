import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
    openTestDb,
    seedBook,
    seedEntry,
    seedHymn,
    seedPcoSong,
    seedPcoSongCredits,
    seedPcoSongTag,
    seedPcoTag,
    seedPcoTagGroup,
    seedScheduleSelection,
    seedSetting,
    seedSong,
    seedTune,
    seedWriteLog,
} from "./testing";

let db: DatabaseSync;

beforeEach(() => {
    db = openTestDb();
});

afterEach(() => {
    db.close();
});

function row(table: string, id: number) {
    return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
}

describe("seedBook", () => {
    test("makes numbered, active books coded B1, B2, … in order by default", () => {
        const first = seedBook(db);
        const second = seedBook(db);
        expect(row("books", first)).toEqual({
            id: first,
            code: "B1",
            name: "Book B1",
            short_name: "Book B1",
            numbered: 1,
            label_format: "B1-{n}",
            sort_order: 1,
            active: 1,
        });
        expect(row("books", second)).toMatchObject({ code: "B2", sort_order: 2 });
    });

    test("skips a default code that is taken", () => {
        seedBook(db, { code: "B2" });
        expect(row("books", seedBook(db))).toMatchObject({ code: "B3" });
    });

    test("labels an unnumbered book with its short name", () => {
        const id = seedBook(db, {
            code: "CB",
            name: "The Chorus Book",
            shortName: "Chorus Book",
            numbered: false,
        });
        expect(row("books", id)).toMatchObject({
            numbered: 0,
            label_format: "Chorus Book",
        });
    });

    test("takes every field", () => {
        const id = seedBook(db, {
            code: "R",
            name: "Rejoice Hymns",
            shortName: "Rejoice",
            numbered: true,
            labelFormat: "R-{n}",
            sortOrder: 5,
            active: false,
        });
        expect(row("books", id)).toEqual({
            id,
            code: "R",
            name: "Rejoice Hymns",
            short_name: "Rejoice",
            numbered: 1,
            label_format: "R-{n}",
            sort_order: 5,
            active: 0,
        });
    });
});

describe("seedHymn and seedTune", () => {
    test("number their default titles and names", () => {
        expect(row("hymns", seedHymn(db))).toMatchObject({ title: "Hymn 1" });
        expect(row("hymns", seedHymn(db))).toMatchObject({ title: "Hymn 2" });
        expect(row("tunes", seedTune(db))).toMatchObject({ name: "TUNE 1" });
    });

    test("store aliases with their normalized forms", () => {
        const hymnId = seedHymn(db, {
            title: "Rejoice, the Lord Is King",
            aliases: ["Rejoice \u2013 the Lord Is King!"],
        });
        const tuneId = seedTune(db, { name: "DARWALL", aliases: ["Darwal"] });
        expect(
            db.prepare("SELECT hymn_id, alias, normalized FROM hymn_aliases").all()
        ).toEqual([
            {
                hymn_id: hymnId,
                alias: "Rejoice \u2013 the Lord Is King!",
                normalized: "rejoice \u2013 the lord is king",
            },
        ]);
        expect(
            db.prepare("SELECT tune_id, alias, normalized FROM tune_aliases").all()
        ).toEqual([{ tune_id: tuneId, alias: "Darwal", normalized: "DARWAL" }]);
    });
});

describe("seedSong", () => {
    test("makes a new hymn with no tune and no link by default", () => {
        const id = seedSong(db);
        expect(row("songs", id)).toEqual({
            id,
            hymn_id: expect.any(Number),
            tune_id: null,
            pco_song_id: null,
            linked_at: null,
            linked_by: null,
            notes: null,
        });
    });

    test("takes every field", () => {
        const hymnId = seedHymn(db);
        const tuneId = seedTune(db);
        const id = seedSong(db, {
            hymnId,
            tuneId,
            pcoSongId: "123",
            linkedAt: "2026-10-04T12:00:00.000Z",
            linkedBy: "manual",
            notes: "Slow",
        });
        expect(row("songs", id)).toEqual({
            id,
            hymn_id: hymnId,
            tune_id: tuneId,
            pco_song_id: "123",
            linked_at: "2026-10-04T12:00:00.000Z",
            linked_by: "manual",
            notes: "Slow",
        });
    });
});

describe("seedEntry", () => {
    test("numbers entries of a numbered book in turn by default", () => {
        const bookId = seedBook(db);
        const first = seedEntry(db, { bookId, songId: seedSong(db) });
        const second = seedEntry(db, { bookId, songId: seedSong(db) });
        expect(row("entries", first)).toMatchObject({ number: 1, position: null });
        expect(row("entries", second)).toMatchObject({ number: 2, position: null });
    });

    test("places entries of an unnumbered book in turn by default", () => {
        const bookId = seedBook(db, { numbered: false });
        seedEntry(db, { bookId, songId: seedSong(db) });
        const second = seedEntry(db, { bookId, songId: seedSong(db) });
        expect(row("entries", second)).toMatchObject({ number: null, position: 2 });
    });

    test("leaves the number out when a location is given", () => {
        const bookId = seedBook(db);
        const songId = seedSong(db);
        const id = seedEntry(db, {
            bookId,
            songId,
            locationLabel: "front cover",
            variantNote: "A Round",
        });
        expect(row("entries", id)).toEqual({
            id,
            book_id: bookId,
            song_id: songId,
            number: null,
            position: null,
            location_label: "front cover",
            variant_note: "A Round",
        });
    });
});

describe("seedPcoSong", () => {
    test("makes songs with ids 9000001, 9000002, … and numbered titles by default", () => {
        const first = seedPcoSong(db);
        const second = seedPcoSong(db);
        expect([first, second]).toEqual(["9000001", "9000002"]);
        expect(db.prepare("SELECT * FROM pco_songs WHERE id = ?").get(first)).toEqual({
            id: "9000001",
            title: "PCO Song 1",
            author: null,
            copyright: null,
            ccli_number: null,
            admin: null,
            themes: null,
            hidden: 0,
            last_scheduled_at: null,
            created_at: null,
            updated_at: null,
            synced_at: "2026-10-04T12:00:00.000Z",
            removed_at: null,
            ignored_at: null,
            auto_link_blocked_at: null,
        });
    });

    test("skips a default id that is taken", () => {
        seedPcoSong(db, { id: "9000002" });
        expect(seedPcoSong(db)).toBe("9000003");
    });

    test("takes every field", () => {
        const id = seedPcoSong(db, {
            id: "12345",
            title: "Amazing Grace",
            author: "John Newton",
            copyright: "Public Domain",
            ccliNumber: 22025,
            admin: "Admin Co",
            themes: "Grace",
            hidden: true,
            lastScheduledAt: "2026-09-27T08:00:00Z",
            createdAt: "2019-01-01T00:00:00Z",
            updatedAt: "2026-09-27T08:00:00Z",
            syncedAt: "2026-10-04T13:00:00.000Z",
            removedAt: "2026-10-04T14:00:00.000Z",
            ignoredAt: "2026-10-04T15:00:00.000Z",
            autoLinkBlockedAt: "2026-10-04T16:00:00.000Z",
        });
        expect(id).toBe("12345");
        expect(db.prepare("SELECT * FROM pco_songs WHERE id = ?").get(id)).toEqual({
            id: "12345",
            title: "Amazing Grace",
            author: "John Newton",
            copyright: "Public Domain",
            ccli_number: 22025,
            admin: "Admin Co",
            themes: "Grace",
            hidden: 1,
            last_scheduled_at: "2026-09-27T08:00:00Z",
            created_at: "2019-01-01T00:00:00Z",
            updated_at: "2026-09-27T08:00:00Z",
            synced_at: "2026-10-04T13:00:00.000Z",
            removed_at: "2026-10-04T14:00:00.000Z",
            ignored_at: "2026-10-04T15:00:00.000Z",
            auto_link_blocked_at: "2026-10-04T16:00:00.000Z",
        });
    });
});

describe("seedScheduleSelection", () => {
    const selection = (planId: string, itemId: string) =>
        db
            .prepare("SELECT * FROM schedule_selections WHERE plan_id = ? AND item_id = ?")
            .get(planId, itemId);

    test("saves Numbers for items 1, 2, … of plan 81234567 by default", () => {
        expect(seedScheduleSelection(db)).toEqual({ planId: "81234567", itemId: "1" });
        expect(seedScheduleSelection(db)).toEqual({ planId: "81234567", itemId: "2" });
        expect(selection("81234567", "1")).toEqual({
            plan_id: "81234567",
            item_id: "1",
            option: "numbers",
            custom_text: null,
            updated_at: "2026-10-04T12:00:00.000Z",
        });
    });

    test("numbers the default items per plan, skipping one that is taken", () => {
        seedScheduleSelection(db, { itemId: "2" });
        expect(seedScheduleSelection(db).itemId).toBe("1");
        expect(seedScheduleSelection(db).itemId).toBe("3");
        expect(seedScheduleSelection(db, { planId: "5" }).itemId).toBe("1");
    });

    test("takes every field, an option a newer build wrote included", () => {
        seedScheduleSelection(db, {
            planId: "10",
            itemId: "7",
            option: "newer-option",
            customText: "x",
            updatedAt: "2026-10-04T13:00:00.000Z",
        });
        expect(selection("10", "7")).toEqual({
            plan_id: "10",
            item_id: "7",
            option: "newer-option",
            custom_text: "x",
            updated_at: "2026-10-04T13:00:00.000Z",
        });
    });
});

describe("seedWriteLog", () => {
    test("logs a hymnal note written to item 1 of plan 81234567 by default", () => {
        const id = seedWriteLog(db);
        expect(row("write_log", id)).toEqual({
            id,
            at: "2026-10-04T12:00:00.000Z",
            kind: "item-note",
            target: "plan 81234567 item 1",
            ok: 1,
            payload: "{}",
            result: "{}",
        });
    });

    test("takes every field, a kind a newer build wrote included", () => {
        const id = seedWriteLog(db, {
            at: "2026-10-04T13:00:00.000Z",
            kind: "newer-kind",
            target: "song 9",
            ok: false,
            payload: { a: 1 },
            result: { error: "no" },
        });
        expect(row("write_log", id)).toEqual({
            id,
            at: "2026-10-04T13:00:00.000Z",
            kind: "newer-kind",
            target: "song 9",
            ok: 0,
            payload: '{"a":1}',
            result: '{"error":"no"}',
        });
    });
});

describe("seedSetting", () => {
    test("stores any value as JSON under any key, at 2026-10-04 12:00 UTC by default", () => {
        seedSetting(db, "numberSeparator", ", ");
        seedSetting(db, "newer-key", { a: [1] }, "2026-10-04T13:00:00.000Z");
        expect(db.prepare("SELECT * FROM settings ORDER BY key").all()).toEqual([
            { key: "newer-key", value: '{"a":[1]}', updated_at: "2026-10-04T13:00:00.000Z" },
            { key: "numberSeparator", value: '", "', updated_at: "2026-10-04T12:00:00.000Z" },
        ]);
    });
});

describe("seedPcoSongCredits", () => {
    const credits = (pcoSongId: string) =>
        db
            .prepare("SELECT * FROM pco_song_credits WHERE pco_song_id = ? ORDER BY position")
            .all(pcoSongId)
            .map((stored) => ({ ...stored }));

    test("stores a row for each name of each role, numbered in order, as ok by default", () => {
        const id = seedPcoSong(db);
        seedPcoSongCredits(db, id, [
            { role: "Words", names: ["Isaac Watts"] },
            { role: "Arr.", names: ["A", "B"] },
        ]);
        expect(credits(id)).toEqual([
            { pco_song_id: id, role: "Words", name: "Isaac Watts", position: 0, parse_status: "ok" },
            { pco_song_id: id, role: "Arr.", name: "A", position: 1, parse_status: "ok" },
            { pco_song_id: id, role: "Arr.", name: "B", position: 2, parse_status: "ok" },
        ]);
    });

    test("with no credits, stores the one row that holds only the status, any status included", () => {
        const id = seedPcoSong(db);
        seedPcoSongCredits(db, id, [], "newer-status");
        expect(credits(id)).toEqual([
            { pco_song_id: id, role: null, name: null, position: 0, parse_status: "newer-status" },
        ]);
    });
});

describe("seedPcoTagGroup, seedPcoTag and seedPcoSongTag", () => {
    const stored = (table: string, id: string) =>
        ({ ...db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) });

    test("make song tag groups with ids 8000001, 8000002, … whose songs may have several tags, by default", () => {
        expect([seedPcoTagGroup(db), seedPcoTagGroup(db)]).toEqual(["8000001", "8000002"]);
        expect(stored("pco_tag_groups", "8000001")).toEqual({
            id: "8000001",
            name: "Tag Group 1",
            tags_for: "song",
            allow_multiple: 1,
        });
        seedPcoTagGroup(db, { id: "8000004" });
        expect(seedPcoTagGroup(db)).toBe("8000005");
    });

    test("a group takes every field, an arrangement group included", () => {
        seedPcoTagGroup(db, { id: "7", name: "Speed", tagsFor: "arrangement", allowMultiple: false });
        expect(stored("pco_tag_groups", "7")).toEqual({
            id: "7",
            name: "Speed",
            tags_for: "arrangement",
            allow_multiple: 0,
        });
    });

    test("make tags with ids 8100001, 8100002, …, each in a new group by default", () => {
        expect([seedPcoTag(db), seedPcoTag(db)]).toEqual(["8100001", "8100002"]);
        expect(stored("pco_tags", "8100001")).toEqual({
            id: "8100001",
            group_id: "8000001",
            name: "Tag 1",
        });
        expect(stored("pco_tags", "8100002")).toMatchObject({ group_id: "8000002", name: "Tag 2" });
    });

    test("a tag takes every field, and a song is given a tag", () => {
        const groupId = seedPcoTagGroup(db, { name: "Type" });
        const tagId = seedPcoTag(db, { id: "42", groupId, name: "Hymn" });
        expect(stored("pco_tags", tagId)).toEqual({ id: "42", group_id: groupId, name: "Hymn" });
        const songId = seedPcoSong(db);
        seedPcoSongTag(db, songId, tagId);
        expect(db.prepare("SELECT * FROM pco_song_tags").all().map((row) => ({ ...row }))).toEqual([
            { pco_song_id: songId, tag_id: "42" },
        ]);
    });
});
