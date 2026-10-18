import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
    cancelWaitingCreditLabels,
    finishCreditLabel,
    listAutoRequestedSongIds,
    listWaitingCreditLabels,
    nextWaitingCreditLabel,
    putOffCreditLabel,
    queueCreditLabels,
    recentCreditLabels,
    type NewCreditLabelRequest,
} from "./creditLabels";
import { openTestDb, seedCreditLabelRequest, seedPcoSong } from "./testing";

let db: DatabaseSync;

beforeEach(() => {
    db = openTestDb();
});

afterEach(() => {
    db.close();
});

const T0 = new Date("2026-10-04T12:00:00.000Z");
const T1 = new Date("2026-10-04T12:05:00.000Z");

function request(pcoSongId: string, fields: Partial<NewCreditLabelRequest> = {}): NewCreditLabelRequest {
    return {
        pcoSongId,
        source: "review",
        shownAuthor: "Fanny Crosby",
        author: "Words & Music: Fanny Crosby",
        ...fields,
    };
}

describe("queueCreditLabels", () => {
    test("queues each request, waiting, with when it was asked", () => {
        const a = seedPcoSong(db);
        const b = seedPcoSong(db);
        expect(
            queueCreditLabels(
                db,
                [request(a), request(b, { source: "auto", shownAuthor: "", author: "Words: X" })],
                T0
            )
        ).toEqual({ queued: [a, b], waiting: [] });
        expect(listWaitingCreditLabels(db)).toEqual([
            {
                id: expect.any(Number),
                pcoSongId: a,
                source: "review",
                shownAuthor: "Fanny Crosby",
                author: "Words & Music: Fanny Crosby",
                requestedAt: T0.toISOString(),
                attempts: 0,
                finishedAt: null,
                outcome: null,
                message: null,
            },
            expect.objectContaining({ pcoSongId: b, source: "auto", shownAuthor: "", author: "Words: X" }),
        ]);
    });

    test("leaves a song whose request waits already as it is, the same song twice too", () => {
        const a = seedPcoSong(db);
        const b = seedPcoSong(db);
        queueCreditLabels(db, [request(a)], T0);
        expect(
            queueCreditLabels(db, [request(a, { author: "Words: Other" }), request(b), request(b)], T1)
        ).toEqual({ queued: [b], waiting: [a, b] });
        expect(listWaitingCreditLabels(db).map(({ pcoSongId, author }) => [pcoSongId, author])).toEqual([
            [a, "Words & Music: Fanny Crosby"],
            [b, "Words & Music: Fanny Crosby"],
        ]);
    });

    test("queues a song again once its request has ended", () => {
        const a = seedPcoSong(db);
        seedCreditLabelRequest(db, a, { finishedAt: T0.toISOString(), outcome: "changed" });
        expect(queueCreditLabels(db, [request(a)], T1)).toEqual({ queued: [a], waiting: [] });
    });

    test("queues nothing when a song is not mirrored, or a source is unknown", () => {
        const a = seedPcoSong(db);
        expect(() => queueCreditLabels(db, [request(a), request("999")], T0)).toThrow(
            /FOREIGN KEY constraint failed/
        );
        expect(() =>
            queueCreditLabels(db, [request(a, { source: "robot" as NewCreditLabelRequest["source"] })], T0)
        ).toThrow(/Unknown credit label source/);
        expect(listWaitingCreditLabels(db)).toEqual([]);
    });
});

describe("the waiting requests", () => {
    test("come oldest first, skipping a source a newer build wrote", () => {
        const a = seedPcoSong(db);
        const b = seedPcoSong(db);
        const c = seedPcoSong(db);
        seedCreditLabelRequest(db, a, { source: "robot" });
        const second = seedCreditLabelRequest(db, b);
        seedCreditLabelRequest(db, c, { finishedAt: T0.toISOString(), outcome: "labelled" });
        expect(listWaitingCreditLabels(db).map(({ id }) => id)).toEqual([second]);
        expect(nextWaitingCreditLabel(db)?.id).toBe(second);
    });

    test("none waiting gives null", () => {
        expect(nextWaitingCreditLabel(db)).toBeNull();
    });
});

