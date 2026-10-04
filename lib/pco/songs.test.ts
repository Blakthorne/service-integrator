import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { InvalidPcoIdError } from "./ids";
import { toPcoLibrarySong } from "./mappers";
import { fetchAllSongs, fetchSongLibrary, getSong } from "./songs";
import {
    PCO_AUTH,
    PCO_BASE,
    calledUrls,
    json,
    listPage,
    songResource,
    stubFetchRoutes,
    stubPcoCredentials,
    stubPcoPacer,
} from "./testing";

beforeEach(stubPcoCredentials);

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

describe("fetchAllSongs", () => {
    test("pages through /songs 100 at a time with auth and no-store", async () => {
        const fetchMock = stubFetchRoutes({
            [`${PCO_BASE}/songs?per_page=100`]: listPage(
                [songResource("1", { title: "Amazing Grace" })],
                { next: `${PCO_BASE}/songs?offset=100&per_page=100` }
            ),
            [`${PCO_BASE}/songs?offset=100&per_page=100`]: listPage([
                songResource("2", { title: "Never Sung", last_scheduled_at: null }),
            ]),
        });

        await expect(fetchAllSongs()).resolves.toEqual([
            { title: "Amazing Grace", lastScheduledAt: "2026-09-27T08:00:00Z" },
            { title: "Never Sung", lastScheduledAt: null },
        ]);
        expect(calledUrls(fetchMock)).toEqual([
            `${PCO_BASE}/songs?per_page=100`,
            `${PCO_BASE}/songs?offset=100&per_page=100`,
        ]);
        for (const [, init] of fetchMock.mock.calls) {
            expect(init).toMatchObject({
                cache: "no-store",
                headers: { Authorization: PCO_AUTH },
            });
        }
    });

    test("reads up to 100 pages (10,000 songs) before giving up", async () => {
        const fetchMock = vi.fn().mockImplementation(async (url: string) => {
            const offset = Number(new URL(url).searchParams.get("offset") ?? 0);
            return json(
                listPage([songResource(String(offset + 1))], {
                    next: `${PCO_BASE}/songs?offset=${offset + 1}&per_page=100`,
                })
            );
        });
        vi.stubGlobal("fetch", fetchMock);

        await expect(fetchAllSongs()).rejects.toThrow(/more than 100 pages/);
        expect(fetchMock).toHaveBeenCalledTimes(100);
    });
});

describe("fetchSongLibrary", () => {
    const FIRST_PAGE = `${PCO_BASE}/songs?per_page=100`;
    const SECOND_PAGE = `${PCO_BASE}/songs?offset=100&per_page=100`;

    test("pages through /songs 100 at a time, paced, with every field the mirror keeps", async () => {
        const acquire = vi.spyOn(stubPcoPacer(), "acquire");
        const songs = [
            songResource("1001", { title: "Amazing Grace" }),
            songResource("1002", { title: "Never Sung", last_scheduled_at: null, hidden: true }),
        ];
        const fetchMock = stubFetchRoutes({
            [FIRST_PAGE]: listPage([songs[0]], { next: SECOND_PAGE, total: 2 }),
            [SECOND_PAGE]: listPage([songs[1]], { total: 2 }),
        });

        await expect(fetchSongLibrary()).resolves.toEqual(songs.map(toPcoLibrarySong));
        expect(calledUrls(fetchMock)).toEqual([FIRST_PAGE, SECOND_PAGE]);
        expect(acquire).toHaveBeenCalledTimes(2);
        for (const [, init] of fetchMock.mock.calls) {
            expect(init).toMatchObject({
                cache: "no-store",
                headers: { Authorization: PCO_AUTH },
            });
        }
    });

    test("gives a song sent twice once", async () => {
        stubPcoPacer();
        stubFetchRoutes({
            [FIRST_PAGE]: listPage([songResource("1001"), songResource("1002")], {
                next: SECOND_PAGE,
                total: 3,
            }),
            [SECOND_PAGE]: listPage([songResource("1002"), songResource("1003")], { total: 3 }),
        });
        await expect(fetchSongLibrary()).resolves.toMatchObject([
            { id: "1001" },
            { id: "1002" },
            { id: "1003" },
        ]);
    });

    test("throws rather than give part of the library when it got fewer songs than were listed", async () => {
        stubPcoPacer();
        stubFetchRoutes({
            [FIRST_PAGE]: listPage([songResource("1001")], { next: SECOND_PAGE, total: 3 }),
            [SECOND_PAGE]: listPage([songResource("1002")], { total: 3 }),
        });
        await expect(fetchSongLibrary()).rejects.toThrow(
            "Planning Center listed 3 songs but sent 2: the library changed while it was read"
        );
    });

    test("throws when a page fails", async () => {
        stubPcoPacer();
        stubFetchRoutes({
            [FIRST_PAGE]: listPage([songResource("1001")], { next: SECOND_PAGE, total: 2 }),
            [SECOND_PAGE]: () => json({ errors: [] }, { status: 500 }),
        });
        await expect(fetchSongLibrary()).rejects.toMatchObject({
            name: "PcoError",
            status: 500,
        });
    });

    test("gives an empty library as empty", async () => {
        stubPcoPacer();
        stubFetchRoutes({ [FIRST_PAGE]: listPage([]) });
        await expect(fetchSongLibrary()).resolves.toEqual([]);
    });
});

describe("getSong", () => {
    test("reads one song with every field the mirror keeps, unpaced", async () => {
        const acquire = vi.spyOn(stubPcoPacer(), "acquire");
        const song = songResource("1001", { title: "Amazing Grace" });
        const fetchMock = stubFetchRoutes({ [`${PCO_BASE}/songs/1001`]: { data: song } });

        await expect(getSong("1001")).resolves.toEqual(toPcoLibrarySong(song));
        expect(calledUrls(fetchMock)).toEqual([`${PCO_BASE}/songs/1001`]);
        expect(fetchMock.mock.calls[0][1]).toMatchObject({
            cache: "no-store",
            headers: { Authorization: PCO_AUTH },
        });
        expect(acquire).not.toHaveBeenCalled();
    });

    test("refuses an id that is not a Planning Center id before fetching", async () => {
        const fetchMock = stubFetchRoutes({});
        await expect(getSong("../people/1")).rejects.toBeInstanceOf(InvalidPcoIdError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    test("lets a missing song's 404 through", async () => {
        stubFetchRoutes({
            [`${PCO_BASE}/songs/404`]: () => json({ errors: [] }, { status: 404 }),
        });
        await expect(getSong("404")).rejects.toMatchObject({ name: "PcoError", status: 404 });
    });
});
