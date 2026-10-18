import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { queueCreditLabels, listWaitingCreditLabels, recentCreditLabels } from "@/lib/db/creditLabels";
import { findSongCredits } from "@/lib/db/credits";
import { findPcoSong } from "@/lib/db/pcoSongs";
import { openTestDb, seedCreditLabelRequest, seedPcoSong, seedSetting } from "@/lib/db/testing";
import { recentWrites } from "@/lib/db/writeLog";
import {
    PCO_BASE,
    calledRequests,
    json,
    songResource,
    stubFetchRoutes,
    stubPcoCredentials,
    stubPcoPacer,
} from "@/lib/pco/testing";

const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/lib/db", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/db")>()),
    getDb,
}));

import {
    CREDIT_LABEL_MAX_ATTEMPTS,
    describeCreditLabelsRun,
    writeCreditLabels,
    type CreditLabelsRunCounts,
} from "./creditLabels";

const T0 = new Date("2026-10-04T12:00:00.000Z");
const songUrl = (id: string) => `${PCO_BASE}/songs/${id}`;

let db: DatabaseSync;

beforeEach(() => {
    stubPcoCredentials();
    stubPcoPacer();
    db = openTestDb();
    getDb.mockReturnValue(db);
    // A failed write is logged; the tests read what it did instead.
    vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
    db.close();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

const HEBER = "Reginald Heber and John B. Dykes";
const HEBER_LABEL = "Words: Reginald Heber; Music: John B. Dykes";
const CROSBY = "Fanny Crosby";
const CROSBY_LABEL = "Words & Music: Fanny Crosby";

/** A mirrored song with `author`, and a request to label it, as the Credits page queues one. */
function queued(id: string, author: string, label: string, source: "review" | "auto" = "review"): void {
    seedPcoSong(db, { id, title: `Song ${id}`, author });
    queueCreditLabels(db, [{ pcoSongId: id, source, shownAuthor: author, author: label }], T0);
}

/** Planning Center's routes for a song that has `author` now and takes a PATCH of its author. */
function songRoutes(id: string, author: string | null) {
    return {
        [songUrl(id)]: { data: songResource(id, { title: `Song ${id}`, author }) },
        [`PATCH ${songUrl(id)}`]: (init?: RequestInit) => {
            const sent = JSON.parse(String(init?.body)).data.attributes.author as string;
            return json({ data: songResource(id, { title: `Song ${id}`, author: sent }) });
        },
    };
}

function writesSent(fetchMock: ReturnType<typeof stubFetchRoutes>) {
    return calledRequests(fetchMock).filter(({ method }) => method !== "GET");
}

/** The ended requests, oldest first, as [song, outcome, message]. */
function ended() {
    return recentCreditLabels(db, 1000)
        .reverse()
        .map(({ pcoSongId, outcome, message }) => [pcoSongId, outcome, message]);
}

const NONE: CreditLabelsRunCounts = {
    labelled: 0,
    unchanged: 0,
    changed: 0,
    refused: 0,
    gone: 0,
    putOff: 0,
    failed: 0,
    waiting: 0,
};

describe("writeCreditLabels", () => {
    test("writes each waiting label, oldest first, paced, logs who asked and mirrors the song", async () => {
        queued("1001", HEBER, HEBER_LABEL);
        queued("1002", CROSBY, CROSBY_LABEL, "auto");
        const acquire = vi.spyOn(stubPcoPacer(), "acquire");
        const fetchMock = stubFetchRoutes({ ...songRoutes("1001", HEBER), ...songRoutes("1002", CROSBY) });

        await expect(writeCreditLabels(db, () => T0)).resolves.toEqual({ ...NONE, labelled: 2 });
        expect(writesSent(fetchMock)).toEqual([
            {
                method: "PATCH",
                url: songUrl("1001"),
                body: { data: { type: "Song", attributes: { author: HEBER_LABEL } } },
            },
            {
                method: "PATCH",
                url: songUrl("1002"),
                body: { data: { type: "Song", attributes: { author: CROSBY_LABEL } } },
            },
        ]);
        // Each song's fresh read and its write waited their turn.
        expect(acquire).toHaveBeenCalledTimes(4);
        expect(ended()).toEqual([
            ["1001", "labelled", null],
            ["1002", "labelled", null],
        ]);
        expect(
            recentWrites(db, 10)
                .reverse()
                .map(({ target, ok, payload }) => [target, ok, payload])
        ).toEqual([
            [
                "song 1001",
                true,
                { action: "credits", title: "Song 1001", previous: HEBER, author: HEBER_LABEL, labelledBy: "review" },
            ],
            [
                "song 1002",
                true,
                { action: "credits", title: "Song 1002", previous: CROSBY, author: CROSBY_LABEL, labelledBy: "auto" },
            ],
        ]);
        expect(findPcoSong(db, "1001")).toMatchObject({ author: HEBER_LABEL, syncedAt: T0.toISOString() });
        expect(findSongCredits(db, "1001")).toEqual({
            status: "ok",
            credits: [
                { role: "Words", names: ["Reginald Heber"] },
                { role: "Music", names: ["John B. Dykes"] },
            ],
        });
        expect(listWaitingCreditLabels(db)).toEqual([]);
    });

    test("sends nothing for a song whose author is the label already", async () => {
        queued("1001", HEBER, HEBER_LABEL);
        const fetchMock = stubFetchRoutes(songRoutes("1001", HEBER_LABEL));
        await expect(writeCreditLabels(db, () => T0)).resolves.toEqual({ ...NONE, unchanged: 1 });
        expect(writesSent(fetchMock)).toEqual([]);
        expect(ended()).toEqual([["1001", "unchanged", null]]);
    });

    test("never writes over an author changed since the label was asked for", async () => {
        queued("1001", HEBER, HEBER_LABEL);
        const fetchMock = stubFetchRoutes(songRoutes("1001", "Reginald Heber, John B. Dykes"));
        await expect(writeCreditLabels(db, () => T0)).resolves.toEqual({ ...NONE, changed: 1 });
        expect(writesSent(fetchMock)).toEqual([]);
        expect(ended()).toEqual([
            [
                "1001",
                "changed",
                'Its author is "Reginald Heber, John B. Dykes" now, not "Reginald Heber and John B. Dykes", so nothing was sent.',
            ],
        ]);
        // The mirror takes the author as Planning Center has it now.
        expect(findPcoSong(db, "1001")).toMatchObject({ author: "Reginald Heber, John B. Dykes" });
    });

    test("sends nothing when the credit roles changed so that the label no longer reads as asked", async () => {
        queued("1001", HEBER, HEBER_LABEL);
        seedSetting(db, "creditRoles", ["Text", "Tune"]);
        const fetchMock = stubFetchRoutes({});
        await expect(writeCreditLabels(db, () => T0)).resolves.toEqual({ ...NONE, changed: 1 });
        expect(fetchMock).not.toHaveBeenCalled();
        expect(ended()).toEqual([
            [
                "1001",
                "changed",
                "The credit roles changed since the label was asked for, so it would not read as asked.",
            ],
        ]);
    });

    test("ends a song Planning Center no longer has as gone, and one it refuses as refused", async () => {
        queued("1001", HEBER, HEBER_LABEL);
        queued("1002", CROSBY, CROSBY_LABEL);
        stubFetchRoutes({
            [songUrl("1001")]: () => json({ errors: [] }, { status: 404 }),
            [songUrl("1002")]: { data: songResource("1002", { title: "Song 1002", author: CROSBY }) },
            [`PATCH ${songUrl("1002")}`]: () =>
                json(
                    {
                        errors: [
                            { status: "422", title: "Validation Error", detail: "is too long", source: { parameter: "author" } },
                        ],
                    },
                    { status: 422 }
                ),
        });
        await expect(writeCreditLabels(db, () => T0)).resolves.toEqual({ ...NONE, gone: 1, refused: 1 });
        expect(ended()).toEqual([
            ["1001", "gone", "There is no such Planning Center song."],
            ["1002", "refused", 'Planning Center refused the credits of "Song 1002": author: is too long'],
        ]);
        expect(recentWrites(db, 10)).toMatchObject([{ target: "song 1002", ok: false }]);
    });

    test("puts off a write that failed, goes on to the next, and tries it again in the next run", async () => {
        queued("1001", HEBER, HEBER_LABEL);
        queued("1002", CROSBY, CROSBY_LABEL);
        stubFetchRoutes({
            [songUrl("1001")]: () => json({ errors: [] }, { status: 503 }),
            ...songRoutes("1002", CROSBY),
        });
        await expect(writeCreditLabels(db, () => T0)).resolves.toEqual({
            ...NONE,
            labelled: 1,
            putOff: 1,
            waiting: 1,
        });
        expect(listWaitingCreditLabels(db)).toEqual([
            expect.objectContaining({ pcoSongId: "1001", attempts: 1, message: expect.stringContaining("503") }),
        ]);

        // Its write was made though the answer was lost: the next run finds the label there.
        const fetchMock = stubFetchRoutes(songRoutes("1001", HEBER_LABEL));
        await expect(writeCreditLabels(db, () => T0)).resolves.toEqual({ ...NONE, labelled: 1 });
        expect(writesSent(fetchMock)).toEqual([]);
        expect(ended()).toContainEqual(["1001", "labelled", null]);
    });

    test(`ends a request as failed once its write has failed ${CREDIT_LABEL_MAX_ATTEMPTS} times`, async () => {
        queued("1001", HEBER, HEBER_LABEL);
        queued("1002", CROSBY, CROSBY_LABEL);
        stubFetchRoutes({
            [songUrl("1001")]: () => json({ errors: [] }, { status: 503 }),
            ...songRoutes("1002", CROSBY_LABEL),
        });
        let tick = 0;
        const clock = () => new Date(T0.getTime() + tick++ * 1000);
        expect(CREDIT_LABEL_MAX_ATTEMPTS).toBe(3);
        await expect(writeCreditLabels(db, clock)).resolves.toMatchObject({ unchanged: 1, putOff: 1 });
        // The later runs try only the one that fails, so each records a failed run.
        await expect(writeCreditLabels(db, clock)).rejects.toThrow(/took none/);
        expect(listWaitingCreditLabels(db)).toMatchObject([{ pcoSongId: "1001", attempts: 2 }]);
        await expect(writeCreditLabels(db, clock)).rejects.toThrow(/took none/);
        expect(listWaitingCreditLabels(db)).toEqual([]);
        expect(ended()).toEqual([
            ["1002", "unchanged", null],
            ["1001", "failed", expect.stringContaining("503")],
        ]);
    });

    test("stops after three failures in a row, leaving the rest untried, and fails when none was taken", async () => {
        for (const id of ["1001", "1002", "1003", "1004"]) {
            queued(id, CROSBY, CROSBY_LABEL);
        }
        const fetchMock = stubFetchRoutes(
            Object.fromEntries(
                ["1001", "1002", "1003", "1004"].map((id) => [
                    songUrl(id),
                    () => json({ errors: [] }, { status: 500 }),
                ])
            )
        );
        await expect(writeCreditLabels(db, () => T0)).rejects.toThrow(
            /^Planning Center took none of the labels tried: .*500/
        );
        expect(calledRequests(fetchMock).map(({ url }) => url)).toEqual([
            songUrl("1001"),
            songUrl("1002"),
            songUrl("1003"),
        ]);
        expect(listWaitingCreditLabels(db).map(({ pcoSongId, attempts }) => [pcoSongId, attempts])).toEqual([
            ["1001", 1],
            ["1002", 1],
            ["1003", 1],
            ["1004", 0],
        ]);
    });

    test("stops at a 429 the pacer gave up on, with its error, leaving the request waiting", async () => {
        queued("1001", HEBER, HEBER_LABEL);
        queued("1002", CROSBY, CROSBY_LABEL);
        stubFetchRoutes({
            [songUrl("1001")]: () =>
                json({ errors: [] }, { status: 429, headers: { "Retry-After": "120" } }),
        });
        await expect(writeCreditLabels(db, () => T0)).rejects.toMatchObject({ name: "PcoError", status: 429 });
        expect(listWaitingCreditLabels(db).map(({ pcoSongId, attempts }) => [pcoSongId, attempts])).toEqual([
            ["1001", 0],
            ["1002", 0],
        ]);
    });

    test("never tries a request cancelled meanwhile, and tries one queued meanwhile", async () => {
        queued("1001", HEBER, HEBER_LABEL);
        seedPcoSong(db, { id: "1002", title: "Song 1002", author: CROSBY });
        const cancelled = seedPcoSong(db, { author: CROSBY });
        seedCreditLabelRequest(db, cancelled, { finishedAt: T0.toISOString(), outcome: "cancelled" });
        const routes = songRoutes("1001", HEBER);
        stubFetchRoutes({
            ...songRoutes("1002", CROSBY),
            [songUrl("1001")]: () => {
                // While the first song is read, the Credits page queues another.
                queueCreditLabels(
                    db,
                    [{ pcoSongId: "1002", source: "review", shownAuthor: CROSBY, author: CROSBY_LABEL }],
                    T0
                );
                return json(routes[songUrl("1001")]);
            },
            [`PATCH ${songUrl("1001")}`]: routes[`PATCH ${songUrl("1001")}`],
        });
        await expect(writeCreditLabels(db, () => T0)).resolves.toEqual({ ...NONE, labelled: 2 });
    });

    test("with nothing waiting, reads nothing", async () => {
        const fetchMock = stubFetchRoutes({});
        await expect(writeCreditLabels(db, () => T0)).resolves.toEqual(NONE);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe("describeCreditLabelsRun", () => {
    test("says how many it labelled, then what else happened, then how many wait", () => {
        expect(describeCreditLabelsRun({ ...NONE, labelled: 12 })).toBe("Labelled 12 songs");
        expect(describeCreditLabelsRun({ ...NONE, labelled: 1 })).toBe("Labelled 1 song");
        expect(
            describeCreditLabelsRun({
                labelled: 12,
                unchanged: 1,
                changed: 2,
                refused: 1,
                gone: 1,
                failed: 1,
                putOff: 3,
                waiting: 40,
            })
        ).toBe(
            "Labelled 12 songs: 1 already labelled, 2 changed since, 1 refused by Planning Center, 1 gone from Planning Center, 1 failed, 3 to try again; 40 wait"
        );
        expect(describeCreditLabelsRun({ ...NONE, changed: 1 })).toBe("Labelled 0 songs: 1 changed since");
    });

    test("says when there was nothing to do", () => {
        expect(describeCreditLabelsRun(NONE)).toBe("Nothing to label");
        expect(describeCreditLabelsRun({ ...NONE, waiting: 4 })).toBe("Labelled none; 4 wait");
    });
});
