import type { DatabaseSync, StatementSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { listWaitingCreditLabels, recentCreditLabels } from "@/lib/db/creditLabels";
import { findSongCredits } from "@/lib/db/credits";
import { linkSong } from "@/lib/db/links";
import { finishSyncRun, startSyncRun } from "@/lib/db/syncRuns";
import {
    openTestDb,
    seedCreditLabelRequest,
    seedPcoSong,
    seedPcoSongCredits,
    seedSetting,
    seedSong,
} from "@/lib/db/testing";
import { stubFetchRoutes } from "@/lib/pco/testing";

const { getDb, runJob } = vi.hoisted(() => ({ getDb: vi.fn(), runJob: vi.fn() }));
vi.mock("@/lib/db", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/db")>()),
    getDb,
}));
vi.mock("@/lib/jobs", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/jobs")>()),
    runJob,
}));

import { creditLabelsJob } from "@/lib/jobs";
import {
    cancelCreditLabels,
    getCreditLabelSets,
    getCreditLabelsPage,
    rederiveAllCredits,
    requestCreditLabels,
} from "./credits";

let db: DatabaseSync;

beforeEach(() => {
    db = openTestDb();
    getDb.mockReturnValue(db);
    runJob.mockResolvedValue({ run: null, error: "not run in tests" });
});

