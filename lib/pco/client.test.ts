import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { PcoError, PcoUrlError, pcoFetch, pcoFetchAll } from "./client";

const BASE = "https://api.planningcenteronline.com/services/v2";
const AUTH = `Basic ${Buffer.from("id:tok").toString("base64")}`;

/** A fresh JSON response; a body can only be read once, so never reuse one. */
function json(body: unknown, init: ResponseInit = {}): Response {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
        ...init,
    });
}

function tooManyRequests(retryAfter?: string): Response {
    return json(
        { errors: [{ code: "429" }] },
        {
            status: 429,
            headers: retryAfter === undefined ? {} : { "Retry-After": retryAfter },
        }
    );
}

/** One page of a list endpoint, linking to `next` when given. */
function page(
    data: unknown[],
    { next, included, total }: { next?: string; included?: unknown[]; total?: number } = {}
) {
    return {
        data,
        included: included ?? [],
        links: next ? { self: "ignored", next } : { self: "ignored" },
        meta: { total_count: total ?? data.length, count: data.length },
    };
}

/** Stub fetch with a handler that builds a fresh Response for each call. */
function stubFetch(handler: (url: string, call: number) => Response) {
    let call = 0;
    const fetchMock = vi
        .fn()
        .mockImplementation(async (input: string) => handler(input, call++));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
}

const calledUrls = (fetchMock: ReturnType<typeof vi.fn>): string[] =>
    fetchMock.mock.calls.map(([url]) => String(url));