describe("finishCreditLabel", () => {
    test("ends a waiting request with its outcome and message", () => {
        const id = seedCreditLabelRequest(db, seedPcoSong(db));
        expect(finishCreditLabel(db, id, "refused", "author: is too long", T1)).toBe(true);
        expect(nextWaitingCreditLabel(db)).toBeNull();
        expect(recentCreditLabels(db, 10)).toEqual([
            expect.objectContaining({
                id,
                finishedAt: T1.toISOString(),
                outcome: "refused",
                message: "author: is too long",
            }),
        ]);
    });

    test("leaves an ended request as it ended", () => {
        const id = seedCreditLabelRequest(db, seedPcoSong(db));
        expect(cancelWaitingCreditLabels(db, T0)).toBe(1);
        expect(finishCreditLabel(db, id, "labelled", null, T1)).toBe(false);
        expect(recentCreditLabels(db, 1)[0]).toMatchObject({ outcome: "cancelled", finishedAt: T0.toISOString() });
    });

    test("refuses an outcome this build does not know", () => {
        const id = seedCreditLabelRequest(db, seedPcoSong(db));
        expect(() =>
            finishCreditLabel(db, id, "maybe" as Parameters<typeof finishCreditLabel>[2], null, T1)
        ).toThrow(/Unknown credit label outcome/);
    });
});

describe("putOffCreditLabel", () => {
    test("counts a failed attempt and keeps why, leaving it waiting", () => {
        const id = seedCreditLabelRequest(db, seedPcoSong(db));
        expect(putOffCreditLabel(db, id, "Timed out")).toBe(1);
        expect(putOffCreditLabel(db, id, "Planning Center answered 503")).toBe(2);
        expect(nextWaitingCreditLabel(db)).toMatchObject({
            id,
            attempts: 2,
            message: "Planning Center answered 503",
        });
    });

    test("gives null for a request that is not waiting", () => {
        const id = seedCreditLabelRequest(db, seedPcoSong(db), {
            finishedAt: T0.toISOString(),
            outcome: "cancelled",
        });
        expect(putOffCreditLabel(db, id, "Timed out")).toBeNull();
        expect(putOffCreditLabel(db, 999, "Timed out")).toBeNull();
    });
});

describe("cancelWaitingCreditLabels", () => {
    test("ends every waiting request as cancelled and leaves the ended ones", () => {
        const a = seedPcoSong(db);
        seedCreditLabelRequest(db, a, { finishedAt: T0.toISOString(), outcome: "labelled" });
        seedCreditLabelRequest(db, a, { attempts: 1, message: "Timed out" });
        seedCreditLabelRequest(db, seedPcoSong(db));
        expect(cancelWaitingCreditLabels(db, T1)).toBe(2);
        expect(listWaitingCreditLabels(db)).toEqual([]);
        expect(recentCreditLabels(db, 10).map(({ outcome, message }) => [outcome, message])).toEqual([
            ["cancelled", null],
            ["cancelled", null],
            ["labelled", null],
        ]);
        expect(cancelWaitingCreditLabels(db, T1)).toBe(0);
    });
});

describe("listAutoRequestedSongIds", () => {
    test("gives every song the app asked to label by itself, waiting or ended", () => {
        const a = seedPcoSong(db);
        const b = seedPcoSong(db);
        const c = seedPcoSong(db);
        seedCreditLabelRequest(db, a, { source: "auto", finishedAt: T0.toISOString(), outcome: "refused" });
        seedCreditLabelRequest(db, b, { source: "auto" });
        seedCreditLabelRequest(db, c, { source: "review" });
        expect(listAutoRequestedSongIds(db)).toEqual(new Set([a, b]));
    });
});

describe("recentCreditLabels", () => {
    test("gives the ended requests, the last to end first, of the `limit` last", () => {
        const a = seedPcoSong(db);
        const first = seedCreditLabelRequest(db, a, { finishedAt: "2026-10-04T12:01:00.000Z", outcome: "labelled" });
        const last = seedCreditLabelRequest(db, a, { finishedAt: "2026-10-04T12:03:00.000Z", outcome: "gone" });
        const middle = seedCreditLabelRequest(db, a, { finishedAt: "2026-10-04T12:02:00.000Z", outcome: "failed" });
        seedCreditLabelRequest(db, a);
        seedCreditLabelRequest(db, a, { finishedAt: "2026-10-04T12:04:00.000Z", outcome: "maybe" });
        expect(recentCreditLabels(db, 10).map(({ id }) => id)).toEqual([last, middle, first]);
        // The outcome a newer build wrote counts towards the limit, and is left out.
        expect(recentCreditLabels(db, 2).map(({ id }) => id)).toEqual([last]);
    });
});
