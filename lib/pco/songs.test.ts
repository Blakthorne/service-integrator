import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fetchAllSongs } from "./songs";
import {
    PCO_AUTH,
    PCO_BASE,
    calledUrls,
    json,
    listPage,
    songResource,
    stubFetchRoutes,
    stubPcoCredentials,
} from "./testing";

beforeEach(stubPcoCredentials);

afterEach(() => {
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
