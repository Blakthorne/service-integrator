import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fetchAllSongs } from "./songs";
import {
    PCO_AUTH,
    PCO_BASE,
    calledUrls,
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
});
