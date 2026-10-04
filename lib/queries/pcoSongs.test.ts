import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { findSongCredits } from "@/lib/db/credits";
import { findPcoSong } from "@/lib/db/pcoSongs";
import { findSongTags } from "@/lib/db/tags";
import {
    openTestDb,
    seedHymn,
    seedPcoSong,
    seedPcoSongTag,
    seedPcoTag,
    seedPcoTagGroup,
    seedSetting,
    seedSong,
    seedTune,
} from "@/lib/db/testing";
import { recentWrites } from "@/lib/db/writeLog";
import type { SongArrangement } from "@/lib/domain";
import {
    PCO_BASE,
    arrangementResource,
    calledRequests,
    itemResource,
    json,
    listPage,
    planResource,
    serviceTypeResource,
    songResource,
    stubFetchRoutes,
    stubPcoCredentials,
    stubPcoPacer,
    tagResource,
} from "@/lib/pco/testing";

const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/lib/db", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/db")>()),
    getDb,
}));

import {
    addSongToPlan,
    createSongInPlanningCenter,
    defaultArrangement,
    getNewPcoSongDraft,
    listUpcomingPlans,
    pcoSongTitleFor,
    saveSongCredits,
    saveSongTags,
    type NewPcoSongForm,
} from "./pcoSongs";

const SONG = "1001";
const ST = "1405391";
const EVENING = "1486055";
const PLAN = "81234567";
const T0 = new Date("2026-10-04T12:00:00.000Z");

const urls = {
    songs: `${PCO_BASE}/songs`,
    song: (id = SONG) => `${PCO_BASE}/songs/${id}`,
    arrangements: (id = SONG) => `${PCO_BASE}/songs/${id}/arrangements?per_page=100`,
    plan: (st = ST, plan = PLAN) => `${PCO_BASE}/service_types/${st}/plans/${plan}`,
    serviceType: (st = ST) => `${PCO_BASE}/service_types/${st}`,
    items: (st = ST, plan = PLAN) => `${PCO_BASE}/service_types/${st}/plans/${plan}/items`,
    serviceTypes: `${PCO_BASE}/service_types?per_page=100`,
    upcoming: (st: string) =>
        `${PCO_BASE}/service_types/${st}/plans?filter=future&order=sort_date&per_page=100`,
};

const VALIDATION_ERROR = (detail: string, parameter: string) =>
    json(
        { errors: [{ status: "422", title: "Validation Error", detail, source: { parameter } }] },
        { status: 422 }
    );

let db: DatabaseSync;

beforeEach(() => {
    stubPcoCredentials();
    stubPcoPacer();
    db = openTestDb();
    getDb.mockReturnValue(db);
});

