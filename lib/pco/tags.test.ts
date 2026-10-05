import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { InvalidPcoIdError } from "./ids";
import { fetchSongIdsWithTag, fetchSongTagGroups, fetchSongTags } from "./tags";
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
    tagGroupResource,
    tagResource,
} from "./testing";

beforeEach(stubPcoCredentials);

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

describe("fetchSongTagGroups", () => {
    const FIRST_PAGE = `${PCO_BASE}/tag_groups?include=tags&per_page=100`;
    const SECOND_PAGE = `${PCO_BASE}/tag_groups?include=tags&offset=100&per_page=100`;

    test("reads every page of tag groups with their tags, and keeps the song groups", async () => {
        const acquire = vi.spyOn(stubPcoPacer(), "acquire");
        const fetchMock = stubFetchRoutes({
            [FIRST_PAGE]: listPage(
                [
                    tagGroupResource("7", { name: "Type" }, ["71", "72"]),
                    tagGroupResource("8", { name: "Speed", tags_for: "arrangement" }, ["81"]),
                ],
                {
                    next: SECOND_PAGE,
                    included: [
                        tagResource("71", { name: "Hymn" }),
                        tagResource("72", { name: "Chorus" }),
                        tagResource("81", { name: "Fast" }),
                    ],
                    total: 3,
                }
            ),
            [SECOND_PAGE]: listPage(
                [tagGroupResource("9", { name: "Season", allow_multiple_selections: false }, ["91"])],
                { included: [tagResource("91", { name: "Advent" })], total: 3 }
            ),
        });

        await expect(fetchSongTagGroups()).resolves.toEqual([
            {
                id: "7",
                name: "Type",
                tagsFor: "song",
                allowMultiple: true,
                tags: [
                    { id: "72", groupId: "7", name: "Chorus" },
                    { id: "71", groupId: "7", name: "Hymn" },
                ],
            },
            {
                id: "9",
                name: "Season",
                tagsFor: "song",
                allowMultiple: false,
                tags: [{ id: "91", groupId: "9", name: "Advent" }],
            },
        ]);
        expect(calledUrls(fetchMock)).toEqual([FIRST_PAGE, SECOND_PAGE]);
        expect(fetchMock.mock.calls[0][1]).toMatchObject({
            cache: "no-store",
            headers: { Authorization: PCO_AUTH },
        });
        expect(acquire).not.toHaveBeenCalled();
    });

    test("waits its turn at the pacer before each page when paced", async () => {
        const acquire = vi.spyOn(stubPcoPacer(), "acquire");
        stubFetchRoutes({
            [FIRST_PAGE]: listPage([tagGroupResource("7")], { next: SECOND_PAGE, total: 2 }),
            [SECOND_PAGE]: listPage([tagGroupResource("8")], { total: 2 }),
        });
        await fetchSongTagGroups({ paced: true });
        expect(acquire).toHaveBeenCalledTimes(2);
    });

    test("lets a failure through", async () => {
        stubPcoPacer();
        stubFetchRoutes({ [FIRST_PAGE]: () => json({ errors: [] }, { status: 500 }) });
        await expect(fetchSongTagGroups()).rejects.toMatchObject({ name: "PcoError", status: 500 });
    });
});

describe("fetchSongIdsWithTag", () => {
    const FIRST_PAGE = `${PCO_BASE}/songs?where[song_tag_ids]=71&per_page=100`;
    const SECOND_PAGE = `${PCO_BASE}/songs?offset=100&per_page=100&where[song_tag_ids]=71`;

    test("follows every page of the songs with the tag, and gives their ids, each once", async () => {
        stubPcoPacer();
        const fetchMock = stubFetchRoutes({
            [FIRST_PAGE]: listPage([songResource("1001"), songResource("1002")], {
                next: SECOND_PAGE,
                total: 3,
            }),
            [SECOND_PAGE]: listPage([songResource("1002"), songResource("1003")], { total: 3 }),
        });

        await expect(fetchSongIdsWithTag("71")).resolves.toEqual(["1001", "1002", "1003"]);
        expect(calledUrls(fetchMock)).toEqual([FIRST_PAGE, SECOND_PAGE]);
    });

    test("waits its turn at the pacer before each page when paced, and not otherwise", async () => {
        const acquire = vi.spyOn(stubPcoPacer(), "acquire");
        const routes = {
            [FIRST_PAGE]: listPage([songResource("1001")], { next: SECOND_PAGE, total: 2 }),
            [SECOND_PAGE]: listPage([songResource("1002")], { total: 2 }),
        };
        stubFetchRoutes(routes);
        await fetchSongIdsWithTag("71", { paced: true });
        expect(acquire).toHaveBeenCalledTimes(2);

        acquire.mockClear();
        stubFetchRoutes(routes);
        await fetchSongIdsWithTag("71");
        expect(acquire).not.toHaveBeenCalled();
    });

    test("gives none for a tag no song has", async () => {
        stubPcoPacer();
        stubFetchRoutes({ [FIRST_PAGE]: listPage([]) });
        await expect(fetchSongIdsWithTag("71")).resolves.toEqual([]);
    });

    test("throws rather than give part of the list when it got fewer songs than were listed", async () => {
        stubPcoPacer();
        stubFetchRoutes({
            [FIRST_PAGE]: listPage([songResource("1001")], { next: SECOND_PAGE, total: 3 }),
            [SECOND_PAGE]: listPage([songResource("1002")], { total: 3 }),
        });
        await expect(fetchSongIdsWithTag("71")).rejects.toThrow(
            "Planning Center listed 3 songs with tag 71 but sent 2: the songs changed while they were read"
        );
    });

    test("refuses an id that is not a Planning Center id before fetching", async () => {
        const fetchMock = stubFetchRoutes({});
        for (const id of ["", "x", "71&where[x]=1", "../1"]) {
            await expect(fetchSongIdsWithTag(id)).rejects.toBeInstanceOf(InvalidPcoIdError);
        }
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe("fetchSongTags", () => {
    const TAGS = `${PCO_BASE}/songs/1001/tags?per_page=100`;

    test("reads a song's tags afresh, unpaced, each with its group when Planning Center names it", async () => {
        const acquire = vi.spyOn(stubPcoPacer(), "acquire");
        const fetchMock = stubFetchRoutes({
            [TAGS]: listPage([tagResource("71", { name: "Hymn" }, "7"), tagResource("72", { name: "Chorus" })]),
        });

        await expect(fetchSongTags("1001")).resolves.toEqual([
            { id: "71", name: "Hymn", groupId: "7" },
            { id: "72", name: "Chorus", groupId: null },
        ]);
        expect(calledUrls(fetchMock)).toEqual([TAGS]);
        expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: "no-store" });
        expect(acquire).not.toHaveBeenCalled();
    });

    test("refuses an id that is not a Planning Center id before fetching", async () => {
        const fetchMock = stubFetchRoutes({});
        await expect(fetchSongTags("1001/../2")).rejects.toBeInstanceOf(InvalidPcoIdError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    test("lets a missing song's 404 through", async () => {
        stubPcoPacer();
        stubFetchRoutes({ [TAGS]: () => json({ errors: [] }, { status: 404 }) });
        await expect(fetchSongTags("1001")).rejects.toMatchObject({ name: "PcoError", status: 404 });
    });
});
