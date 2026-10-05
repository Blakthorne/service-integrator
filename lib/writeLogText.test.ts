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

    test("says in its headline that it failed, what it tried, and where", () => {
        const described = failed({ error: "x" });
        expect(described).toMatchObject({
            what: "Creating a hymnal note failed",
            detail: 'Tried to write "R-396 / G-317".',
            place: PLACE,
        });
    });

    test("words a change and a delete that failed as ones that did not happen", () => {
        expect(failed({ error: "x" }, UPDATE)).toMatchObject({
            what: "Changing a hymnal note failed",
            detail: 'Tried to change "R-396" to "R-396 / G-317".',
        });
        expect(failed({ error: "x" }, { ...UPDATE, previous: undefined })).toMatchObject({
            what: "Changing a hymnal note failed",
            detail: 'Tried to set "R-396 / G-317".',
        });
        expect(failed({ error: "x" }, DELETE_NOTHING)).toMatchObject({
            what: "Deleting a hymnal note (its song has no numbers) failed",
            detail: 'The note says "R-396".',
        });
        expect(failed({ error: "x" }, DELETE_EXTRA).what).toBe("Deleting an extra hymnal note failed");
        expect(failed({ error: "x" }, { ...DELETE_EXTRA, reason: undefined }).what).toBe(
            "Deleting a hymnal note failed"
        );
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
        expect(described.outcome).toEqual({
            ok: false,
            message: "Could not send the email: Invalid login",
            status: null,
        });
    });

    test("says in its headline that a send that failed did not go, and to whom it would have", () => {
        const result = {
            error: "Could not send the email: Invalid login",
            code: "EAUTH",
            responseCode: 535,
        } satisfies EmailWriteResult;
        expect(describeWrite(email({ ok: false, result }))).toMatchObject({
            what: "Email to pastor@example.org, music@example.org not sent",
            detail: 'Subject "Songs for 10/4/26 \u00b7 Sunday Morning".',
        });
        // Every other reason a send fails means nothing went: a refused message, a server that could not be reached.
        for (const code of ["EMESSAGE", "EENVELOPE", "ESOCKET", "EDNS", "ECONFIG", undefined]) {
            expect(describeWrite(email({ ok: false, result: { error: "x", code } })).what).toBe(
                "Email to pastor@example.org, music@example.org not sent"
            );
        }
    });

    test.each(["ETIMEDOUT", "ECONNECTION"])(
        "says it may have gone when it failed with %s, so nobody sends it twice",
        (code) => {
            const described = describeWrite(
                email({ ok: false, result: { error: "Could not send the email: Socket timeout", code } })
            );
            expect(described.what).toBe("Email to pastor@example.org, music@example.org may not have been sent");
            expect(described.detail).toBe(
                'Subject "Songs for 10/4/26 \u00b7 Sunday Morning". The mail server went quiet or dropped the connection, so it is not certain that nothing was sent: ask a recipient before sending it again.'
            );
        }
    );

    test("says what it can of a send that failed when the payload lacks parts", () => {
        expect(describeWrite(email({ ok: false, payload: { subject: "Songs" }, result: {} }))).toMatchObject({
            what: "Email not sent",
            detail: 'Subject "Songs".',
        });
        expect(describeWrite(email({ ok: false, payload: { to: ["a@example.org"] }, result: {} }))).toMatchObject({
            what: "Email to a@example.org not sent",
            detail: null,
        });
        expect(describeWrite(email({ ok: false, payload: {}, result: {} })).what).toBe("Email write");
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

/**
 * The payloads and results `lib/queries/pcoSongs.ts` logs, as its tests pin
 * them (`lib/queries/pcoSongs.test.ts`): a refused or failed write logs the
 * same payload with `{ error, status?, details? }` for its result.
 */
const SONG_ID = "26000001";
const SONG_SUMMARY = {
    id: SONG_ID,
    title: "O God, Our Help",
    author: "Words: Isaac Watts; Music: William Croft",
    copyright: "Public Domain",
    ccliNumber: null,
};
const REFUSED = {
    error: "author: is too long",
    status: 422,
    details: ["author: is too long"],
};

/** A row of `kind`, made unless `fields` say otherwise. */
function songRow(kind: WriteLogRow["kind"], fields: Partial<WriteLogRow> = {}): WriteLogRow {
    return { kind, target: `song ${SONG_ID}`, ok: true, payload: {}, result: {}, ...fields };
}

describe("describeWrite: a song's credits saved", () => {
    const CREDITS = {
        action: "credits",
        title: "O God, Our Help",
        previous: "Isaac Watts",
        author: "Words: Isaac Watts; Music: William Croft",
    };
    const credits = (fields: Partial<WriteLogRow> = {}) =>
        songRow("song", { payload: CREDITS, result: { song: SONG_SUMMARY }, ...fields });

    test("says whose credits, what they said and what they say now", () => {
        expect(describeWrite(credits())).toEqual({
            what: 'Credits saved for "O God, Our Help"',
            detail: 'Was "Isaac Watts"; now "Words: Isaac Watts; Music: William Croft".',
            place: null,
            target: `song ${SONG_ID}`,
            outcome: { ok: true },
        });
    });

    test("says only what they say now for a song that had no author", () => {
        expect(describeWrite(credits({ payload: { ...CREDITS, previous: null } })).detail).toBe(
            'Now "Words: Isaac Watts; Music: William Croft".'
        );
    });

    test("still says whose credits when the payload lacks the author", () => {
        expect(describeWrite(credits({ payload: { ...CREDITS, author: undefined } }))).toMatchObject({
            what: 'Credits saved for "O God, Our Help"',
            detail: null,
        });
    });

    test("words a save Planning Center refused as one that did not happen, with its reasons", () => {
        expect(describeWrite(credits({ ok: false, result: REFUSED }))).toMatchObject({
            what: 'Saving the credits of "O God, Our Help" failed',
            detail: 'Tried to change "Isaac Watts" to "Words: Isaac Watts; Music: William Croft".',
            outcome: { ok: false, message: "author: is too long", status: 422 },
        });
        expect(
            describeWrite(credits({ ok: false, payload: { ...CREDITS, previous: null }, result: REFUSED })).detail
        ).toBe('Tried to set "Words: Isaac Watts; Music: William Croft".');
    });

    test.each([
        ["no title", { ...CREDITS, title: undefined }],
        ["a blank title", { ...CREDITS, title: "  " }],
        ["a title that is not text", { ...CREDITS, title: 7 }],
    ])("says only the kind and the target for %s", (_name, payload) => {
        expect(describeWrite(credits({ payload }))).toMatchObject({
            what: "Song write",
            detail: null,
            place: null,
        });
    });
});

describe("describeWrite: a song created in Planning Center", () => {
    const CREATE_SONG = {
        action: "create",
        catalogSongId: 42,
        title: "O God, Our Help",
        author: "Words: Isaac Watts; Music: William Croft",
        copyright: "Public Domain",
    };
    const created = (fields: Partial<WriteLogRow> = {}) =>
        songRow("song", { payload: CREATE_SONG, result: { song: SONG_SUMMARY }, ...fields });

    test("says which song, and the credits and copyright it was given", () => {
        expect(describeWrite(created())).toEqual({
            what: 'Song "O God, Our Help" created in Planning Center',
            detail:
                'With the credits "Words: Isaac Watts; Music: William Croft" and the copyright "Public Domain".',
            place: null,
            target: `song ${SONG_ID}`,
            outcome: { ok: true },
        });
    });

    test("says only the part it was given", () => {
        expect(describeWrite(created({ payload: { ...CREATE_SONG, copyright: "" } })).detail).toBe(
            'With the credits "Words: Isaac Watts; Music: William Croft".'
        );
        expect(describeWrite(created({ payload: { ...CREATE_SONG, author: "" } })).detail).toBe(
            'With the copyright "Public Domain".'
        );
        expect(
            describeWrite(created({ payload: { ...CREATE_SONG, author: "", copyright: "" } })).detail
        ).toBeNull();
    });

    test("words a song Planning Center refused as one that was not created, with the catalog song for a target", () => {
        expect(
            describeWrite(created({ target: "catalog song 42", ok: false, result: REFUSED }))
        ).toMatchObject({
            what: 'Creating the song "O God, Our Help" in Planning Center failed',
            detail:
                'It had the credits "Words: Isaac Watts; Music: William Croft" and the copyright "Public Domain".',
            target: "catalog song 42",
            outcome: { ok: false, message: "author: is too long", status: 422 },
        });
    });

    test("says only the kind and the target when the payload lacks the title", () => {
        expect(describeWrite(created({ payload: { ...CREATE_SONG, title: undefined } })).what).toBe(
            "Song write"
        );
    });
});

describe("describeWrite: a CCLI number set on a song", () => {
    const CCLI = { action: "ccli-number", title: "O God, Our Help", ccliNumber: 22025 };

    test("says which song and the number", () => {
        expect(describeWrite(songRow("song", { payload: CCLI }))).toMatchObject({
            what: 'CCLI number set on "O God, Our Help"',
            detail: "CCLI song number 22025.",
        });
    });

    test("words a number Planning Center refused as one that was not set", () => {
        expect(describeWrite(songRow("song", { payload: CCLI, ok: false, result: REFUSED }))).toMatchObject({
            what: 'Setting the CCLI number of "O God, Our Help" failed',
            detail: "Tried to set CCLI song number 22025.",
        });
    });

    test("still says which song when the payload lacks the number, or has a number that is not whole", () => {
        for (const ccliNumber of [undefined, "22025", 4.5, null]) {
            expect(describeWrite(songRow("song", { payload: { ...CCLI, ccliNumber } }))).toMatchObject({
                what: 'CCLI number set on "O God, Our Help"',
                detail: null,
            });
        }
    });

    test("says only the kind and the target when the payload lacks the title", () => {
        expect(describeWrite(songRow("song", { payload: { ...CCLI, title: "" } })).what).toBe("Song write");
    });
});

describe("describeWrite: typed details written back over CCLI's", () => {
    const RESTORE = {
        action: "restore-typed-details",
        ccliNumber: 22025,
        typed: { title: "O God, Our Help", author: "Words: Isaac Watts; Music: William Croft" },
        fromCcli: { title: "O God Our Help In Ages Past", author: "Isaac Watts, William Croft" },
    };

    test("says what CCLI had put there and what is written back", () => {
        expect(describeWrite(songRow("song", { payload: RESTORE }))).toMatchObject({
            what: "Typed title and credits written back over CCLI's",
            detail:
                'Title was "O God Our Help In Ages Past"; now "O God, Our Help". Credits were "Isaac Watts, William Croft"; now "Words: Isaac Watts; Music: William Croft".',
        });
    });

    test("says only the title, or only the credits, when that is all that was written back", () => {
        const title = describeWrite(
            songRow("song", {
                payload: {
                    ...RESTORE,
                    typed: { title: "O God, Our Help" },
                    fromCcli: { title: "O God Our Help In Ages Past" },
                },
            })
        );
        expect(title).toMatchObject({
            what: "Typed title written back over CCLI's",
            detail: 'Title was "O God Our Help In Ages Past"; now "O God, Our Help".',
        });
        const authorOnly = describeWrite(
            songRow("song", {
                payload: { ...RESTORE, typed: { author: "Words: Isaac Watts" }, fromCcli: { author: "Watts" } },
            })
        );
        expect(authorOnly).toMatchObject({
            what: "Typed credits written back over CCLI's",
            detail: 'Credits were "Watts"; now "Words: Isaac Watts".',
        });
    });

    test("says what is written back when the log has no record of what CCLI had put there", () => {
        expect(
            describeWrite(songRow("song", { payload: { ...RESTORE, fromCcli: undefined } })).detail
        ).toBe(
            'Title now "O God, Our Help". Credits now "Words: Isaac Watts; Music: William Croft".'
        );
    });

    test("words a write Planning Center refused as one that did not happen, with its reasons", () => {
        expect(describeWrite(songRow("song", { payload: RESTORE, ok: false, result: REFUSED }))).toMatchObject({
            what: "Writing the typed title and credits back over CCLI's failed",
            detail:
                'Tried to change the title from "O God Our Help In Ages Past" to "O God, Our Help". Tried to change the credits from "Isaac Watts, William Croft" to "Words: Isaac Watts; Music: William Croft".',
            outcome: { ok: false, status: 422 },
        });
        expect(
            describeWrite(
                songRow("song", {
                    payload: { ...RESTORE, typed: { title: "O God, Our Help" }, fromCcli: undefined },
                    ok: false,
                    result: REFUSED,
                })
            )
        ).toMatchObject({
            what: "Writing the typed title back over CCLI's failed",
            detail: 'Tried to set the title to "O God, Our Help".',
        });
    });

    test.each([
        ["nothing typed", { ...RESTORE, typed: {} }],
        ["no typed details", { ...RESTORE, typed: undefined }],
        ["typed details that are not an object", { ...RESTORE, typed: "x" }],
    ])("says only the kind and the target for %s", (_name, payload) => {
        expect(describeWrite(songRow("song", { payload })).what).toBe("Song write");
    });
});

describe("describeWrite: a song's rows it cannot read", () => {
    test.each([
        ["no payload", null],
        ["a payload that is not an object", "x"],
        ["an array", [1]],
        ["an action it does not know", { action: "archive", title: "O God, Our Help" }],
        ["no action", { title: "O God, Our Help" }],
    ])("says only the kind and the target for %s", (_name, payload) => {
        expect(describeWrite(songRow("song", { payload }))).toEqual({
            what: "Song write",
            detail: null,
            place: null,
            target: `song ${SONG_ID}`,
            outcome: { ok: true },
        });
    });
});

describe("describeWrite: a song added to a plan", () => {
    const ADD = {
        action: "add-song",
        serviceTypeId: "1405391",
        planId: "81234567",
        planDates: "October 11, 2026",
        songId: SONG_ID,
        title: "O God, Our Help",
        arrangementId: "5001",
        arrangement: "Default Arrangement",
    };
    const MADE_ITEM = { item: { id: "950", title: "O God, Our Help", sequence: 18 } };
    const added = (fields: Partial<WriteLogRow> = {}) =>
        songRow("item", {
            target: "plan 81234567 item 950",
            payload: ADD,
            result: MADE_ITEM,
            ...fields,
        });

    test("says which song and which plan, the arrangement, and where the item is", () => {
        expect(describeWrite(added())).toEqual({
            what: '"O God, Our Help" added to the plan for October 11, 2026',
            detail: 'With the arrangement "Default Arrangement".',
            place: { serviceTypeId: "1405391", planId: "81234567", itemId: "950" },
            target: "plan 81234567 item 950",
            outcome: { ok: true },
        });
    });

    test("words an add Planning Center refused as one that failed, and gives the plan but no item", () => {
        expect(
            describeWrite(
                added({
                    target: "plan 81234567",
                    ok: false,
                    result: { error: "title: can't be blank", status: 422, details: ["title: can't be blank"] },
                })
            )
        ).toEqual({
            what: 'Adding "O God, Our Help" to the plan for October 11, 2026 failed',
            detail: 'With the arrangement "Default Arrangement".',
            place: { serviceTypeId: "1405391", planId: "81234567", itemId: null },
            target: "plan 81234567",
            outcome: { ok: false, message: "title: can't be blank", status: 422 },
        });
    });

    test("gives no item when the result does not name one", () => {
        expect(describeWrite(added({ result: { item: { title: "x" } } })).place).toEqual({
            serviceTypeId: "1405391",
            planId: "81234567",
            itemId: null,
        });
        expect(describeWrite(added({ result: null })).place?.itemId).toBeNull();
    });

    test("still says which song and plan when the payload lacks the arrangement, or the ids of the plan", () => {
        expect(describeWrite(added({ payload: { ...ADD, arrangement: undefined } })).detail).toBeNull();
        expect(describeWrite(added({ payload: { ...ADD, serviceTypeId: undefined } }))).toMatchObject({
            what: '"O God, Our Help" added to the plan for October 11, 2026',
            place: null,
        });
        expect(describeWrite(added({ payload: { ...ADD, planId: undefined } })).place).toBeNull();
    });

    test.each([
        ["no title", { ...ADD, title: undefined }],
        ["no date for the plan", { ...ADD, planDates: undefined }],
        ["a blank date", { ...ADD, planDates: " " }],
        ["an action it does not know", { ...ADD, action: "move-song" }],
        ["no payload", null],
    ])("says only the kind and the target for %s", (_name, payload) => {
        expect(describeWrite(added({ payload }))).toEqual({
            what: "Plan item write",
            detail: null,
            place: null,
            target: "plan 81234567 item 950",
            outcome: { ok: true },
        });
    });
});

describe("describeWrite: a song's tags set", () => {
    const ASSIGN = {
        action: "assign",
        title: "Amazing Grace",
        tags: [
            { id: "81", name: "Advent" },
            { id: "72", name: "Chorus" },
            { id: "71", name: "Hymn" },
        ],
        previous: [{ id: "71", name: "Hymn" }],
    };
    const tagged = (fields: Partial<WriteLogRow> = {}) =>
        songRow("tags", { payload: ASSIGN, result: { tagIds: ["81", "72", "71"] }, ...fields });

    test("says what it tried when the song had no tags recorded", () => {
        expect(
            describeWrite(tagged({ ok: false, payload: { ...ASSIGN, previous: undefined }, result: {} })).detail
        ).toBe("Tried to set Advent, Chorus, Hymn.");
    });

    test("says which song, the tags it had and the tags it has now", () => {
        expect(describeWrite(tagged())).toEqual({
            what: 'Tags set on "Amazing Grace"',
            detail: "Was Hymn; now Advent, Chorus, Hymn.",
            place: null,
            target: `song ${SONG_ID}`,
            outcome: { ok: true },
        });
    });

    test("says when every tag was taken off, and when it had none", () => {
        expect(describeWrite(tagged({ payload: { ...ASSIGN, tags: [] } })).detail).toBe(
            "Was Hymn; now no tags."
        );
        expect(describeWrite(tagged({ payload: { ...ASSIGN, previous: [] } })).detail).toBe(
            "Was no tags; now Advent, Chorus, Hymn."
        );
    });

    test("says only the tags it has now when the payload lacks the tags it had", () => {
        expect(describeWrite(tagged({ payload: { ...ASSIGN, previous: undefined } })).detail).toBe(
            "Now Advent, Chorus, Hymn."
        );
    });

    test("names a tag by its id when it has no name, and says nothing of a list whose tags name nothing", () => {
        expect(
            describeWrite(tagged({ payload: { ...ASSIGN, tags: [{ id: "81" }, { name: "Chorus" }, 7, null] } }))
                .detail
        ).toBe("Was Hymn; now 81, Chorus.");
        expect(describeWrite(tagged({ payload: { ...ASSIGN, tags: [{}, 7] } })).detail).toBeNull();
    });

    test("still says which song when the payload lacks the tags", () => {
        expect(describeWrite(tagged({ payload: { ...ASSIGN, tags: undefined } }))).toMatchObject({
            what: 'Tags set on "Amazing Grace"',
            detail: null,
        });
    });

    test("words a write Planning Center refused as one that failed, with its reasons", () => {
        expect(
            describeWrite(
                tagged({
                    ok: false,
                    result: { error: "Planning Center API responded with status: 500", status: 500 },
                })
            )
        ).toMatchObject({
            what: 'Setting the tags of "Amazing Grace" failed',
            detail: "Tried to change Hymn to Advent, Chorus, Hymn.",
            outcome: {
                ok: false,
                message: "Planning Center API responded with status: 500",
                status: 500,
            },
        });
    });

    test.each([
        ["no title", { ...ASSIGN, title: undefined }],
        ["an action it does not know", { ...ASSIGN, action: "clear" }],
        ["another kind's payload", { action: "credits", title: "Amazing Grace" }],
        ["no payload", null],
    ])("says only the kind and the target for %s", (_name, payload) => {
        expect(describeWrite(tagged({ payload }))).toMatchObject({
            what: "Song tags write",
            detail: null,
            place: null,
        });
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
