import { afterEach, describe, expect, test, vi } from "vitest";
import { pcoPacer } from "./pacer";
import {
    PCO_BASE,
    calledRequests,
    calledUrls,
    json,
    stubFetchRoutes,
    stubPcoPacer,
} from "./testing";

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

const SONGS = `${PCO_BASE}/songs`;
const SONG = `${PCO_BASE}/songs/1`;

describe("stubFetchRoutes", () => {
    test("a bare URL key answers GET, with a fresh response each call", async () => {
        stubFetchRoutes({ [SONGS]: { data: [] } });

        for (const init of [undefined, { method: "GET" }]) {
            const response = await fetch(SONGS, init);
            expect(response.status).toBe(200);
            await expect(response.json()).resolves.toEqual({ data: [] });
        }
    });

    test("a bare URL key answers no other method", async () => {
        stubFetchRoutes({ [SONGS]: { data: [] } });
        await expect(fetch(SONGS, { method: "POST", body: "{}" })).rejects.toThrow(
            `Unexpected fetch: POST ${SONGS}`
        );
    });

    test('"METHOD url" keys route each method of one URL on its own', async () => {
        stubFetchRoutes({
            [`GET ${SONG}`]: { data: { id: "1" } },
            [`PATCH ${SONG}`]: { data: { id: "1", patched: true } },
            [`DELETE ${SONG}`]: () => new Response(null, { status: 204 }),
        });

        await expect((await fetch(SONG)).json()).resolves.toEqual({ data: { id: "1" } });
        await expect((await fetch(SONG, { method: "PATCH" })).json()).resolves.toEqual({
            data: { id: "1", patched: true },
        });
        expect((await fetch(SONG, { method: "DELETE" })).status).toBe(204);
    });

    test("matches the method as sent, so a lowercase patch is unexpected", async () => {
        stubFetchRoutes({ [`PATCH ${SONG}`]: { data: {} } });
        await expect(fetch(SONG, { method: "patch" })).rejects.toThrow(
            `Unexpected fetch: patch ${SONG}`
        );
    });

    test("a route function receives the request init", async () => {
        const route = vi.fn(() => json({ data: { id: "2" } }, { status: 201 }));
        stubFetchRoutes({ [`POST ${SONGS}`]: route });
        const init = { method: "POST", body: JSON.stringify({ data: { type: "Song" } }) };

        const response = await fetch(SONGS, init);

        expect(response.status).toBe(201);
        expect(route).toHaveBeenCalledWith(init);
    });

    test("a URL missing from the table fails", async () => {
        stubFetchRoutes({});
        await expect(fetch(SONGS)).rejects.toThrow(`Unexpected fetch: GET ${SONGS}`);
    });
});

describe("calledRequests", () => {
    test("lists each call's method, URL and JSON body, in order", async () => {
        const fetchMock = stubFetchRoutes({
            [SONGS]: { data: [] },
            [`POST ${SONGS}`]: { data: {} },
            [`DELETE ${SONG}`]: () => new Response(null, { status: 204 }),
        });
        const created = { data: { type: "Song", attributes: { title: "Amazing Grace" } } };

        await fetch(SONGS);
        await fetch(SONGS, { method: "POST", body: JSON.stringify(created) });
        await fetch(SONG, { method: "DELETE" });

        expect(calledRequests(fetchMock)).toEqual([
            { method: "GET", url: SONGS, body: undefined },
            { method: "POST", url: SONGS, body: created },
            { method: "DELETE", url: SONG, body: undefined },
        ]);
        // calledUrls still lists the URLs alone.
        expect(calledUrls(fetchMock)).toEqual([SONGS, SONGS, SONG]);
    });
});

describe("stubPcoPacer", () => {
    test("puts a pacer in the shared one's place until unstubAllGlobals", () => {
        const shared = pcoPacer();
        const stub = stubPcoPacer();
        expect(stub).not.toBe(shared);
        expect(pcoPacer()).toBe(stub);

        vi.unstubAllGlobals();
        expect(pcoPacer()).toBe(shared);
    });

    test("its default pacer runs on the fake clock", async () => {
        vi.useFakeTimers();
        const pacer = stubPcoPacer();
        pacer.pause(1000);
        let granted = false;
        void pacer.acquire().then(() => {
            granted = true;
        });

        await vi.advanceTimersByTimeAsync(999);
        expect(granted).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(granted).toBe(true);
    });
});