afterEach(() => {
    db.close();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

/** The write log's rows, oldest first, as what was asked for and what came of it. */
function writes() {
    return recentWrites(db, 1000)
        .reverse()
        .map(({ kind, target, ok, payload, result }) => ({ kind, target, ok, payload, result }));
}

/** The requests that were not GETs. */
function writesSent(fetchMock: ReturnType<typeof stubFetchRoutes>) {
    return calledRequests(fetchMock).filter(({ method }) => method !== "GET");
}

/** A database that cannot be opened, for getDb to throw. */
function breakDatabase(): Error {
    const cause = new Error("Could not open the database at /srv/data/x: denied");
    getDb.mockImplementation(() => {
        throw cause;
    });
    return cause;
}

describe("saveSongCredits", () => {
    const OUR_HELP = [
        { role: "Words", names: ["Isaac Watts"] },
        { role: "Music", names: ["William Croft"] },
    ];
    const AUTHOR = "Words: Isaac Watts; Music: William Croft";

    test("writes the credits to the song's author in the convention, logs it, and mirrors the song", async () => {
        const fetchMock = stubFetchRoutes({
            [urls.song()]: { data: songResource(SONG, { title: "O God, Our Help", author: "Isaac Watts" }) },
            [`PATCH ${urls.song()}`]: () =>
                json({ data: songResource(SONG, { title: "O God, Our Help", author: AUTHOR }) }),
        });

        await expect(saveSongCredits(SONG, "Isaac Watts", OUR_HELP, T0)).resolves.toEqual({
            ok: true,
            changed: true,
            author: AUTHOR,
            credits: { status: "ok", credits: OUR_HELP },
        });
        expect(writesSent(fetchMock)).toEqual([
            {
                method: "PATCH",
                url: urls.song(),
                body: { data: { type: "Song", attributes: { author: AUTHOR } } },
            },
        ]);
        expect(writes()).toEqual([
            {
                kind: "song",
                target: `song ${SONG}`,
                ok: true,
                payload: { action: "credits", title: "O God, Our Help", previous: "Isaac Watts", author: AUTHOR },
                result: {
                    song: {
                        id: SONG,
                        title: "O God, Our Help",
                        author: AUTHOR,
                        copyright: "Public Domain",
                        ccliNumber: 22025,
                    },
                },
            },
        ]);
        expect(findPcoSong(db, SONG)).toMatchObject({ author: AUTHOR, syncedAt: T0.toISOString() });
        expect(findSongCredits(db, SONG)).toEqual({ status: "ok", credits: OUR_HELP });
    });

    test("cleans what was typed first: names trimmed, roles in the settings' order and spelling", async () => {
        const fetchMock = stubFetchRoutes({
            [urls.song()]: { data: songResource(SONG, { author: "Isaac Watts" }) },
            [`PATCH ${urls.song()}`]: () => json({ data: songResource(SONG, { author: "Words & Music: A; Arr.: B" }) }),
        });
        await saveSongCredits(SONG, "Isaac Watts", [
            { role: "arr.", names: [" B "] },
            { role: "music", names: ["A"] },
            { role: "WORDS", names: ["A", ""] },
        ]);
        expect(writesSent(fetchMock)[0].body).toEqual({
            data: { type: "Song", attributes: { author: "Words & Music: A; Arr.: B" } },
        });
    });

    test("refuses, sending nothing, when the author changed in Planning Center since the page loaded", async () => {
        // The page showed the mirror's "Isaac Wats"; Planning Center has been corrected since.
        seedPcoSong(db, { id: SONG, title: "O God, Our Help", author: "Isaac Wats" });
        const fetchMock = stubFetchRoutes({
            [urls.song()]: { data: songResource(SONG, { title: "O God, Our Help", author: AUTHOR }) },
        });

        await expect(
            saveSongCredits(
                SONG,
                "Isaac Wats",
                [
                    { role: "Words", names: ["Isaac Wats"] },
                    { role: "Arr.", names: ["X"] },
                ],
                T0
            )
        ).resolves.toEqual({
            ok: false,
            reason: "changed",
            message:
                'The credits of "O God, Our Help" changed in Planning Center since this page loaded, so nothing was saved. Check them as they are now, then save again.',
            current: { author: AUTHOR, credits: { status: "ok", credits: OUR_HELP } },
        });
        expect(writesSent(fetchMock)).toEqual([]);
        expect(writes()).toEqual([]);
        // The mirror takes the author as it is now, so the page shows it once reloaded.
        expect(findPcoSong(db, SONG)).toMatchObject({ author: AUTHOR, syncedAt: T0.toISOString() });
        expect(findSongCredits(db, SONG)).toEqual({ status: "ok", credits: OUR_HELP });
    });

    test("refuses too when an author was added or emptied in Planning Center since the page loaded", async () => {
        const fetchMock = stubFetchRoutes({ [urls.song()]: { data: songResource(SONG, { author: "John Newton" }) } });
        await expect(saveSongCredits(SONG, null, OUR_HELP)).resolves.toMatchObject({
            ok: false,
            reason: "changed",
            current: { author: "John Newton" },
        });
        stubFetchRoutes({ [urls.song()]: { data: songResource(SONG, { author: null }) } });
        await expect(saveSongCredits(SONG, "John Newton", OUR_HELP)).resolves.toMatchObject({
            ok: false,
            reason: "changed",
            current: { author: "", credits: { status: "legacy", credits: [] } },
        });
        expect(writesSent(fetchMock)).toEqual([]);
    });

    test("takes an empty author and a missing one for the same, whichever the page or Planning Center has", async () => {
        for (const [shown, now] of [
            [null, ""],
            ["", null],
            [null, null],
        ] as const) {
            const fetchMock = stubFetchRoutes({
                [urls.song()]: { data: songResource(SONG, { author: now }) },
                [`PATCH ${urls.song()}`]: () => json({ data: songResource(SONG, { author: AUTHOR }) }),
            });
            await expect(saveSongCredits(SONG, shown, OUR_HELP)).resolves.toMatchObject({ ok: true, changed: true });
            expect(writesSent(fetchMock)).toHaveLength(1);
        }
    });

    test("saves over an author changed since the page loaded only when it already says exactly that", async () => {
        seedPcoSong(db, { id: SONG, title: "Old title", author: "Isaac Wats" });
        const fetchMock = stubFetchRoutes({
            [urls.song()]: { data: songResource(SONG, { title: "O God, Our Help", author: AUTHOR }) },
        });

        await expect(saveSongCredits(SONG, "Isaac Wats", OUR_HELP, T0)).resolves.toMatchObject({
            ok: true,
            changed: false,
            author: AUTHOR,
        });
        expect(writesSent(fetchMock)).toEqual([]);
        expect(writes()).toEqual([]);
        expect(findPcoSong(db, SONG)).toMatchObject({ title: "O God, Our Help", author: AUTHOR });
        expect(findSongCredits(db, SONG)).toEqual({ status: "ok", credits: OUR_HELP });
    });

    test("follows the roles in the settings", async () => {
        seedSetting(db, "creditRoles", ["Text", "Tune"]);
        const fetchMock = stubFetchRoutes({
            [urls.song()]: { data: songResource(SONG, { author: "" }) },
            [`PATCH ${urls.song()}`]: () => json({ data: songResource(SONG, { author: "Text: A; Tune: B" }) }),
        });
        await expect(
            saveSongCredits(SONG, "", [
                { role: "Text", names: ["A"] },
                { role: "Tune", names: ["B"] },
            ])
        ).resolves.toMatchObject({
            ok: true,
            credits: {
                status: "ok",
                credits: [
                    { role: "Text", names: ["A"] },
                    { role: "Tune", names: ["B"] },
                ],
            },
        });
        expect(writesSent(fetchMock)[0].body).toEqual({
            data: { type: "Song", attributes: { author: "Text: A; Tune: B" } },
        });
        await expect(saveSongCredits(SONG, "", [{ role: "Words", names: ["A"] }])).resolves.toMatchObject({
            ok: false,
            reason: "invalid",
            message: '"Words" is not a credit role: use Text or Tune.',
        });
    });

    test("refuses, sending nothing, an id that is not a song's, credits that do not check, or no names", async () => {
        const fetchMock = stubFetchRoutes({});
        await expect(saveSongCredits("x", "", OUR_HELP)).resolves.toEqual({
            ok: false,
            reason: "not-found",
            message: "There is no such Planning Center song.",
        });
        await expect(saveSongCredits(SONG, "", [{ role: "Composer", names: ["A"] }])).resolves.toMatchObject({
            ok: false,
            reason: "invalid",
        });
        await expect(saveSongCredits(SONG, "", [{ role: "Words", names: ["Newton, John"] }])).resolves.toMatchObject({
            ok: false,
            reason: "invalid",
        });
        await expect(saveSongCredits(SONG, "", [{ role: "Words", names: [" "] }])).resolves.toEqual({
            ok: false,
            reason: "invalid",
            message: "Enter at least one name: the credits would be empty.",
        });
        expect(fetchMock).not.toHaveBeenCalled();
        expect(writes()).toEqual([]);
    });

    test("refuses a song Planning Center does not have, writing nothing", async () => {
        const fetchMock = stubFetchRoutes({ [urls.song()]: () => json({ errors: [] }, { status: 404 }) });
        await expect(saveSongCredits(SONG, "", OUR_HELP)).resolves.toMatchObject({ ok: false, reason: "not-found" });
        expect(writesSent(fetchMock)).toEqual([]);
        expect(findPcoSong(db, SONG)).toBeNull();
    });

    test("gives Planning Center's refusal as a value, logs it, and leaves the mirror alone", async () => {
        seedPcoSong(db, { id: SONG, author: "Isaac Watts" });
        stubFetchRoutes({
            [urls.song()]: { data: songResource(SONG, { title: "O God, Our Help", author: "Isaac Watts" }) },
            [`PATCH ${urls.song()}`]: () => VALIDATION_ERROR("is too long", "author"),
        });

        await expect(saveSongCredits(SONG, "Isaac Watts", OUR_HELP)).resolves.toEqual({
            ok: false,
            reason: "refused",
            message: 'Planning Center refused the credits of "O God, Our Help": author: is too long',
            details: ["author: is too long"],
        });
        expect(writes()).toEqual([
            {
                kind: "song",
                target: `song ${SONG}`,
                ok: false,
                payload: { action: "credits", title: "O God, Our Help", previous: "Isaac Watts", author: AUTHOR },
                result: { error: "author: is too long", status: 422, details: ["author: is too long"] },
            },
        ]);
        expect(findPcoSong(db, SONG)?.author).toBe("Isaac Watts");
        expect(findSongCredits(db, SONG)).toBeNull();
    });

    test("throws when Planning Center fails, after logging the failed write", async () => {
        stubFetchRoutes({
            [urls.song()]: { data: songResource(SONG, { author: "Isaac Watts" }) },
            [`PATCH ${urls.song()}`]: () => json({ errors: [] }, { status: 500 }),
        });
        await expect(saveSongCredits(SONG, "Isaac Watts", OUR_HELP)).rejects.toMatchObject({
            name: "PcoError",
            status: 500,
        });
        expect(writes()).toMatchObject([{ kind: "song", ok: false, result: { status: 500 } }]);
    });

    test("throws before asking Planning Center anything when the database cannot be opened", async () => {
        const cause = breakDatabase();
        vi.spyOn(console, "error").mockImplementation(() => {});
        const fetchMock = stubFetchRoutes({});
        await expect(saveSongCredits(SONG, "", OUR_HELP)).rejects.toBe(cause);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe("pcoSongTitleFor and getNewPcoSongDraft", () => {
    test("adds the tune to the title when the hymn is sung to other tunes too", () => {
        expect(pcoSongTitleFor("Abba, Father", "PRITCHARD", true)).toBe("Abba, Father (PRITCHARD)");
        expect(pcoSongTitleFor("Amazing Grace", "NEW BRITAIN", false)).toBe("Amazing Grace");
        expect(pcoSongTitleFor("Abba, Father", null, true)).toBe("Abba, Father");
    });

    test("gives a catalog song's form its title and link, or null for no such song", () => {
        const abba = seedHymn(db, { title: "Abba, Father" });
        const pritchard = seedSong(db, { hymnId: abba, tuneId: seedTune(db, { name: "PRITCHARD" }) });
        seedSong(db, { hymnId: abba, tuneId: seedTune(db, { name: "ABBA, FATHER" }) });
        seedPcoSong(db, { id: "77" });
        const grace = seedSong(db, {
            hymnId: seedHymn(db, { title: "Amazing Grace" }),
            tuneId: seedTune(db, { name: "NEW BRITAIN" }),
            pcoSongId: "77",
            linkedBy: "manual",
            linkedAt: T0.toISOString(),
        });

        expect(getNewPcoSongDraft(pritchard)).toEqual({
            songId: pritchard,
            title: "Abba, Father (PRITCHARD)",
            pcoSongId: null,
        });
        expect(getNewPcoSongDraft(grace)).toEqual({ songId: grace, title: "Amazing Grace", pcoSongId: "77" });
        expect(getNewPcoSongDraft(9999)).toBeNull();
    });
});

describe("createSongInPlanningCenter", () => {
    const FORM: NewPcoSongForm = {
        title: "O God, Our Help (ST. ANNE)",
        credits: [
            { role: "Words", names: ["Isaac Watts"] },
            { role: "Music", names: ["William Croft"] },
        ],
        copyright: "Public Domain",
        ccliNumber: null,
        useCcliDetails: false,
    };
    const AUTHOR = "Words: Isaac Watts; Music: William Croft";
    const NEW_ID = "2001";

    /** A catalog song with no Planning Center song: O God, Our Help to ST. ANNE. */
    function seedCatalogSong(): number {
        return seedSong(db, {
            hymnId: seedHymn(db, { title: "O God, Our Help in Ages Past" }),
            tuneId: seedTune(db, { name: "ST. ANNE" }),
        });
    }

    /** The song as Planning Center makes it from the form. */
    const created = (attributes: Parameters<typeof songResource>[1] = {}) =>
        songResource(NEW_ID, {
            title: FORM.title,
            author: AUTHOR,
            copyright: "Public Domain",
            ccli_number: null,
            admin: null,
            ...attributes,
        });

    /** What CCLI 22025 makes of the song. */
    const fromCcli = created({
        title: "O God Our Help In Ages Past",
        author: "Isaac Watts, William Croft",
        copyright: "Public Domain",
        ccli_number: 22025,
        admin: "CCLI Admin",
    });

    /** The catalog song's link, as [PCO song id, how]. */
    function linkOf(songId: number) {
        const row = db.prepare("SELECT pco_song_id, linked_by FROM songs WHERE id = ?").get(songId);
        return [row?.pco_song_id, row?.linked_by];
    }

    test("creates the song from the form, logs it, mirrors it with its credits, and links it", async () => {
        const songId = seedCatalogSong();
        const fetchMock = stubFetchRoutes({
            [`POST ${urls.songs}`]: () => json({ data: created() }, { status: 201 }),
        });

        const result = await createSongInPlanningCenter(songId, FORM, T0);

        expect(result).toMatchObject({ ok: true, linked: true, warnings: [], song: { id: NEW_ID, title: FORM.title } });
        expect(writesSent(fetchMock)).toEqual([
            {
                method: "POST",
                url: urls.songs,
                body: {
                    data: {
                        type: "Song",
                        attributes: { title: FORM.title, author: AUTHOR, copyright: "Public Domain" },
                    },
                },
            },
        ]);
        expect(writes()).toEqual([
            {
                kind: "song",
                target: `song ${NEW_ID}`,
                ok: true,
                payload: {
                    action: "create",
                    catalogSongId: songId,
                    title: FORM.title,
                    author: AUTHOR,
                    copyright: "Public Domain",
                },
                result: {
                    song: { id: NEW_ID, title: FORM.title, author: AUTHOR, copyright: "Public Domain", ccliNumber: null },
                },
            },
        ]);
        expect(findPcoSong(db, NEW_ID)).toMatchObject({ title: FORM.title, author: AUTHOR, syncedAt: T0.toISOString() });
        expect(findSongCredits(db, NEW_ID)).toEqual({ status: "ok", credits: FORM.credits });
        expect(linkOf(songId)).toEqual([NEW_ID, "manual"]);
    });

    test("sends only the title when there are no credits or copyright", async () => {
        const songId = seedCatalogSong();
        const fetchMock = stubFetchRoutes({
            [`POST ${urls.songs}`]: () => json({ data: created({ author: null, copyright: null }) }, { status: 201 }),
        });
        await createSongInPlanningCenter(songId, { ...FORM, credits: [], copyright: "  " });
        expect(writesSent(fetchMock)[0].body).toEqual({ data: { type: "Song", attributes: { title: FORM.title } } });
    });

    test("with a CCLI number: creates without it, PATCHes it in, reads the song back, and writes back what CCLI replaced", async () => {
        const songId = seedCatalogSong();
        const restored = created({ ccli_number: 22025, admin: "CCLI Admin" });
        const answers = [json({ data: fromCcli }), json({ data: restored })];
        const fetchMock = stubFetchRoutes({
            [`POST ${urls.songs}`]: () => json({ data: created() }, { status: 201 }),
            [`PATCH ${urls.song(NEW_ID)}`]: () => answers.shift() ?? json({}, { status: 500 }),
            [urls.song(NEW_ID)]: { data: fromCcli },
        });

        const result = await createSongInPlanningCenter(songId, { ...FORM, ccliNumber: 22025 }, T0);

        expect(result).toMatchObject({ ok: true, linked: true, warnings: [] });
        expect(calledRequests(fetchMock).map(({ method, url, body }) => [method, url, body])).toEqual([
            [
                "POST",
                urls.songs,
                { data: { type: "Song", attributes: { title: FORM.title, author: AUTHOR, copyright: "Public Domain" } } },
            ],
            ["PATCH", urls.song(NEW_ID), { data: { type: "Song", attributes: { ccli_number: 22025 } } }],
            ["GET", urls.song(NEW_ID), undefined],
            ["PATCH", urls.song(NEW_ID), { data: { type: "Song", attributes: { title: FORM.title, author: AUTHOR } } }],
        ]);
        expect(writes().map(({ payload }) => (payload as { action: string }).action)).toEqual([
            "create",
            "ccli-number",
            "restore-typed-details",
        ]);
        expect(writes()[2]).toMatchObject({
            target: `song ${NEW_ID}`,
            ok: true,
            payload: {
                ccliNumber: 22025,
                typed: { title: FORM.title, author: AUTHOR },
                fromCcli: { title: "O God Our Help In Ages Past", author: "Isaac Watts, William Croft" },
            },
        });
        expect(findPcoSong(db, NEW_ID)).toMatchObject({
            title: FORM.title,
            author: AUTHOR,
            ccliNumber: 22025,
            admin: "CCLI Admin",
        });
        expect(findSongCredits(db, NEW_ID)?.status).toBe("ok");
        expect(linkOf(songId)).toEqual([NEW_ID, "manual"]);
    });

    test("keeps CCLI's details when asked to", async () => {
        const songId = seedCatalogSong();
        const fetchMock = stubFetchRoutes({
            [`POST ${urls.songs}`]: () => json({ data: created() }, { status: 201 }),
            [`PATCH ${urls.song(NEW_ID)}`]: () => json({ data: fromCcli }),
            [urls.song(NEW_ID)]: { data: fromCcli },
        });

        await expect(
            createSongInPlanningCenter(songId, { ...FORM, ccliNumber: 22025, useCcliDetails: true }, T0)
        ).resolves.toMatchObject({ ok: true, linked: true, song: { title: "O God Our Help In Ages Past" } });
        expect(writesSent(fetchMock)).toHaveLength(2);
        expect(findPcoSong(db, NEW_ID)).toMatchObject({ author: "Isaac Watts, William Croft" });
        expect(findSongCredits(db, NEW_ID)?.status).toBe("legacy");
    });

    test("writes back only what CCLI replaced, and never credits where none were typed", async () => {
        const songId = seedCatalogSong();
        const kept = created({ author: "Isaac Watts, William Croft", ccli_number: 22025 });
        const fetchMock = stubFetchRoutes({
            [`POST ${urls.songs}`]: () => json({ data: created({ author: null }) }, { status: 201 }),
            [`PATCH ${urls.song(NEW_ID)}`]: () => json({ data: kept }),
            [urls.song(NEW_ID)]: { data: kept },
        });

        await createSongInPlanningCenter(songId, { ...FORM, credits: [], ccliNumber: 22025 });
        // The title was not replaced, and no credits were typed: nothing to write back.
        expect(writesSent(fetchMock).map(({ body }) => body)).toEqual([
            { data: { type: "Song", attributes: { title: FORM.title, copyright: "Public Domain" } } },
            { data: { type: "Song", attributes: { ccli_number: 22025 } } },
        ]);
    });

    test("a CCLI number that cannot be set is a warning: the song is still mirrored and linked", async () => {
        const songId = seedCatalogSong();
        stubFetchRoutes({
            [`POST ${urls.songs}`]: () => json({ data: created() }, { status: 201 }),
            [`PATCH ${urls.song(NEW_ID)}`]: () => VALIDATION_ERROR("is invalid", "ccli_number"),
        });

        await expect(createSongInPlanningCenter(songId, { ...FORM, ccliNumber: 22025 })).resolves.toEqual({
            ok: true,
            song: expect.objectContaining({ id: NEW_ID, ccliNumber: null }),
            linked: true,
            warnings: ["The song was created in Planning Center, but its CCLI number could not be set: ccli_number: is invalid"],
        });
        expect(writes().map(({ ok }) => ok)).toEqual([true, false]);
        expect(linkOf(songId)).toEqual([NEW_ID, "manual"]);
    });

    test("a song that cannot be read back is a warning, and keeps what the PATCH answered", async () => {
        const songId = seedCatalogSong();
        stubFetchRoutes({
            [`POST ${urls.songs}`]: () => json({ data: created() }, { status: 201 }),
            [`PATCH ${urls.song(NEW_ID)}`]: () => json({ data: fromCcli }),
            [urls.song(NEW_ID)]: () => json({ errors: [] }, { status: 503 }),
        });

        const result = await createSongInPlanningCenter(songId, { ...FORM, ccliNumber: 22025 });
        expect(result).toMatchObject({ ok: true, linked: true, song: { title: "O God Our Help In Ages Past" } });
        expect(result.ok && result.warnings).toEqual([
            expect.stringMatching(/^The song was created in Planning Center with its CCLI number, but could not be read back/),
        ]);
    });

    test("details that cannot be written back are a warning", async () => {
        const songId = seedCatalogSong();
        const answers = [json({ data: fromCcli }), json({ errors: [] }, { status: 500 })];
        stubFetchRoutes({
            [`POST ${urls.songs}`]: () => json({ data: created() }, { status: 201 }),
            [`PATCH ${urls.song(NEW_ID)}`]: () => answers.shift() ?? json({}, { status: 500 }),
            [urls.song(NEW_ID)]: { data: fromCcli },
        });

        const result = await createSongInPlanningCenter(songId, { ...FORM, ccliNumber: 22025 });
        expect(result.ok && result.warnings).toEqual([
            expect.stringMatching(/^CCLI's details replaced the title and the credits typed, which could not be written back: /),
        ]);
        expect(writes().map(({ ok }) => ok)).toEqual([true, true, false]);
        expect(findPcoSong(db, NEW_ID)).toMatchObject({ title: "O God Our Help In Ages Past" });
    });

    test("refuses, sending nothing, a form that does not check, each about its part", async () => {
        const songId = seedCatalogSong();
        const fetchMock = stubFetchRoutes({});
        const cases: [Partial<NewPcoSongForm>, string, string][] = [
            [{ title: "  " }, "title", "Enter the song's title."],
            [{ title: "O God\nOur Help" }, "title", "The title must be on one line."],
            [{ title: "x".repeat(256) }, "title", "The title is at most 255 characters."],
            [{ credits: [{ role: "Composer", names: ["A"] }] }, "credits", '"Composer" is not a credit role: use Words, Music, Arr. or Trans.'],
            [{ copyright: "2001\nY" }, "copyright", "The copyright must be on one line."],
            [{ ccliNumber: 0 }, "ccliNumber", "A CCLI song number is a whole number, such as 22025."],
            [{ ccliNumber: 1.5 }, "ccliNumber", "A CCLI song number is a whole number, such as 22025."],
        ];
        for (const [change, field, message] of cases) {
            await expect(createSongInPlanningCenter(songId, { ...FORM, ...change })).resolves.toEqual({
                ok: false,
                reason: "invalid",
                message,
                field,
            });
        }
        expect(fetchMock).not.toHaveBeenCalled();
        expect(writes()).toEqual([]);
    });

    test("refuses a catalog song that does not exist or is linked already", async () => {
        const fetchMock = stubFetchRoutes({});
        seedPcoSong(db, { id: "77" });
        const linked = seedSong(db, {
            hymnId: seedHymn(db, { title: "Amazing Grace" }),
            pcoSongId: "77",
            linkedBy: "manual",
            linkedAt: T0.toISOString(),
        });
        await expect(createSongInPlanningCenter(9999, FORM)).resolves.toEqual({
            ok: false,
            reason: "not-found",
            message: "There is no such catalog song.",
        });
        await expect(createSongInPlanningCenter(0, FORM)).resolves.toMatchObject({ reason: "not-found" });
        await expect(createSongInPlanningCenter(linked, FORM)).resolves.toEqual({
            ok: false,
            reason: "linked",
            message: '"Amazing Grace" is linked to a Planning Center song already, so it is not created again.',
        });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    test("refuses the same song while it is being created", async () => {
        const songId = seedCatalogSong();
        let answer: (response: Response) => void = () => {};
        stubFetchRoutes({
            [`POST ${urls.songs}`]: () => new Promise<Response>((resolve) => (answer = resolve)),
        });

        const first = createSongInPlanningCenter(songId, FORM);
        await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
        await expect(createSongInPlanningCenter(songId, FORM)).resolves.toEqual({
            ok: false,
            reason: "busy",
            message: '"O God, Our Help in Ages Past (ST. ANNE)" is being created in Planning Center already.',
        });
        answer(json({ data: created() }, { status: 201 }));
        await expect(first).resolves.toMatchObject({ ok: true, linked: true });
        expect(writes()).toHaveLength(1);
    });

    test("gives Planning Center's refusal of the song as a value, logs it, and links nothing", async () => {
        const songId = seedCatalogSong();
        stubFetchRoutes({ [`POST ${urls.songs}`]: () => VALIDATION_ERROR("can't be blank", "title") });

        await expect(createSongInPlanningCenter(songId, FORM)).resolves.toEqual({
            ok: false,
            reason: "refused",
            message: `Planning Center refused the song "${FORM.title}": title: can't be blank`,
            details: ["title: can't be blank"],
        });
        expect(writes()).toMatchObject([{ kind: "song", target: `catalog song ${songId}`, ok: false }]);
        expect(linkOf(songId)).toEqual([null, null]);
        // Nothing is left marked as under way.
        stubFetchRoutes({ [`POST ${urls.songs}`]: () => json({ data: created() }, { status: 201 }) });
        await expect(createSongInPlanningCenter(songId, FORM)).resolves.toMatchObject({ ok: true });
    });

    test("throws when Planning Center fails before the song exists, after logging it", async () => {
        const songId = seedCatalogSong();
        stubFetchRoutes({ [`POST ${urls.songs}`]: () => json({ errors: [] }, { status: 500 }) });
        await expect(createSongInPlanningCenter(songId, FORM)).rejects.toMatchObject({ status: 500 });
        expect(writes()).toMatchObject([{ ok: false, result: { status: 500 } }]);
    });

    test("a link refused because the catalog song was linked meanwhile is a warning; the song is still mirrored", async () => {
        const songId = seedCatalogSong();
        seedPcoSong(db, { id: "77", title: "O God, Our Help" });
        stubFetchRoutes({
            [`POST ${urls.songs}`]: () => {
                db.prepare("UPDATE songs SET pco_song_id = '77', linked_by = 'manual', linked_at = ? WHERE id = ?").run(
                    T0.toISOString(),
                    songId
                );
                return json({ data: created() }, { status: 201 });
            },
        });

        const result = await createSongInPlanningCenter(songId, FORM);
        expect(result).toMatchObject({ ok: true, linked: false });
        expect(result.ok && result.warnings).toEqual([
            expect.stringMatching(/^The song was created in Planning Center, but not linked: /),
        ]);
        expect(findPcoSong(db, NEW_ID)).not.toBeNull();
        expect(linkOf(songId)).toEqual(["77", "manual"]);
    });

    test("a mirror that cannot be written once the song exists is a warning, never a throw", async () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        const songId = seedCatalogSong();
        stubFetchRoutes({
            [`POST ${urls.songs}`]: () => {
                db.exec("DROP TABLE pco_song_credits");
                return json({ data: created() }, { status: 201 });
            },
        });

        const result = await createSongInPlanningCenter(songId, FORM);
        expect(result).toMatchObject({ ok: true, linked: false, song: { id: NEW_ID } });
        expect(result.ok && result.warnings).toEqual([
            expect.stringMatching(/^The song was created in Planning Center, but could not be linked here \(.+\)\. Link it from Reconcile after the next sync\.$/),
        ]);
        expect(linkOf(songId)).toEqual([null, null]);
        expect(consoleError).toHaveBeenCalled();
    });
});

describe("listUpcomingPlans", () => {
    test("lists every service type's upcoming plans, earliest first, leaving out archived types", async () => {
        const fetchMock = stubFetchRoutes({
            [urls.serviceTypes]: listPage([
                serviceTypeResource({ name: "Sunday Morning" }, ST),
                serviceTypeResource({ name: "Sunday Evening" }, EVENING),
                serviceTypeResource({ name: "Old", archived_at: "2020-01-01T00:00:00Z" }, "1500000"),
            ]),
            [urls.upcoming(ST)]: listPage([
                planResource({ id: "102" }, { sort_date: "2026-10-11T11:00:00Z" }),
                planResource({ id: "101" }, { sort_date: "2026-10-04T11:00:00Z" }),
            ]),
            [urls.upcoming(EVENING)]: listPage([planResource({ id: "201" }, { sort_date: "2026-10-04T08:00:00Z" })]),
        });

        const { plans, failedServiceTypeIds } = await listUpcomingPlans();
        expect(plans.map(({ id, serviceType }) => [id, serviceType])).toEqual([
            ["201", { id: EVENING, name: "Sunday Evening" }],
            ["101", { id: ST, name: "Sunday Morning" }],
            ["102", { id: ST, name: "Sunday Morning" }],
        ]);
        expect(failedServiceTypeIds).toEqual([]);
        expect(fetchMock.mock.calls.map(([url]) => String(url))).not.toContain(urls.upcoming("1500000"));
    });

    test("leaves out and reports a service type whose plans cannot be read", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        stubFetchRoutes({
            [urls.serviceTypes]: listPage([serviceTypeResource({}, ST), serviceTypeResource({}, EVENING)]),
            [urls.upcoming(ST)]: listPage([planResource({ id: "101" })]),
            [urls.upcoming(EVENING)]: () => json({ errors: [] }, { status: 500 }),
        });
        await expect(listUpcomingPlans()).resolves.toMatchObject({
            plans: [{ id: "101" }],
            failedServiceTypeIds: [EVENING],
        });
    });

    test("throws when the service types cannot be read", async () => {
        stubFetchRoutes({ [urls.serviceTypes]: () => json({ errors: [] }, { status: 500 }) });
        await expect(listUpcomingPlans()).rejects.toMatchObject({ status: 500 });
    });
});

describe("defaultArrangement", () => {
    const arrangement = (id: string, createdAt: string | null, archived = false): SongArrangement => ({
        id,
        name: `Arrangement ${id}`,
        archived,
        createdAt,
    });

    test("is the first made of those not archived", () => {
        expect(
            defaultArrangement([
                arrangement("2", "2020-01-01T00:00:00Z"),
                arrangement("1", "2019-01-01T00:00:00Z", true),
                arrangement("3", "2019-06-01T00:00:00Z"),
            ])?.id
        ).toBe("3");
    });

    test("keeps Planning Center's order when the times are the same or unknown", () => {
        expect(defaultArrangement([arrangement("2", null), arrangement("1", null)])?.id).toBe("2");
        expect(
            defaultArrangement([arrangement("2", "2019-01-01T00:00:00Z"), arrangement("1", "2019-01-01T00:00:00Z")])?.id
        ).toBe("2");
        expect(defaultArrangement([arrangement("2", null), arrangement("1", "2019-01-01T00:00:00Z")])?.id).toBe("1");
    });

    test("is null when every arrangement is archived, or there is none", () => {
        expect(defaultArrangement([arrangement("1", null, true)])).toBeNull();
        expect(defaultArrangement([])).toBeNull();
    });
});

describe("addSongToPlan", () => {
    const song = songResource(SONG, { title: "O God, Our Help", author: "Isaac Watts" });
    const plan = planResource({ id: PLAN }, { dates: "October 11, 2026", sort_date: "2026-10-11T11:00:00Z" });
    const later = planResource({ id: "81234599" }, { dates: "October 18, 2026", sort_date: "2026-10-18T11:00:00Z" });

    /** Planning Center's reads: the song, its arrangements, the service type and its upcoming plans. */
    function readRoutes(): Record<string, unknown> {
        return {
            [urls.song()]: { data: song },
            [urls.arrangements()]: listPage([
                arrangementResource("5002", { name: "Choir", created_at: "2021-01-01T00:00:00Z" }),
                arrangementResource("5001"),
            ]),
            [urls.serviceType()]: { data: serviceTypeResource({ name: "Sunday Morning" }, ST) },
            [urls.upcoming(ST)]: listPage([later, plan]),
        };
    }

    const added = itemResource("950", { title: "O God, Our Help", sequence: 18 }, {
        song: { data: { type: "Song", id: SONG } },
    });

    test("adds the song at the end of the plan with its title and default arrangement, logs it, and mirrors the song", async () => {
        const fetchMock = stubFetchRoutes({
            ...readRoutes(),
            [`POST ${urls.items()}`]: () => json({ data: added }, { status: 201 }),
        });

        const result = await addSongToPlan(ST, PLAN, SONG, T0);

        expect(result).toMatchObject({
            ok: true,
            item: { id: "950", title: "O God, Our Help", sequence: 18, songId: SONG },
            plan: { id: PLAN, dates: "October 11, 2026" },
            arrangement: { id: "5001", name: "Default Arrangement" },
        });
        expect(writesSent(fetchMock)).toEqual([
            {
                method: "POST",
                url: urls.items(),
                body: {
                    data: {
                        type: "Item",
                        attributes: { title: "O God, Our Help", song_id: SONG, arrangement_id: "5001" },
                    },
                },
            },
        ]);
        expect(writes()).toEqual([
            {
                kind: "item",
                target: `plan ${PLAN} item 950`,
                ok: true,
                payload: {
                    action: "add-song",
                    serviceTypeId: ST,
                    planId: PLAN,
                    planDates: "October 11, 2026",
                    songId: SONG,
                    title: "O God, Our Help",
                    arrangementId: "5001",
                    arrangement: "Default Arrangement",
                },
                result: { item: { id: "950", title: "O God, Our Help", sequence: 18 } },
            },
        ]);
        expect(findPcoSong(db, SONG)).toMatchObject({ title: "O God, Our Help", syncedAt: T0.toISOString() });
        expect(findSongCredits(db, SONG)?.status).toBe("legacy");
    });

    test("refuses, sending nothing, ids that are not Planning Center ids", async () => {
        const fetchMock = stubFetchRoutes({});
        await expect(addSongToPlan("x", PLAN, SONG)).resolves.toEqual({
            ok: false,
            reason: "not-found",
            message: "There is no such plan.",
        });
        await expect(addSongToPlan(ST, "01", SONG)).resolves.toMatchObject({ reason: "not-found" });
        await expect(addSongToPlan(ST, PLAN, "../1")).resolves.toEqual({
            ok: false,
            reason: "not-found",
            message: "There is no such Planning Center song.",
        });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    test("refuses a song or a service type Planning Center does not have, writing nothing", async () => {
        const missing = () => json({ errors: [] }, { status: 404 });
        let fetchMock = stubFetchRoutes({ ...readRoutes(), [urls.song()]: missing });
        await expect(addSongToPlan(ST, PLAN, SONG)).resolves.toMatchObject({ ok: false, reason: "not-found" });
        expect(writesSent(fetchMock)).toEqual([]);

        for (const gone of [urls.serviceType(), urls.upcoming(ST)]) {
            fetchMock = stubFetchRoutes({ ...readRoutes(), [gone]: missing });
            await expect(addSongToPlan(ST, PLAN, SONG)).resolves.toEqual({
                ok: false,
                reason: "not-found",
                message: "There is no such plan.",
            });
            expect(writesSent(fetchMock)).toEqual([]);
        }
        expect(writes()).toEqual([]);
    });

    test("refuses, writing nothing, a plan that is not upcoming any more: a dialog opened Sunday, confirmed Monday", async () => {
        const fetchMock = stubFetchRoutes({ ...readRoutes(), [urls.upcoming(ST)]: listPage([later]) });
        await expect(addSongToPlan(ST, PLAN, SONG)).resolves.toEqual({
            ok: false,
            reason: "not-upcoming",
            message:
                "That plan of Sunday Morning is not an upcoming plan any more, so nothing was added. Choose one of the plans ahead.",
        });
        expect(writesSent(fetchMock)).toEqual([]);
        expect(writes()).toEqual([]);
    });

    test("refuses a plan of another service type: only that type's upcoming plans count", async () => {
        const fetchMock = stubFetchRoutes({
            ...readRoutes(),
            [urls.serviceType(EVENING)]: { data: serviceTypeResource({ name: "Sunday Evening" }, EVENING) },
            [urls.upcoming(EVENING)]: listPage([planResource({ id: "201" })]),
        });
        await expect(addSongToPlan(EVENING, PLAN, SONG)).resolves.toMatchObject({
            ok: false,
            reason: "not-upcoming",
        });
        expect(writesSent(fetchMock)).toEqual([]);
    });

    test("refuses, writing nothing, a plan of an archived service type", async () => {
        const fetchMock = stubFetchRoutes({
            ...readRoutes(),
            [urls.serviceType()]: {
                data: serviceTypeResource({ name: "Old Service", archived_at: "2026-01-01T00:00:00Z" }, ST),
            },
        });
        await expect(addSongToPlan(ST, PLAN, SONG)).resolves.toEqual({
            ok: false,
            reason: "not-upcoming",
            message: "Old Service is archived in Planning Center, so nothing was added to its plans.",
        });
        expect(writesSent(fetchMock)).toEqual([]);
    });

    test("reads the upcoming plans afresh for every add, not from an earlier read", async () => {
        const fetchMock = stubFetchRoutes({
            ...readRoutes(),
            [`POST ${urls.items()}`]: () => json({ data: added }, { status: 201 }),
        });
        await addSongToPlan(ST, PLAN, SONG);
        await addSongToPlan(ST, PLAN, SONG);
        expect(calledRequests(fetchMock).filter(({ url }) => url === urls.upcoming(ST))).toHaveLength(2);
    });

    test("refuses a song whose every arrangement is archived", async () => {
        const fetchMock = stubFetchRoutes({
            ...readRoutes(),
            [urls.arrangements()]: listPage([arrangementResource("5001", { archived_at: "2024-01-01T00:00:00Z" })]),
        });
        await expect(addSongToPlan(ST, PLAN, SONG)).resolves.toEqual({
            ok: false,
            reason: "no-arrangement",
            message: '"O God, Our Help" has no arrangement in Planning Center to put in a plan.',
        });
        expect(writesSent(fetchMock)).toEqual([]);
    });

    test("gives Planning Center's refusal as a value, and logs it", async () => {
        stubFetchRoutes({ ...readRoutes(), [`POST ${urls.items()}`]: () => VALIDATION_ERROR("must exist", "arrangement") });
        await expect(addSongToPlan(ST, PLAN, SONG)).resolves.toEqual({
            ok: false,
            reason: "refused",
            message: 'Planning Center refused "O God, Our Help" in the plan for October 11, 2026: arrangement: must exist',
            details: ["arrangement: must exist"],
        });
        expect(writes()).toMatchObject([{ kind: "item", target: `plan ${PLAN}`, ok: false }]);
        expect(findPcoSong(db, SONG)).toBeNull();
    });

    test("throws when Planning Center fails, after logging the failed write", async () => {
        stubFetchRoutes({ ...readRoutes(), [`POST ${urls.items()}`]: () => json({ errors: [] }, { status: 500 }) });
        await expect(addSongToPlan(ST, PLAN, SONG)).rejects.toMatchObject({ status: 500 });
        expect(writes()).toMatchObject([{ kind: "item", ok: false, result: { status: 500 } }]);
    });

    test("an item added is ok even when the mirror cannot be written afterwards", async () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        stubFetchRoutes({
            ...readRoutes(),
            [`POST ${urls.items()}`]: () => {
                db.exec("DROP TABLE pco_song_credits");
                return json({ data: added }, { status: 201 });
            },
        });
        await expect(addSongToPlan(ST, PLAN, SONG)).resolves.toMatchObject({ ok: true, item: { id: "950" } });
        expect(consoleError).toHaveBeenCalledWith(
            `Added song ${SONG} to plan ${PLAN}, but could not mirror it:`,
            expect.any(Error)
        );
    });
});

describe("saveSongTags", () => {
    const tagsUrl = `${PCO_BASE}/songs/${SONG}/tags?per_page=100`;
    const assignUrl = `${PCO_BASE}/songs/${SONG}/assign_tags`;

    /** The mirror: "Type" (several may be chosen) and "Season" (one), and Amazing Grace tagged Hymn. */
    function seedTags() {
        seedPcoSong(db, { id: SONG, title: "Amazing Grace" });
        const type = seedPcoTagGroup(db, { id: "7", name: "Type" });
        const season = seedPcoTagGroup(db, { id: "8", name: "Season", allowMultiple: false });
        const speed = seedPcoTagGroup(db, { id: "9", name: "Speed", tagsFor: "arrangement" });
        seedPcoTag(db, { id: "71", groupId: type, name: "Hymn" });
        seedPcoTag(db, { id: "72", groupId: type, name: "Chorus" });
        seedPcoTag(db, { id: "81", groupId: season, name: "Advent" });
        seedPcoTag(db, { id: "82", groupId: season, name: "Lent" });
        seedPcoTag(db, { id: "91", groupId: speed, name: "Fast" });
        seedPcoSongTag(db, SONG, "71");
    }

    /** Planning Center answers that the song has `tags` now, and takes an assignment. */
    function stubTags(...tags: ReturnType<typeof tagResource>[]) {
        return stubFetchRoutes({
            [tagsUrl]: listPage(tags),
            [`POST ${assignUrl}`]: () => new Response(null, { status: 204 }),
        });
    }

    /** The tag ids an assignment sent. */
    function assigned(fetchMock: ReturnType<typeof stubFetchRoutes>): string[][] {
        return writesSent(fetchMock).map(
            ({ body }) =>
                (body as { data: { relationships: { tags: { data: { id: string }[] } } } }).data.relationships.tags.data.map(
                    ({ id }) => id
                )
        );
    }

    const HYMN = tagResource("71", { name: "Hymn" }, "7");
    const CHORUS = tagResource("72", { name: "Chorus" }, "7");
    const ADVENT = tagResource("81", { name: "Advent" }, "8");

    test("applies the tags added and removed to the song's tags now, logs it with their names, and replaces the mirror's", async () => {
        seedTags();
        const fetchMock = stubTags(HYMN);

        // The editor showed Hymn; the person ticked Chorus and Advent and unticked Hymn.
        await expect(saveSongTags(SONG, ["71"], ["72", "81"], T0)).resolves.toEqual({
            ok: true,
            changed: true,
            tagIds: ["81", "72"],
            kept: [],
        });
        expect(writesSent(fetchMock)).toEqual([
            {
                method: "POST",
                url: assignUrl,
                body: {
                    data: {
                        type: "TagAssignment",
                        attributes: {},
                        relationships: {
                            tags: {
                                data: [
                                    { type: "Tag", id: "81" },
                                    { type: "Tag", id: "72" },
                                ],
                            },
                        },
                    },
                },
            },
        ]);
        expect(writes()).toEqual([
            {
                kind: "tags",
                target: `song ${SONG}`,
                ok: true,
                payload: {
                    action: "assign",
                    title: "Amazing Grace",
                    tags: [
                        { id: "81", name: "Advent" },
                        { id: "72", name: "Chorus" },
                    ],
                    previous: [{ id: "71", name: "Hymn" }],
                    added: [
                        { id: "72", name: "Chorus" },
                        { id: "81", name: "Advent" },
                    ],
                    removed: [{ id: "71", name: "Hymn" }],
                },
                result: { tagIds: ["81", "72"] },
            },
        ]);
        expect(findSongTags(db, SONG).map(({ id }) => id)).toEqual(["81", "72"]);
    });

    test("keeps a tag set in Planning Center since the page loaded, which the person never saw", async () => {
        seedTags();
        // The mirror, an hour old, says the song has no tags; Planning Center says Hymn.
        db.prepare("DELETE FROM pco_song_tags").run();
        const fetchMock = stubTags(HYMN);

        await expect(saveSongTags(SONG, [], ["72"], T0)).resolves.toMatchObject({
            ok: true,
            changed: true,
            tagIds: ["72", "71"],
        });
        expect(assigned(fetchMock)).toEqual([["72", "71"]]);
        expect(writes()[0].payload).toMatchObject({
            previous: [{ id: "71", name: "Hymn" }],
            added: [{ id: "72", name: "Chorus" }],
            removed: [],
        });
    });

    test("never puts back a tag removed in Planning Center since the page loaded", async () => {
        seedTags();
        // The editor showed Hymn, kept ticked; Planning Center has dropped it since.
        const fetchMock = stubTags();

        await expect(saveSongTags(SONG, ["71"], ["71", "72"], T0)).resolves.toMatchObject({
            ok: true,
            changed: true,
            tagIds: ["72"],
        });
        expect(assigned(fetchMock)).toEqual([["72"]]);
        expect(findSongTags(db, SONG).map(({ id }) => id)).toEqual(["72"]);
    });

    test("keeps a tag the song has that the mirror does not know yet", async () => {
        seedTags();
        const fetchMock = stubTags(HYMN, tagResource("73", { name: "New" }, "7"));

        await expect(saveSongTags(SONG, ["71"], ["72"], T0)).resolves.toEqual({
            ok: true,
            changed: true,
            tagIds: ["72", "73"],
            kept: [{ id: "73", name: "New", groupId: "7" }],
        });
        expect(assigned(fetchMock)).toEqual([["72", "73"]]);
        // The mirror cannot hold a tag it does not have; the next tags sync brings it.
        expect(findSongTags(db, SONG).map(({ id }) => id)).toEqual(["72"]);
    });

    test("removing every tag shown clears them, keeping only what the person did not see", async () => {
        seedTags();
        let fetchMock = stubTags(HYMN);
        await expect(saveSongTags(SONG, ["71"], [])).resolves.toMatchObject({ ok: true, changed: true, tagIds: [] });
        expect(writesSent(fetchMock)[0].body).toMatchObject({
            data: { relationships: { tags: { data: [] } } },
        });
        expect(findSongTags(db, SONG)).toEqual([]);

        fetchMock = stubTags(HYMN, ADVENT);
        await expect(saveSongTags(SONG, ["71"], [])).resolves.toMatchObject({ tagIds: ["81"] });
        expect(assigned(fetchMock)).toEqual([["81"]]);
    });

    test("sends nothing when the song's tags already have the changes, and refreshes the mirror", async () => {
        seedTags();
        // Someone else ticked Chorus in Planning Center too.
        const fetchMock = stubTags(CHORUS, HYMN);
        await expect(saveSongTags(SONG, ["71"], ["71", "72"])).resolves.toEqual({
            ok: true,
            changed: false,
            tagIds: ["72", "71"],
            kept: [],
        });
        expect(writesSent(fetchMock)).toEqual([]);
        expect(writes()).toEqual([]);
        expect(findSongTags(db, SONG).map(({ id }) => id)).toEqual(["72", "71"]);

        // Nothing changed in the editor: nothing is sent either.
        stubTags(ADVENT);
        await expect(saveSongTags(SONG, ["71"], ["71"])).resolves.toMatchObject({ changed: false, tagIds: ["81"] });
        expect(findSongTags(db, SONG).map(({ id }) => id)).toEqual(["81"]);
    });

    test("refuses, sending nothing, a tag added that is not a mirrored song tag, or two of a group that takes one", async () => {
        seedTags();
        const fetchMock = stubFetchRoutes({});
        const unknown = {
            ok: false,
            reason: "invalid",
            message:
                "One of the tags chosen is not a song tag in Planning Center any more. Sync the tags and choose again.",
        };
        await expect(saveSongTags(SONG, ["71"], ["71", "99"])).resolves.toEqual(unknown);
        await expect(saveSongTags(SONG, [], ["91"])).resolves.toEqual(unknown);
        await expect(saveSongTags(SONG, [], ["x"])).resolves.toEqual(unknown);
        await expect(saveSongTags(SONG, [], ["81", "82"])).resolves.toEqual({
            ok: false,
            reason: "invalid",
            message: 'Choose one tag at most of "Season".',
        });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    test("refuses, sending nothing, a choice in a group that takes one when the song has another of its tags now", async () => {
        seedTags();
        // The editor showed no season; Advent was set in Planning Center since, and the person picks Lent.
        const fetchMock = stubTags(HYMN, ADVENT);
        await expect(saveSongTags(SONG, ["71"], ["71", "82"])).resolves.toEqual({
            ok: false,
            reason: "changed",
            message:
                '"Season" takes one tag, and "Amazing Grace" has another of its tags in Planning Center now, set since this page loaded, so nothing was saved. Reload the page and choose again.',
        });
        expect(writesSent(fetchMock)).toEqual([]);
        expect(writes()).toEqual([]);

        // Changing the season the editor showed is a change the person made.
        const changed = stubTags(HYMN, ADVENT);
        await expect(saveSongTags(SONG, ["71", "81"], ["71", "82"])).resolves.toMatchObject({
            ok: true,
            tagIds: ["82", "71"],
        });
        expect(assigned(changed)).toEqual([["82", "71"]]);
    });

    test("removing a tag the mirror no longer knows is allowed; it only ever takes it off", async () => {
        seedTags();
        const fetchMock = stubTags(HYMN, tagResource("99", { name: "Gone" }, "7"));
        await expect(saveSongTags(SONG, ["71", "99"], ["71"])).resolves.toMatchObject({
            ok: true,
            changed: true,
            tagIds: ["71"],
            kept: [],
        });
        expect(assigned(fetchMock)).toEqual([["71"]]);
    });

    test("refuses a song that is not one, that the mirror lacks, or that Planning Center does not have", async () => {
        seedTags();
        let fetchMock = stubFetchRoutes({});
        await expect(saveSongTags("x", [], ["71"])).resolves.toMatchObject({ ok: false, reason: "not-found" });
        await expect(saveSongTags("2002", [], ["71"])).resolves.toEqual({
            ok: false,
            reason: "not-found",
            message: "There is no such Planning Center song.",
        });
        expect(fetchMock).not.toHaveBeenCalled();

        fetchMock = stubFetchRoutes({ [tagsUrl]: () => json({ errors: [] }, { status: 404 }) });
        await expect(saveSongTags(SONG, [], ["71"])).resolves.toMatchObject({ ok: false, reason: "not-found" });
        expect(writesSent(fetchMock)).toEqual([]);
    });

    test("gives Planning Center's refusal as a value and logs it; throws on a failure, after logging it", async () => {
        seedTags();
        stubFetchRoutes({
            [tagsUrl]: listPage([]),
            [`POST ${assignUrl}`]: () => VALIDATION_ERROR("is invalid", "tags"),
        });
        await expect(saveSongTags(SONG, [], ["71"])).resolves.toEqual({
            ok: false,
            reason: "refused",
            message: 'Planning Center refused the tags of "Amazing Grace": tags: is invalid',
            details: ["tags: is invalid"],
        });
        expect(findSongTags(db, SONG).map(({ id }) => id)).toEqual(["71"]);

        stubFetchRoutes({
            [tagsUrl]: listPage([]),
            [`POST ${assignUrl}`]: () => json({ errors: [] }, { status: 500 }),
        });
        await expect(saveSongTags(SONG, [], ["71"])).rejects.toMatchObject({ status: 500 });
        expect(writes().map(({ kind, ok }) => [kind, ok])).toEqual([
            ["tags", false],
            ["tags", false],
        ]);
    });
});