beforeEach(() => {
    vi.stubEnv("PLANNING_CENTER_ID", "id");
    vi.stubEnv("PLANNING_CENTER_TOKEN", "tok");
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

describe("pcoFetch", () => {
    test("requests the Services API path with Basic auth and no-store", async () => {
        const body = { data: { type: "ServiceType", id: "1" } };
        const fetchMock = stubFetch(() => json(body));

        await expect(pcoFetch("/service_types/1", "serviceTypes")).resolves.toEqual(
            body
        );

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledWith(
            `${BASE}/service_types/1`,
            expect.objectContaining({
                cache: "no-store",
                headers: expect.objectContaining({ Authorization: AUTH }),
            })
        );
    });

    test("keeps the query string as given", async () => {
        const fetchMock = stubFetch(() => json({ data: {} }));
        await pcoFetch("/service_types/1/plans?order=-sort_date&per_page=100", "plans");
        expect(calledUrls(fetchMock)).toEqual([
            `${BASE}/service_types/1/plans?order=-sort_date&per_page=100`,
        ]);
    });

    test("throws a PcoError with the status and path on a non-ok response", async () => {
        stubFetch(() => json({ errors: [] }, { status: 404 }));

        const error = await pcoFetch("/service_types/1/plans/2", "plans").catch(
            (e: unknown) => e
        );

        expect(error).toBeInstanceOf(PcoError);
        expect(error).toMatchObject({
            status: 404,
            path: "/services/v2/service_types/1/plans/2",
        });
        expect((error as Error).message).toContain("status: 404");
    });

    test("throws before fetching when credentials are missing", async () => {
        vi.stubEnv("PLANNING_CENTER_TOKEN", "");
        const fetchMock = stubFetch(() => json({ data: {} }));
        await expect(pcoFetch("/service_types", "serviceTypes")).rejects.toThrow(
            "Planning Center credentials not configured"
        );
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe("redirects", () => {
    // fetch follows redirects by default, re-sending the Authorization header
    // to wherever PCO points, which would bypass the URL guard.
    test("every request refuses redirects: first page, next page and a 429 retry", async () => {
        vi.useFakeTimers();
        const fetchMock = stubFetch((_url, call) => {
            if (call === 0) return json(page([{ id: "1" }], { next: `${BASE}/songs?offset=1` }));
            if (call === 1) return tooManyRequests("1");
            return json(page([{ id: "2" }]));
        });

        const result = pcoFetchAll("/songs", "songs");
        await vi.advanceTimersByTimeAsync(1000);
        await expect(result).resolves.toMatchObject({ data: [{ id: "1" }, { id: "2" }] });

        expect(fetchMock).toHaveBeenCalledTimes(3);
        for (const [, init] of fetchMock.mock.calls) {
            expect(init).toMatchObject({ redirect: "error", cache: "no-store" });
        }
    });

    test("a fetch that rejects, as it does on a redirect, surfaces as an error without a retry", async () => {
        const failure = new TypeError("fetch failed");
        const fetchMock = vi.fn().mockRejectedValue(failure);
        vi.stubGlobal("fetch", fetchMock);

        await expect(pcoFetch("/service_types/1", "serviceTypes")).rejects.toBe(failure);
        await expect(pcoFetchAll("/songs", "songs")).rejects.toBe(failure);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});

describe("URL guard", () => {
    test.each([
        // The attack from the plan: an unchecked ID climbing into another PCO API.
        "/service_types/../../../people/v2/people%3F/plans",
        "/service_types/%2e%2e/%2E%2E/%2e%2e/people/v2/people",
        "/../people/v2/people",
        "/service_types/..%2F..%2Fpeople",
        "/service_types/1 2",
        "service_types",
        "https://evil.example/services/v2/service_types",
    ])("rejects %j before any fetch", async (path) => {
        const fetchMock = stubFetch(() => json({ data: [] }));
        await expect(pcoFetch(path, "plans")).rejects.toBeInstanceOf(PcoUrlError);
        await expect(pcoFetchAll(path, "plans")).rejects.toBeInstanceOf(PcoUrlError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    test("allows a path that stays inside the Services API after normalizing", async () => {
        const fetchMock = stubFetch(() => json({ data: {} }));
        await pcoFetch("/service_types/1/../2", "serviceTypes");
        expect(calledUrls(fetchMock)).toEqual([`${BASE}/service_types/2`]);
    });

    test.each([
        "https://evil.example/services/v2/songs?offset=2",
        "http://api.planningcenteronline.com/services/v2/songs?offset=2",
        "https://api.planningcenteronline.com/people/v2/people",
        "https://api.planningcenteronline.com/services/v2/../../people/v2/people",
        "https://api.planningcenteronline.com.evil.example/services/v2/songs",
        "https://api.planningcenteronline.com:8443/services/v2/songs",
        "https://user:pass@api.planningcenteronline.com/services/v2/songs",
        "https://user@api.planningcenteronline.com/services/v2/songs",
        "https://:pass@api.planningcenteronline.com/services/v2/songs",
    ])("rejects a links.next of %j before following it", async (next) => {
        const fetchMock = stubFetch(() => json(page([{ id: "1" }], { next })));
        await expect(pcoFetchAll("/songs?per_page=1", "songs")).rejects.toBeInstanceOf(
            PcoUrlError
        );
        expect(calledUrls(fetchMock)).toEqual([`${BASE}/songs?per_page=1`]);
    });

    test("follows a links.next that differs only by normalization", async () => {
        const fetchMock = stubFetch((_url, call) =>
            call === 0
                ? json(
                      page([{ id: "1" }], {
                          next: "HTTPS://API.PlanningCenterOnline.com:443/services/v2/songs?offset=1",
                      })
                  )
                : json(page([{ id: "2" }]))
        );
        const { data } = await pcoFetchAll("/songs?per_page=1", "songs");
        expect(data).toEqual([{ id: "1" }, { id: "2" }]);
        expect(calledUrls(fetchMock)).toEqual([
            `${BASE}/songs?per_page=1`,
            `${BASE}/songs?offset=1`,
        ]);
    });
});

describe("pcoFetchAll", () => {
    test("merges three pages in order and dedupes included by type and id", async () => {
        const song = (id: string) => ({ type: "Song", id, attributes: { title: id } });
        const person = (id: string) => ({ type: "Person", id });
        const pages: Record<string, ReturnType<typeof page>> = {
            [`${BASE}/plans?per_page=2`]: page([{ id: "a" }, { id: "b" }], {
                next: `${BASE}/plans?offset=2&per_page=2`,
                included: [song("1"), song("2")],
                total: 5,
            }),
            [`${BASE}/plans?offset=2&per_page=2`]: page([{ id: "c" }], {
                next: `${BASE}/plans?offset=4&per_page=2`,
                // Song 2 again, plus a Person that shares its id.
                included: [song("2"), person("2")],
                total: 5,
            }),
            [`${BASE}/plans?offset=4&per_page=2`]: page([{ id: "d" }, { id: "a" }], {
                included: [song("1"), song("3")],
                // A row added while paging; totalCount stays the first page's.
                total: 6,
            }),
        };
        const fetchMock = stubFetch((url) => json(pages[url]));

        const result = await pcoFetchAll("/plans?per_page=2", "plans");

        expect(calledUrls(fetchMock)).toEqual(Object.keys(pages));
        // data is appended page by page, duplicates and all.
        expect(result.data).toEqual([
            { id: "a" },
            { id: "b" },
            { id: "c" },
            { id: "d" },
            { id: "a" },
        ]);
        // included keeps the first copy of each type+id, in first-seen order.
        expect(result.included).toEqual([song("1"), song("2"), person("2"), song("3")]);
        expect(result.totalCount).toBe(5);
        // Every page is fetched with the same auth and cache options.
        for (const [, init] of fetchMock.mock.calls) {
            expect(init).toMatchObject({
                cache: "no-store",
                headers: { Authorization: AUTH },
            });
        }
    });

    test("a single page without links or included works", async () => {
        stubFetch(() => json({ data: [{ id: "1" }], meta: { total_count: 1, count: 1 } }));
        await expect(pcoFetchAll("/service_types", "serviceTypes")).resolves.toEqual({
            data: [{ id: "1" }],
            included: [],
            totalCount: 1,
        });
    });

    test("totalCount falls back to the number of rows when meta is missing", async () => {
        stubFetch(() => json({ data: [{ id: "1" }, { id: "2" }] }));
        const { totalCount } = await pcoFetchAll("/songs", "songs");
        expect(totalCount).toBe(2);
    });

    test("fetches exactly maxPages pages when the last one has no next link", async () => {
        const fetchMock = stubFetch((_url, call) =>
            json(page([{ id: String(call) }], call < 1 ? { next: `${BASE}/songs?offset=${call + 1}` } : {}))
        );
        const { data } = await pcoFetchAll("/songs", "songs", { maxPages: 2 });
        expect(data).toHaveLength(2);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    test("throws instead of silently truncating when more than maxPages pages exist", async () => {
        const fetchMock = stubFetch((_url, call) =>
            json(page([{ id: String(call) }], { next: `${BASE}/songs?offset=${call + 1}` }))
        );
        await expect(pcoFetchAll("/songs", "songs", { maxPages: 2 })).rejects.toThrow(
            /more than 2 pages/
        );
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    test("maxPages defaults to 50", async () => {
        const fetchMock = stubFetch((_url, call) =>
            json(page([{ id: String(call) }], { next: `${BASE}/songs?offset=${call + 1}` }))
        );
        await expect(pcoFetchAll("/songs", "songs")).rejects.toThrow(/more than 50 pages/);
        expect(fetchMock).toHaveBeenCalledTimes(50);
    });

    test("a failing later page throws a PcoError for that page", async () => {
        stubFetch((_url, call) =>
            call === 0
                ? json(page([{ id: "1" }], { next: `${BASE}/songs?offset=1` }))
                : json({ errors: [] }, { status: 500 })
        );
        await expect(pcoFetchAll("/songs", "songs")).rejects.toMatchObject({
            name: "PcoError",
            status: 500,
            path: "/services/v2/songs?offset=1",
        });
    });
});

describe("rate limiting (429)", () => {
    test("retries once after Retry-After seconds when that is 5 or less", async () => {
        vi.useFakeTimers();
        const fetchMock = stubFetch((_url, call) =>
            call === 0 ? tooManyRequests("2") : json({ data: { id: "1" } })
        );

        const result = pcoFetch("/service_types/1", "serviceTypes");
        await vi.advanceTimersByTimeAsync(1999);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(fetchMock).toHaveBeenCalledTimes(2);

        await expect(result).resolves.toEqual({ data: { id: "1" } });
        expect(calledUrls(fetchMock)).toEqual([
            `${BASE}/service_types/1`,
            `${BASE}/service_types/1`,
        ]);
    });

    test("waits up to exactly 5 seconds", async () => {
        vi.useFakeTimers();
        const fetchMock = stubFetch((_url, call) =>
            call === 0 ? tooManyRequests("5") : json({ data: {} })
        );
        const result = pcoFetch("/service_types/1", "serviceTypes");
        await vi.advanceTimersByTimeAsync(5000);
        await expect(result).resolves.toEqual({ data: {} });
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    test("retries a page in the middle of pagination", async () => {
        vi.useFakeTimers();
        stubFetch((_url, call) => {
            if (call === 0) return json(page([{ id: "1" }], { next: `${BASE}/songs?offset=1` }));
            if (call === 1) return tooManyRequests("1");
            return json(page([{ id: "2" }]));
        });
        const result = pcoFetchAll("/songs", "songs");
        await vi.advanceTimersByTimeAsync(1000);
        await expect(result).resolves.toMatchObject({ data: [{ id: "1" }, { id: "2" }] });
    });

    test("gives up after one retry", async () => {
        vi.useFakeTimers();
        const fetchMock = stubFetch(() => tooManyRequests("1"));
        const result = pcoFetch("/service_types/1", "serviceTypes");
        const settled = expect(result).rejects.toMatchObject({ status: 429 });
        await vi.advanceTimersByTimeAsync(1000);
        await settled;
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    test.each([
        ["more than 5 seconds", "6"],
        ["an HTTP date", "Wed, 21 Oct 2026 07:28:00 GMT"],
        ["not a number", "soon"],
        ["negative", "-1"],
    ])("does not retry when Retry-After is %s", async (_case, retryAfter) => {
        const fetchMock = stubFetch(() => tooManyRequests(retryAfter));
        await expect(pcoFetch("/service_types/1", "serviceTypes")).rejects.toMatchObject({
            status: 429,
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    test("does not retry without a Retry-After header", async () => {
        const fetchMock = stubFetch(() => tooManyRequests());
        await expect(pcoFetch("/service_types/1", "serviceTypes")).rejects.toThrow(
            "status: 429"
        );
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    test("handles a bare { ok, status } mock with no headers object", async () => {
        const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 429 });
        vi.stubGlobal("fetch", fetchMock);
        await expect(pcoFetch("/songs", "songs")).rejects.toThrow("status: 429");
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    test("does not retry other statuses, even with Retry-After", async () => {
        const fetchMock = stubFetch(() =>
            json({}, { status: 503, headers: { "Retry-After": "1" } })
        );
        await expect(pcoFetch("/service_types/1", "serviceTypes")).rejects.toMatchObject({
            status: 503,
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});
