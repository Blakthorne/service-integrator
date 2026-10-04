import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { openTestDb, seedWriteLog } from "./testing";
import {
    WRITE_LOG_KINDS,
    findCreatedItemNoteIds,
    isWriteLogKind,
    recentWrites,
    recordWrite,
} from "./writeLog";

const T0 = new Date("2026-10-04T12:00:00.000Z");
const T1 = new Date("2026-10-04T12:00:01.000Z");

let db: DatabaseSync;

beforeEach(() => {
    db = openTestDb();
});

afterEach(() => {
    db.close();
});

describe("isWriteLogKind", () => {
    test("accepts the known kinds only", () => {
        expect(WRITE_LOG_KINDS).toEqual(["item-note", "song", "item", "tags", "email"]);
        for (const kind of WRITE_LOG_KINDS) {
            expect(isWriteLogKind(kind)).toBe(true);
        }
        for (const value of ["newer-kind", "Item-Note", "", null]) {
            expect(isWriteLogKind(value)).toBe(false);
        }
    });
});

describe("recordWrite", () => {
    test("records a write and returns its id", () => {
        const id = recordWrite(
            db,
            {
                kind: "item-note",
                target: "plan 10 item 1",
                ok: true,
                payload: { action: "create", categoryId: "501", content: "R-396 / G-317" },
                result: { note: { id: "9001", content: "R-396 / G-317" } },
            },
            T0
        );
        expect(recentWrites(db)).toEqual([
            {
                id,
                at: T0.toISOString(),
                kind: "item-note",
                target: "plan 10 item 1",
                ok: true,
                payload: { action: "create", categoryId: "501", content: "R-396 / G-317" },
                result: { note: { id: "9001", content: "R-396 / G-317" } },
            },
        ]);
    });

    test("records a refused write with Planning Center's error", () => {
        recordWrite(
            db,
            {
                kind: "item-note",
                target: "plan 10 item 1",
                ok: false,
                payload: { action: "update", noteId: "9001", content: "R-12" },
                result: { error: "category: must exist", status: 422 },
            },
            T0
        );
        expect(recentWrites(db)[0]).toMatchObject({
            ok: false,
            result: { error: "category: must exist", status: 422 },
        });
    });

    test("refuses a kind it does not know, and a payload or result JSON cannot hold", () => {
        const entry = { kind: "item-note" as const, target: "t", ok: true, payload: {}, result: {} };
        expect(() => recordWrite(db, { ...entry, kind: "newer-kind" as "item-note" })).toThrow(
            'Unknown write log kind: "newer-kind"'
        );
        expect(() => recordWrite(db, { ...entry, payload: undefined })).toThrow(
            "A write log entry's payload must be JSON-serializable"
        );
        expect(() => recordWrite(db, { ...entry, result: () => 1 })).toThrow(
            "A write log entry's result must be JSON-serializable"
        );
        expect(recentWrites(db)).toEqual([]);
    });

    test("stores a payload or result that is null or a bare value", () => {
        recordWrite(db, { kind: "item-note", target: "t", ok: true, payload: null, result: "done" }, T0);
        expect(recentWrites(db)[0]).toMatchObject({ payload: null, result: "done" });
    });
});

describe("recentWrites", () => {
    test("gives the most recent writes first, at most `limit` of them", () => {
        const ids = [1, 2, 3].map((n) => seedWriteLog(db, { target: `plan 10 item ${n}` }));
        expect(recentWrites(db).map(({ id }) => id)).toEqual([...ids].reverse());
        expect(recentWrites(db, 2).map(({ id }) => id)).toEqual([ids[2], ids[1]]);
    });

    test("leaves out the kinds a newer build wrote", () => {
        const known = seedWriteLog(db, { kind: "item-note", at: T0.toISOString() });
        seedWriteLog(db, { kind: "newer-kind", at: T1.toISOString() });
        expect(recentWrites(db).map(({ id }) => id)).toEqual([known]);
    });

    test("is empty before the first write", () => {
        expect(recentWrites(db)).toEqual([]);
    });
});

describe("findCreatedItemNoteIds", () => {
    /** Log a successful create of note `id`, as syncHymnNotes records it. */
    function created(id: string, fields: { ok?: boolean; kind?: string } = {}) {
        seedWriteLog(db, {
            kind: fields.kind ?? "item-note",
            ok: fields.ok ?? true,
            payload: { action: "create", serviceTypeId: "1", planId: "10", itemId: "1", categoryId: "503", content: "R-1" },
            result: { note: { id, categoryId: "503", categoryName: "Hymnal", content: "R-1" } },
        });
    }

    test("finds the notes the app created, among the ids asked about", () => {
        created("9001");
        created("9002");
        created("9003");
        expect(findCreatedItemNoteIds(db, ["9001", "9003", "9999"])).toEqual(new Set(["9001", "9003"]));
    });

    test("does not count a create that failed, or a write of another kind", () => {
        created("9001", { ok: false });
        created("9002", { kind: "song" });
        created("9003", { kind: "newer-kind" });
        expect(findCreatedItemNoteIds(db, ["9001", "9002", "9003"])).toEqual(new Set());
    });

    test("does not count an update or a delete of a note, which the app did not create", () => {
        seedWriteLog(db, {
            payload: { action: "update", noteId: "9001", previous: "R-1", content: "R-2" },
            result: { note: { id: "9001", categoryId: "503", categoryName: "Hymnal", content: "R-2" } },
        });
        seedWriteLog(db, {
            payload: { action: "delete", noteId: "9002", previous: "R-1", reason: "duplicate" },
            result: { deleted: "9002" },
        });
        expect(findCreatedItemNoteIds(db, ["9001", "9002"])).toEqual(new Set());
    });

    test("counts a note the app created and later updated", () => {
        created("9001");
        seedWriteLog(db, {
            payload: { action: "update", noteId: "9001", previous: "R-1", content: "R-2" },
            result: { note: { id: "9001", categoryId: "503", categoryName: "Hymnal", content: "R-2" } },
        });
        expect(findCreatedItemNoteIds(db, ["9001"])).toEqual(new Set(["9001"]));
    });

    test("finds none in an empty log, and asks nothing for no ids", () => {
        expect(findCreatedItemNoteIds(db, ["9001"])).toEqual(new Set());
        const prepare = vi.spyOn(db, "prepare");
        expect(findCreatedItemNoteIds(db, [])).toEqual(new Set());
        expect(prepare).not.toHaveBeenCalled();
    });
});
