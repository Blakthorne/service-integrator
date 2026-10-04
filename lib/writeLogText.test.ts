import { describe, expect, test } from "vitest";
import type { WriteLogEntry } from "./db/writeLog";
import type { ItemNoteWritePayload, ItemNoteWriteResult } from "./queries/hymnNotes";
import { NO_REASON_RECORDED, describeWrite, type WriteLogRow } from "./writeLogText";

const IDS = { serviceTypeId: "1405391", planId: "81234567", itemId: "555001" };
const PLACE = { ...IDS };

/** The payloads and results `lib/queries/hymnNotes.ts` records: `satisfies` keeps these in step with its types. */
const CREATE = {
    ...IDS,
    action: "create",
    categoryId: "5636370",
    content: "R-396 / G-317",
} satisfies ItemNoteWritePayload;
const UPDATE = {
    ...IDS,
    action: "update",
    noteId: "77001",
    previous: "R-396",
    content: "R-396 / G-317",
} satisfies ItemNoteWritePayload;
const DELETE_NOTHING = {
    ...IDS,
    action: "delete",
    noteId: "77001",
    previous: "R-396",
    reason: "nothing-to-say",
} satisfies ItemNoteWritePayload;
const DELETE_EXTRA = {
    ...IDS,
    action: "delete",
    noteId: "77002",
    previous: "R-396 again",
    reason: "duplicate",
} satisfies ItemNoteWritePayload;

const MADE = {
    note: { id: "77001", categoryId: "5636370", categoryName: "Hymnal", content: "R-396 / G-317" },
} satisfies ItemNoteWriteResult;
const DELETED = { deleted: "77001" } satisfies ItemNoteWriteResult;

/** A hymnal note row with these fields changed. */
function row(fields: Partial<WriteLogRow> = {}): WriteLogRow {
    return {
        kind: "item-note",
        target: "plan 81234567 item 555001",
        ok: true,
        payload: CREATE,
        result: MADE,
        ...fields,
    };
}

describe("describeWrite: a hymnal note that was made", () => {
    test("created: says what the note says, and where", () => {
        expect(describeWrite(row())).toEqual({
            what: "Created a hymnal note",
            detail: 'It says "R-396 / G-317".',
            place: PLACE,
            target: "plan 81234567 item 555001",
            outcome: { ok: true },
        });
    });

    test("changed: says what it said and what it says now", () => {
        const described = describeWrite(row({ payload: UPDATE }));
        expect(described.what).toBe("Changed a hymnal note");
        expect(described.detail).toBe('Was "R-396"; now "R-396 / G-317".');
        expect(described.place).toEqual(PLACE);
    });

    test("deleted because its song has no numbers: says so, and what it said", () => {
        const described = describeWrite(row({ payload: DELETE_NOTHING, result: DELETED }));
        expect(described.what).toBe("Deleted a hymnal note (its song has no numbers)");
        expect(described.detail).toBe('It said "R-396".');
    });

    test("deleted because it was an extra: says so", () => {
        const described = describeWrite(row({ payload: DELETE_EXTRA, result: DELETED }));
        expect(described.what).toBe("Deleted an extra hymnal note");
        expect(described.detail).toBe('It said "R-396 again".');
    });

    test("says what it can when the payload lacks parts", () => {
        expect(
            describeWrite(row({ payload: { ...IDS, action: "update", content: "R-1" } })).detail
        ).toBe('Now "R-1".');
        expect(
            describeWrite(row({ payload: { ...IDS, action: "update", noteId: "1" } })).detail
        ).toBeNull();
        expect(describeWrite(row({ payload: { ...IDS, action: "delete" } }))).toMatchObject({
            what: "Deleted a hymnal note",
            detail: null,
        });
    });
});

describe("describeWrite: a hymnal note that failed", () => {
    const failed = (result: unknown, payload: unknown = CREATE) =>
        describeWrite(row({ ok: false, payload, result }));

    test("gives Planning Center's reasons for a refusal, and its status", () => {
        expect(
            failed({
                error: "category: must exist",
                status: 422,
                details: ["category: must exist"],
            } satisfies ItemNoteWriteResult).outcome
        ).toEqual({ ok: false, message: "category: must exist", status: 422 });
    });

    test("joins several reasons", () => {
        expect(
            failed({ error: "x", status: 422, details: ["category: must exist", "content: is blank"] })
                .outcome
        ).toEqual({
            ok: false,
            message: "category: must exist; content: is blank",
            status: 422,
        });
    });

    test("gives the error when there are no reasons", () => {
        expect(
            failed({
                error: "Planning Center API responded with status: 500 (/service_types/1405391/plans/1/items/2/item_notes)",
                status: 500,
            } satisfies ItemNoteWriteResult).outcome
        ).toEqual({
            ok: false,
            message:
                "Planning Center API responded with status: 500 (/service_types/1405391/plans/1/items/2/item_notes)",
            status: 500,
        });
        expect(failed({ error: "The request timed out" }).outcome).toEqual({
            ok: false,
            message: "The request timed out",
            status: null,
        });
    });

    test("still says what was attempted, and where", () => {
        const described = failed({ error: "x" });
        expect(described.what).toBe("Created a hymnal note");
        expect(described.place).toEqual(PLACE);
    });

    test.each([
        ["no result", null],
        ["a result that is not an object", "boom"],
        ["an array", ["boom"]],
        ["an empty object", {}],
        ["empty reasons and an empty error", { details: [" "], error: "  " }],
    ])("says no reason was recorded for %s", (_name, result) => {
        expect(failed(result).outcome).toEqual({
            ok: false,
            message: NO_REASON_RECORDED,
            status: null,
        });
    });

    test("ignores a status that is not a whole number", () => {
        expect(failed({ error: "x", status: "422" }).outcome).toMatchObject({ status: null });
        expect(failed({ error: "x", status: 4.5 }).outcome).toMatchObject({ status: null });
    });
});

describe("describeWrite: rows it cannot read", () => {
    test.each([
        ["no payload", null],
        ["a payload that is not an object", "x"],
        ["an array", [1]],
        ["an empty payload", {}],
        ["ids that are not text", { serviceTypeId: 1, planId: 2, itemId: 3, action: "create" }],
        ["a missing id", { serviceTypeId: "1", planId: "2", action: "create" }],
        ["an action it does not know", { ...IDS, action: "archive" }],
    ])("falls back to the kind and the target for %s", (_name, payload) => {
        expect(describeWrite(row({ payload }))).toEqual({
            what: "Hymnal note write",
            detail: null,
            place: null,
            target: "plan 81234567 item 555001",
            outcome: { ok: true },
        });
    });

    test("words every kind, with the target as all it knows of a write it has no payload for", () => {
        const kinds: WriteLogEntry["kind"][] = ["song", "item", "tags", "email"];
        const what = kinds.map((kind) => describeWrite(row({ kind, payload: {} })).what);
        expect(what).toEqual(["Song write", "Plan item write", "Song tags write", "Email write"]);
    });

    test("does not take another kind's payload for a hymnal note's", () => {
        expect(describeWrite(row({ kind: "song", payload: CREATE })).place).toBeNull();
    });

    test("says the kind as it is for one this build does not know", () => {
        const unknown = { kind: "calendar" } as unknown as Pick<WriteLogRow, "kind">;
        expect(describeWrite(row(unknown)).what).toBe("calendar write");
    });
});
