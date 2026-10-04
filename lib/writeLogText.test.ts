import { describe, expect, test } from "vitest";
import type { WriteLogEntry } from "./db/writeLog";
import type { EmailWritePayload, EmailWriteResult } from "./queries/email";
import type { ItemNoteWritePayload, ItemNoteWriteResult } from "./queries/hymnNotes";
import {
    NO_REASON_RECORDED,
    describeFailureLine,
    describeWrite,
    type WriteLogRow,
} from "./writeLogText";

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

describe("describeWrite: a plan's email", () => {
    /** What `lib/queries/email.ts` records: `satisfies` keeps these in step with its types. */
    const PAYLOAD = {
        to: ["pastor@example.org", "music@example.org"],
        subject: "Songs for 10/4/26 \u00b7 Sunday Morning",
    } satisfies EmailWritePayload;
    const SENT = {
        messageId: "<1@example.org>",
        accepted: ["pastor@example.org", "music@example.org"],
        rejected: [],
    } satisfies EmailWriteResult;

    function email(fields: Partial<WriteLogRow> = {}): WriteLogRow {
        return {
            kind: "email",
            target: "plan 81234567",
            ok: true,
            payload: PAYLOAD,
            result: SENT,
            ...fields,
        };
    }

    test("says who it went to and its subject, and keeps the target", () => {
        expect(describeWrite(email())).toEqual({
            what: "Sent a plan's email",
            detail: 'To pastor@example.org, music@example.org: "Songs for 10/4/26 \u00b7 Sunday Morning".',
            place: null,
            target: "plan 81234567",
            outcome: { ok: true },
        });
    });

    test("says who the mail server refused, though the others got it", () => {
        const result = {
            messageId: "<2@example.org>",
            accepted: ["pastor@example.org"],
            rejected: ["music@example.org"],
        } satisfies EmailWriteResult;
        expect(describeWrite(email({ result })).detail).toBe(
            'To pastor@example.org, music@example.org: "Songs for 10/4/26 \u00b7 Sunday Morning". The mail server refused music@example.org.'
        );
    });

    test("gives the reason a send failed, with no Planning Center status it never had", () => {
        const result = {
            error: "Could not send the email: Invalid login",
            code: "EAUTH",
            responseCode: 535,
        } satisfies EmailWriteResult;
        const described = describeWrite(email({ ok: false, result }));
        expect(described.what).toBe("Sent a plan's email");
        expect(described.outcome).toEqual({
            ok: false,
            message: "Could not send the email: Invalid login",
            status: null,
        });
    });

    test("says what it can when the payload lacks parts", () => {
        expect(describeWrite(email({ payload: { to: ["a@example.org"] } })).detail).toBe(
            "To a@example.org."
        );
        expect(describeWrite(email({ payload: { subject: "Songs" } })).detail).toBe('Subject "Songs".');
        expect(describeWrite(email({ payload: { to: [], subject: " " } }))).toMatchObject({
            what: "Email write",
            detail: null,
        });
    });

    test.each([
        ["no payload", null],
        ["a payload that is not an object", "x"],
        ["an array", [1]],
        ["an empty payload", {}],
    ])("falls back to the kind and the target for %s", (_name, payload) => {
        expect(describeWrite(email({ payload }))).toEqual({
            what: "Email write",
            detail: null,
            place: null,
            target: "plan 81234567",
            outcome: { ok: true },
        });
    });

    test("does not read a result that is not an object for refused recipients", () => {
        expect(describeWrite(email({ result: "x" })).detail).toBe(
            'To pastor@example.org, music@example.org: "Songs for 10/4/26 \u00b7 Sunday Morning".'
        );
    });

    test("does not take another kind's payload for an email's", () => {
        expect(describeWrite(email({ kind: "song" })).what).toBe("Song write");
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

describe("describeFailureLine", () => {
    test("adds the status Planning Center answered with to its reasons", () => {
        expect(
            describeFailureLine({ ok: false, message: "category: must exist", status: 422 })
        ).toBe("category: must exist (Planning Center answered 422)");
    });

    test("does not repeat a status the reason already says", () => {
        const message =
            "Planning Center API responded with status: 500 (/service_types/1/plans/2/items/3/item_notes)";
        expect(describeFailureLine({ ok: false, message, status: 500 })).toBe(message);
    });

    test("is the reason alone when the log has no status", () => {
        expect(describeFailureLine({ ok: false, message: "The request timed out", status: null })).toBe(
            "The request timed out"
        );
    });
});