afterEach(() => {
    db.close();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

/** Three mirrored songs, each with credits derived with the default roles. */
function seedSongs() {
    seedPcoSong(db, { id: "1001", author: "Text: Isaac Watts; Tune: William Croft" });
    seedPcoSongCredits(db, "1001", [], "unparsed");
    seedPcoSong(db, {
        id: "1002",
        author: "Words: John Newton",
        removedAt: "2026-10-04T13:00:00.000Z",
    });
    seedPcoSongCredits(db, "1002", [{ role: "Words", names: ["John Newton"] }]);
    seedPcoSong(db, { id: "1003", author: "Lowell Mason", ignoredAt: "2026-10-04T13:00:00.000Z" });
}

describe("rederiveAllCredits", () => {
    test("reads every mirrored song's author again with the stored roles, removed and ignored songs too", () => {
        seedSongs();
        seedSetting(db, "creditRoles", ["Text", "Tune"]);

        expect(rederiveAllCredits()).toEqual({ songs: 3, ok: 1, legacy: 1, unparsed: 1 });
        expect(findSongCredits(db, "1001")).toEqual({
            status: "ok",
            credits: [
                { role: "Text", names: ["Isaac Watts"] },
                { role: "Tune", names: ["William Croft"] },
            ],
        });
        expect(findSongCredits(db, "1002")).toEqual({ status: "unparsed", credits: [] });
        expect(findSongCredits(db, "1003")).toEqual({
            status: "legacy",
            credits: [
                { role: "Text", names: ["Lowell Mason"] },
                { role: "Tune", names: ["Lowell Mason"] },
            ],
        });
    });

    test("reads them with the default roles when the stored ones do not parse, or none are stored", () => {
        seedSongs();
        seedSetting(db, "creditRoles", ["Text"]);
        expect(rederiveAllCredits()).toEqual({ songs: 3, ok: 1, legacy: 1, unparsed: 1 });
        expect(findSongCredits(db, "1002")).toEqual({
            status: "ok",
            credits: [{ role: "Words", names: ["John Newton"] }],
        });

        db.prepare("DELETE FROM settings").run();
        expect(rederiveAllCredits()).toEqual({ songs: 3, ok: 1, legacy: 1, unparsed: 1 });
    });

    test("gives zero songs for an empty mirror", () => {
        expect(rederiveAllCredits()).toEqual({ songs: 0, ok: 0, legacy: 0, unparsed: 0 });
    });

    test("asks Planning Center nothing", () => {
        seedSongs();
        const fetchMock = stubFetchRoutes({});
        rederiveAllCredits();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    test("is one transaction: a failure part-way leaves every song's credits as they were", () => {
        seedSongs();
        seedSetting(db, "creditRoles", ["Text", "Tune"]);
        const before = ["1001", "1002", "1003"].map((id) => findSongCredits(db, id));

        // The second song's credits fail to store.
        const prepare = db.prepare.bind(db);
        let inserts = 0;
        vi.spyOn(db, "prepare").mockImplementation((sql: string) => {
            const statement = prepare(sql);
            if (!sql.includes("INSERT INTO pco_song_credits")) {
                return statement;
            }
            return new Proxy(statement, {
                get(target, key) {
                    if (key === "run") {
                        return (...params: Parameters<StatementSync["run"]>) => {
                            inserts += 1;
                            if (inserts === 3) {
                                throw new Error("database or disk is full");
                            }
                            return target.run(...params);
                        };
                    }
                    const value = Reflect.get(target, key);
                    return typeof value === "function" ? value.bind(target) : value;
                },
            });
        });

        expect(() => rederiveAllCredits()).toThrow("database or disk is full");
        vi.restoreAllMocks();
        expect(["1001", "1002", "1003"].map((id) => findSongCredits(db, id))).toEqual(before);
    });

    test("throws when the database cannot be opened", () => {
        const cause = new Error("Could not open the database at /srv/data/x: denied");
        getDb.mockImplementation(() => {
            throw cause;
        });
        expect(() => rederiveAllCredits()).toThrow(cause);
    });
});

describe("getCreditLabelSets", () => {
    test("groups the labels of the songs' authors with the stored roles, leaving out removed songs", () => {
        seedSongs();
        seedPcoSong(db, {
            id: "1004",
            author: "Text: John Newton; Tune: Anon",
            ignoredAt: "2026-10-04T13:00:00.000Z",
        });
        seedPcoSong(db, { id: "1005", author: "Text: Fanny Crosby" });
        seedPcoSong(db, {
            id: "1006",
            author: "Text: Charles Wesley",
            removedAt: "2026-10-04T13:00:00.000Z",
        });
        seedSetting(db, "creditRoles", ["Text", "Tune"]);

        // An ignored song (1004) counts; one Planning Center no longer has (1006) does not,
        // and neither do authors with no labels (1003) or labels that are not roles (1002).
        expect(getCreditLabelSets()).toEqual({
            sets: [
                { labels: ["Text", "Tune"], songs: 2 },
                { labels: ["Text"], songs: 1 },
            ],
            error: null,
        });
    });

    test("reads them with the default roles when the stored ones do not parse, or none are stored", () => {
        seedPcoSong(db, { id: "1001", author: "Words: Isaac Watts; Music: Lowell Mason" });
        seedPcoSong(db, { id: "1002", author: "Text: Isaac Watts" });
        const expected = { sets: [{ labels: ["Words", "Music"], songs: 1 }], error: null };

        expect(getCreditLabelSets()).toEqual(expected);
        seedSetting(db, "creditRoles", ["Text"]);
        expect(getCreditLabelSets()).toEqual(expected);
    });

    test("gives no sets for an empty mirror", () => {
        expect(getCreditLabelSets()).toEqual({ sets: [], error: null });
    });

    test("asks Planning Center nothing", () => {
        seedSongs();
        const fetchMock = stubFetchRoutes({});
        getCreditLabelSets();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    test("never throws: a database that cannot be opened is logged, and comes back as the error", () => {
        const cause = new Error("Could not open the database at /srv/data/x: denied");
        getDb.mockImplementation(() => {
            throw cause;
        });
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

        expect(getCreditLabelSets()).toEqual({
            sets: [],
            error: "Could not open the database at /srv/data/x: denied",
        });
        expect(consoleError).toHaveBeenCalledWith(
            "Failed to read the labels of the songs' credits:",
            cause
        );
    });
});

describe("getCreditLabelsPage", () => {
    const T0 = new Date("2026-10-04T12:00:00.000Z");

    test("sorts the songs still in Planning Center by their labels, with what waits and the latest runs", () => {
        const heber = seedPcoSong(db, { title: "Holy, Holy, Holy", author: "Reginald Heber and John B. Dykes" });
        seedPcoSong(db, { title: "Amazing Grace", author: "Words: John Newton" });
        seedPcoSong(db, { title: "Gone", author: "Fanny Crosby", removedAt: T0.toISOString() });
        const crosby = seedPcoSong(db, { title: "Blessed Assurance", author: "Fanny Crosby" });
        const song = seedSong(db);
        linkSong(db, song, crosby, "manual", T0);
        seedCreditLabelRequest(db, heber, {
            shownAuthor: "Reginald Heber and John B. Dykes",
            author: "Words: Reginald Heber; Music: John B. Dykes",
        });
        const run = startSyncRun(db, "credit-labels", T0);
        finishSyncRun(db, run, { ok: true, message: "Labelled 3 songs" }, T0);

        const page = getCreditLabelsPage();
        expect(page.review.labelled).toBe(1);
        expect(page.review.tiers.map(({ rows }) => rows.map(({ title, queued, catalogSongId }) => [title, queued, catalogSongId]))).toEqual([
            [["Blessed Assurance", false, song]],
            [["Holy, Holy, Holy", true, null]],
            [],
        ]);
        expect(page.waiting).toBe(1);
        expect(page.lastRun).toMatchObject({ kind: "credit-labels", message: "Labelled 3 songs" });
        expect(page.lastSync).toBeNull();
        expect(page.problems).toEqual([]);
    });

    test("labels with the stored credit roles", () => {
        seedPcoSong(db, { title: "O God, Our Help", author: "Isaac Watts and William Croft" });
        seedSetting(db, "creditRoles", ["Text", "Tune"]);
        expect(getCreditLabelsPage().review.tiers[1].rows[0].proposal.author).toBe(
            "Text: Isaac Watts; Tune: William Croft"
        );
    });

    test("lists the latest labels that did not go through, newest first, with their songs' titles", () => {
        const a = seedPcoSong(db, { title: "Abide with Me", author: "Henry F. Lyte and William H. Monk" });
        seedCreditLabelRequest(db, a, { finishedAt: "2026-10-04T12:01:00.000Z", outcome: "labelled" });
        seedCreditLabelRequest(db, a, {
            finishedAt: "2026-10-04T12:02:00.000Z",
            outcome: "refused",
            message: "author: is too long",
        });
        seedCreditLabelRequest(db, a, { finishedAt: "2026-10-04T12:03:00.000Z", outcome: "cancelled" });
        seedCreditLabelRequest(db, a, {
            source: "auto",
            finishedAt: "2026-10-04T12:04:00.000Z",
            outcome: "changed",
            message: "Its author is \"X\" now",
        });
        expect(getCreditLabelsPage().problems).toEqual([
            {
                id: expect.any(Number),
                pcoSongId: a,
                title: "Abide with Me",
                source: "auto",
                outcome: "changed",
                message: 'Its author is "X" now',
                finishedAt: "2026-10-04T12:04:00.000Z",
            },
            expect.objectContaining({ outcome: "refused", message: "author: is too long", source: "review" }),
        ]);
    });
});

describe("requestCreditLabels", () => {
    const T0 = new Date("2026-10-04T12:00:00.000Z");
    const HEBER = "Reginald Heber and John B. Dykes";
    const HEBER_LABEL = "Words: Reginald Heber; Music: John B. Dykes";

    test("queues each label as the page showed it, and starts the job", () => {
        const heber = seedPcoSong(db, { author: HEBER });
        const crosby = seedPcoSong(db, { author: "Fanny Crosby" });
        expect(
            requestCreditLabels(
                [
                    { pcoSongId: heber, shownAuthor: HEBER, author: HEBER_LABEL },
                    { pcoSongId: crosby, shownAuthor: "Fanny Crosby", author: "Words & Music: Fanny Crosby" },
                ],
                T0
            )
        ).toEqual({ queued: 2, waiting: 0, changed: 0 });
        expect(listWaitingCreditLabels(db).map(({ pcoSongId, source, shownAuthor, author }) => [pcoSongId, source, shownAuthor, author])).toEqual([
            [heber, "review", HEBER, HEBER_LABEL],
            [crosby, "review", "Fanny Crosby", "Words & Music: Fanny Crosby"],
        ]);
        expect(runJob).toHaveBeenCalledOnce();
        expect(runJob).toHaveBeenCalledWith(creditLabelsJob);
    });

    test("leaves out a song that is no longer as the page showed it", () => {
        const changed = seedPcoSong(db, { author: "Reginald Heber, John B. Dykes" });
        const gone = seedPcoSong(db, { author: HEBER, removedAt: T0.toISOString() });
        const relabelled = seedPcoSong(db, { author: HEBER });
        const labelled = seedPcoSong(db, { author: HEBER_LABEL });
        expect(
            requestCreditLabels(
                [
                    // Planning Center has another author since the page loaded.
                    { pcoSongId: changed, shownAuthor: HEBER, author: HEBER_LABEL },
                    // Planning Center no longer has the song, or never had it.
                    { pcoSongId: gone, shownAuthor: HEBER, author: HEBER_LABEL },
                    { pcoSongId: "999", shownAuthor: HEBER, author: HEBER_LABEL },
                    // The app makes another label of the author now.
                    { pcoSongId: relabelled, shownAuthor: HEBER, author: "Words & Music: Reginald Heber" },
                    // The author is labelled already: there is nothing to make of it.
                    { pcoSongId: labelled, shownAuthor: HEBER_LABEL, author: HEBER_LABEL },
                ],
                T0
            )
        ).toEqual({ queued: 0, waiting: 0, changed: 5 });
        expect(listWaitingCreditLabels(db)).toEqual([]);
        expect(runJob).not.toHaveBeenCalled();
    });

    test("leaves a song whose label waits already as it is, and starts the job for it", () => {
        const heber = seedPcoSong(db, { author: HEBER });
        seedCreditLabelRequest(db, heber, { shownAuthor: HEBER, author: HEBER_LABEL });
        expect(requestCreditLabels([{ pcoSongId: heber, shownAuthor: HEBER, author: HEBER_LABEL }], T0)).toEqual({
            queued: 0,
            waiting: 1,
            changed: 0,
        });
        expect(runJob).toHaveBeenCalledWith(creditLabelsJob);
    });
});

describe("cancelCreditLabels", () => {
    test("ends every label that waits as cancelled", () => {
        seedCreditLabelRequest(db, seedPcoSong(db));
        seedCreditLabelRequest(db, seedPcoSong(db));
        expect(cancelCreditLabels(new Date("2026-10-04T12:00:00.000Z"))).toBe(2);
        expect(listWaitingCreditLabels(db)).toEqual([]);
        expect(recentCreditLabels(db, 10).map(({ outcome }) => outcome)).toEqual(["cancelled", "cancelled"]);
    });
});
