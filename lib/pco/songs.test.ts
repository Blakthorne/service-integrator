import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { InvalidPcoIdError } from "./ids";
import { toPcoLibrarySong } from "./mappers";
import { fetchSong, fetchSongLibrary, getSong, getSongArrangements } from "./songs";
import {
    PCO_AUTH,
    PCO_BASE,
    arrangementResource,
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

describe("fetchSong", () => {
    test("reads one song afresh with every field the mirror keeps, unpaced", async () => {
        const acquire = vi.spyOn(stubPcoPacer(), "acquire");
        const song = songResource("1001", { title: "Amazing Grace" });
        const fetchMock = stubFetchRoutes({ [`${PCO_BASE}/songs/1001`]: { data: song } });

        await expect(fetchSong("1001")).resolves.toEqual(toPcoLibrarySong(song));
        await fetchSong("1001");
        expect(calledUrls(fetchMock)).toEqual([`${PCO_BASE}/songs/1001`, `${PCO_BASE}/songs/1001`]);
        expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: "no-store" });
        expect(acquire).not.toHaveBeenCalled();
    });

    test("refuses an id that is not a Planning Center id before fetching", async () => {
        const fetchMock = stubFetchRoutes({});
        await expect(fetchSong("1001?x=1")).rejects.toBeInstanceOf(InvalidPcoIdError);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe("getSongArrangements", () => {
    const ARRANGEMENTS = `${PCO_BASE}/songs/1001/arrangements?per_page=100`;

    test("reads a song's arrangements in Planning Center's order, archived ones included, unpaced", async () => {
        const acquire = vi.spyOn(stubPcoPacer(), "acquire");
        const fetchMock = stubFetchRoutes({
            [ARRANGEMENTS]: listPage([
                arrangementResource("5001"),
                arrangementResource("5002", {
                    name: "Choir",
                    archived_at: "2024-01-01T00:00:00Z",
                    created_at: "2020-05-01T00:00:00Z",
                }),
            ]),
        });

        await expect(getSongArrangements("1001")).resolves.toEqual([
            { id: "5001", name: "Default Arrangement", archived: false, createdAt: "2019-01-01T00:00:00Z" },
            { id: "5002", name: "Choir", archived: true, createdAt: "2020-05-01T00:00:00Z" },
        ]);
        expect(calledUrls(fetchMock)).toEqual([ARRANGEMENTS]);
        expect(fetchMock.mock.calls[0][1]).toMatchObject({
            cache: "no-store",
            headers: { Authorization: PCO_AUTH },
        });
        expect(acquire).not.toHaveBeenCalled();
    });

    test("refuses an id that is not a Planning Center id before fetching", async () => {
        const fetchMock = stubFetchRoutes({});
        await expect(getSongArrangements("abc")).rejects.toBeInstanceOf(InvalidPcoIdError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    test("lets a missing song's 404 through", async () => {
        stubFetchRoutes({ [ARRANGEMENTS]: () => json({ errors: [] }, { status: 404 }) });
        await expect(getSongArrangements("1001")).rejects.toMatchObject({ name: "PcoError", status: 404 });
    });
});
