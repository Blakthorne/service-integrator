import { inspect } from "node:util";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
    PcoError,
    PcoUrlError,
    PcoValidationError,
    jsonApi,
    pcoFetch,
    pcoFetchAll,
    pcoMutate,
    toMany,
    toOne,
} from "./client";
import { InvalidPcoIdError } from "./ids";
import { calledRequests, stubFetchRoutes, stubPcoPacer } from "./testing";

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
    vi.restoreAllMocks();
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

describe("timeouts", () => {
    const TIMEOUT_MESSAGE =
        "Planning Center did not respond within 15 s (/services/v2/service_types/1)";

    test("each attempt gets its own 15-second timeout signal, the 429 retry included", async () => {
        vi.useFakeTimers();
        const timeout = vi.spyOn(AbortSignal, "timeout");
        const fetchMock = stubFetch((_url, call) =>
            call === 0 ? tooManyRequests("1") : json({ data: {} })
        );

        const result = pcoFetch("/service_types/1", "serviceTypes");
        await vi.advanceTimersByTimeAsync(1000);
        await expect(result).resolves.toEqual({ data: {} });

        expect(timeout.mock.calls).toEqual([[15_000], [15_000]]);
        const signals = fetchMock.mock.calls.map(
            ([, init]) => (init as RequestInit).signal
        );
        expect(signals).toHaveLength(2);
        for (const signal of signals) {
            expect(signal).toBeInstanceOf(AbortSignal);
        }
        expect(signals[1]).not.toBe(signals[0]);
    });

    test("a request that never answers is abandoned when its timeout fires", async () => {
        vi.useFakeTimers();
        // Drive AbortSignal.timeout from the fake clock.
        vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
            const controller = new AbortController();
            setTimeout(
                () =>
                    controller.abort(
                        new DOMException("The operation was aborted due to timeout", "TimeoutError")
                    ),
                ms
            );
            return controller.signal;
        });
        // Like the real fetch: never answers, but rejects when its signal fires.
        vi.stubGlobal(
            "fetch",
            vi.fn().mockImplementation(
                (_url: string, init: RequestInit) =>
                    new Promise((_resolve, reject) => {
                        init.signal?.addEventListener("abort", () =>
                            reject(init.signal?.reason)
                        );
                    })
            )
        );

        const outcome = pcoFetch("/service_types/1", "serviceTypes").then(
            () => "resolved",
            (error: unknown) => error
        );
        let done = false;
        void outcome.then(() => {
            done = true;
        });

        await vi.advanceTimersByTimeAsync(14_999);
        expect(done).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        const error = await outcome;
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe(TIMEOUT_MESSAGE);
    });

    test.each([
        ["TimeoutError", "The operation was aborted due to timeout"],
        ["AbortError", "This operation was aborted"],
    ])(
        "a fetch rejected with %s surfaces as an error naming the path, not the headers",
        async (name, message) => {
            const abort = new DOMException(message, name);
            vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abort));

            const error = await pcoFetch("/service_types/1", "serviceTypes").catch(
                (e: unknown) => e
            );

            expect(error).toBeInstanceOf(Error);
            expect(error).not.toBeInstanceOf(PcoError);
            expect((error as Error).message).toBe(TIMEOUT_MESSAGE);
            expect((error as Error).cause).toBe(abort);
            expect((error as Error).message).not.toContain("Basic");
            expect(Object.keys(error as object)).toEqual([]);
        }
    );

    test("a timeout while reading the body surfaces the same way", async () => {
        const abort = new DOMException("The operation was aborted due to timeout", "TimeoutError");
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue({ ok: true, json: () => Promise.reject(abort) })
        );
        await expect(pcoFetch("/service_types/1", "serviceTypes")).rejects.toThrow(
            TIMEOUT_MESSAGE
        );
    });
});

describe("unread error bodies", () => {
    /** A response whose body stream records whether it was cancelled. */
    function trackedResponse(
        status: number,
        headers: Record<string, string> = {},
        onCancel: () => void = () => {}
    ) {
        const state = { cancelled: false };
        const body = new ReadableStream({
            cancel() {
                state.cancelled = true;
                onCancel();
            },
        });
        return { response: new Response(body, { status, headers }), state };
    }

    test("cancels a failed response's body before throwing, freeing the socket", async () => {
        const failed = trackedResponse(404);
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(failed.response));

        await expect(pcoFetch("/service_types/1", "serviceTypes")).rejects.toMatchObject({
            name: "PcoError",
            status: 404,
        });
        expect(failed.state.cancelled).toBe(true);
    });

    test("cancels a 429's body before waiting to retry, and a failed retry's too", async () => {
        vi.useFakeTimers();
        const first = trackedResponse(429, { "Retry-After": "1" });
        const second = trackedResponse(429, { "Retry-After": "1" });
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(first.response)
            .mockResolvedValueOnce(second.response);
        vi.stubGlobal("fetch", fetchMock);

        const result = pcoFetch("/service_types/1", "serviceTypes");
        const settled = expect(result).rejects.toMatchObject({ status: 429 });
        await vi.advanceTimersByTimeAsync(0);
        // Released while waiting, before the retry goes out.
        expect(first.state.cancelled).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(1000);
        await settled;
        expect(second.state.cancelled).toBe(true);
    });

    /**
     * A failed response whose body never finishes cancelling, like a teed
     * (memoized) fetch body in a Next server render whose twin is unread.
     */
    function stuckResponse(status: number, headers: Record<string, string> = {}) {
        const body = new ReadableStream({ cancel: () => new Promise<void>(() => {}) });
        return new Response(body, { status, headers });
    }

    /** `promise`, or a rejection if it is still pending after `ms` of real time. */
    function within<T>(promise: Promise<T>, ms = 250): Promise<T> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const deadline = new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(`still pending after ${ms} ms`)), ms);
        });
        return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
    }

    test.each([
        ["a 404", () => stuckResponse(404), 404],
        ["a 429 with too long a Retry-After", () => stuckResponse(429, { "Retry-After": "60" }), 429],
        ["a 429 without Retry-After", () => stuckResponse(429), 429],
    ])(
        "never waits for the body to cancel: %s still rejects promptly with PcoError",
        async (_case, makeResponse, status) => {
            vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => makeResponse()));
            const error = await within(pcoFetch("/service_types/1", "serviceTypes")).catch(
                (e: unknown) => e
            );
            expect(error).toBeInstanceOf(PcoError);
            expect(error).toMatchObject({ status });
        }
    );

    test("never waits for the body to cancel before retrying a 429", async () => {
        vi.useFakeTimers();
        const fetchMock = vi
            .fn()
            .mockImplementationOnce(async () => stuckResponse(429, { "Retry-After": "1" }))
            .mockImplementationOnce(async () => json({ data: { id: "1" } }));
        vi.stubGlobal("fetch", fetchMock);

        const result = pcoFetch("/service_types/1", "serviceTypes");
        await vi.advanceTimersByTimeAsync(1000);

        expect(fetchMock).toHaveBeenCalledTimes(2);
        await expect(result).resolves.toEqual({ data: { id: "1" } });
    });

    test("a body that fails to cancel does not hide the PcoError", async () => {
        const failed = trackedResponse(500, {}, () => {
            throw new Error("socket already gone");
        });
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(failed.response));

        await expect(pcoFetch("/service_types/1", "serviceTypes")).rejects.toMatchObject({
            name: "PcoError",
            status: 500,
        });
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

describe("jsonApi", () => {
    test("builds a JSON:API body from the type and attributes", () => {
        expect(jsonApi("Song", { title: "Amazing Grace", ccli_number: 22025 })).toStrictEqual({
            data: { type: "Song", attributes: { title: "Amazing Grace", ccli_number: 22025 } },
        });
    });

    test("adds the relationships, each built with toOne", () => {
        const body = jsonApi(
            "ItemNote",
            { content: "R-396 / G-317" },
            { item_note_category: toOne("ItemNoteCategory", "123") }
        );
        expect(body).toStrictEqual({
            data: {
                type: "ItemNote",
                attributes: { content: "R-396 / G-317" },
                relationships: {
                    item_note_category: { data: { type: "ItemNoteCategory", id: "123" } },
                },
            },
        });
    });

    test.each(["", "0", "01", "1.5", "../1", "1/2", " 1"])("toOne rejects the ID %j", (id) => {
        expect(() => toOne("Song", id)).toThrow(InvalidPcoIdError);
    });

    test("toMany builds a to-many relationship, as assign_tags takes", () => {
        expect(
            jsonApi("TagAssignment", {}, { tags: toMany("Tag", ["11", "12"]) })
        ).toStrictEqual({
            data: {
                type: "TagAssignment",
                attributes: {},
                relationships: {
                    tags: {
                        data: [
                            { type: "Tag", id: "11" },
                            { type: "Tag", id: "12" },
                        ],
                    },
                },
            },
        });
    });

    test("toMany allows an empty list", () => {
        expect(toMany("Tag", [])).toStrictEqual({ data: [] });
    });

    test.each([[["11", "../12"]], [["0"]], [["11", ""]]])("toMany rejects the IDs %j", (ids) => {
        expect(() => toMany("Tag", ids)).toThrow(InvalidPcoIdError);
    });
});

describe("pcoMutate", () => {
    const songBody = jsonApi("Song", { title: "Amazing Grace" });
    const song = { data: { type: "Song", id: "9", attributes: { title: "Amazing Grace" } } };

    test.each([
        ["POST", "/songs", 201],
        ["PATCH", "/songs/9", 200],
    ] as const)(
        "%s sends the JSON body with auth and a JSON content type, uncached and refusing redirects",
        async (method, path, status) => {
            const fetchMock = stubFetchRoutes({
                [`${method} ${BASE}${path}`]: () => json(song, { status }),
            });

            await expect(pcoMutate(method, path, songBody)).resolves.toEqual(song);

            expect(calledRequests(fetchMock)).toEqual([
                { method, url: `${BASE}${path}`, body: songBody },
            ]);
            expect(fetchMock).toHaveBeenCalledWith(
                `${BASE}${path}`,
                expect.objectContaining({
                    method,
                    body: JSON.stringify(songBody),
                    cache: "no-store",
                    redirect: "error",
                    headers: { Authorization: AUTH, "Content-Type": "application/json" },
                    signal: expect.any(AbortSignal),
                })
            );
        }
    );

    test("DELETE sends no body and resolves to null on 204 No Content", async () => {
        const fetchMock = stubFetchRoutes({
            [`DELETE ${BASE}/songs/9`]: () => new Response(null, { status: 204 }),
        });

        await expect(pcoMutate("DELETE", "/songs/9")).resolves.toBeNull();

        const [[, init]] = fetchMock.mock.calls;
        expect(init).not.toHaveProperty("body");
        expect(init).toMatchObject({ method: "DELETE", cache: "no-store", redirect: "error" });
    });

    test("resolves to null for a 2xx with an empty body", async () => {
        stubFetchRoutes({
            [`PATCH ${BASE}/songs/9`]: () => new Response("", { status: 200 }),
        });
        await expect(pcoMutate("PATCH", "/songs/9", songBody)).resolves.toBeNull();
    });

    test("POSTs assign_tags with a to-many body and resolves to null on its 204", async () => {
        const fetchMock = stubFetchRoutes({
            [`POST ${BASE}/songs/9/assign_tags`]: () => new Response(null, { status: 204 }),
        });
        const body = jsonApi("TagAssignment", {}, { tags: toMany("Tag", ["11", "12"]) });

        await expect(pcoMutate("POST", "/songs/9/assign_tags", body)).resolves.toBeNull();

        expect(calledRequests(fetchMock)).toEqual([
            { method: "POST", url: `${BASE}/songs/9/assign_tags`, body },
        ]);
    });

    test.each([
        "/service_types/../../../people/v2/people%3F/plans",
        "/service_types/%2e%2e/%2E%2E/%2e%2e/people/v2/people",
        "/../people/v2/people",
        "songs",
        "https://evil.example/services/v2/songs",
    ])("refuses %j before any fetch", async (path) => {
        const fetchMock = stubFetchRoutes({});
        await expect(pcoMutate("POST", path, songBody)).rejects.toBeInstanceOf(PcoUrlError);
        await expect(pcoMutate("DELETE", path)).rejects.toBeInstanceOf(PcoUrlError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    test("throws a PcoError with the status and path on a 404", async () => {
        stubFetchRoutes({
            [`PATCH ${BASE}/songs/404`]: () => json({ errors: [] }, { status: 404 }),
        });

        const error = await pcoMutate("PATCH", "/songs/404", songBody).catch(
            (e: unknown) => e
        );

        expect(error).toBeInstanceOf(PcoError);
        expect(error).toMatchObject({
            name: "PcoError",
            status: 404,
            path: "/services/v2/songs/404",
        });
    });

    test("retries a 429 POST once after Retry-After, as PCO refused it unprocessed", async () => {
        vi.useFakeTimers();
        const fetchMock = stubFetch((_url, call) =>
            call === 0 ? tooManyRequests("2") : json(song, { status: 201 })
        );

        const result = pcoMutate("POST", "/songs", songBody);
        await vi.advanceTimersByTimeAsync(1999);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);

        await expect(result).resolves.toEqual(song);
        expect(calledRequests(fetchMock)).toEqual([
            { method: "POST", url: `${BASE}/songs`, body: songBody },
            { method: "POST", url: `${BASE}/songs`, body: songBody },
        ]);
    });

    test("gives each attempt a 15-second timeout, and never retries a write that timed out", async () => {
        const timeout = vi.spyOn(AbortSignal, "timeout");
        const abort = new DOMException("The operation was aborted due to timeout", "TimeoutError");
        const fetchMock = vi.fn().mockRejectedValue(abort);
        vi.stubGlobal("fetch", fetchMock);

        const error = await pcoMutate("POST", "/songs", songBody).catch((e: unknown) => e);

        expect(timeout.mock.calls).toEqual([[15_000]]);
        expect((error as Error).message).toBe(
            "Planning Center did not respond within 15 s (/services/v2/songs)"
        );
        expect((error as Error).cause).toBe(abort);
        // PCO may have applied it, so sending it again could apply it twice.
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    test("no error it throws carries the credentials", async () => {
        vi.stubEnv("PLANNING_CENTER_ID", "app-id");
        vi.stubEnv("PLANNING_CENTER_TOKEN", "s3cret-pat");
        const encoded = Buffer.from("app-id:s3cret-pat").toString("base64");
        const timedOut = new DOMException("The operation was aborted due to timeout", "TimeoutError");
        const fetchMock = stubFetchRoutes({
            [`PATCH ${BASE}/songs/404`]: () => json({ errors: [] }, { status: 404 }),
            [`PATCH ${BASE}/songs/9`]: () =>
                json({ errors: [{ detail: "Title can't be blank" }] }, { status: 422 }),
            [`POST ${BASE}/songs`]: () => tooManyRequests(),
            [`DELETE ${BASE}/songs/9`]: () => Promise.reject(timedOut),
        });

        const errors = await Promise.all(
            [
                pcoMutate("PATCH", "/songs/404", songBody),
                pcoMutate("PATCH", "/songs/9", songBody),
                pcoMutate("POST", "/songs", songBody),
                pcoMutate("DELETE", "/songs/9"),
                pcoMutate("POST", "/../people/v2/people", songBody),
            ].map((promise) => promise.then(() => null, (e: unknown) => e))
        );

        // The requests did carry them, so the check below is not vacuous.
        expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(`Basic ${encoded}`);
        for (const error of errors) {
            expect(error).toBeInstanceOf(Error);
            const printed = inspect(error, { depth: null });
            for (const secret of ["s3cret-pat", encoded, "Basic "]) {
                expect(printed).not.toContain(secret);
            }
        }
    });
});

describe("validation errors (422)", () => {
    const songBody = jsonApi("Song", { title: "" });
    const MESSAGE = "Planning Center API responded with status: 422 (/services/v2/songs)";

    /** Stub POST /songs with a 422 built by `makeResponse`. */
    function rejectSong(makeResponse: () => Response) {
        return stubFetchRoutes({ [`POST ${BASE}/songs`]: makeResponse });
    }

    test("a 422 is a PcoValidationError carrying PCO's errors[].detail", async () => {
        const fetchMock = rejectSong(() =>
            json(
                {
                    errors: [
                        {
                            status: "422",
                            title: "Unprocessable Entity",
                            detail: "Title can't be blank",
                            source: { pointer: "/data/attributes/title" },
                        },
                        { status: "422", title: "Unprocessable Entity", detail: "Ccli number is invalid" },
                    ],
                },
                { status: 422 }
            )
        );

        const error = await pcoMutate("POST", "/songs", songBody).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(PcoValidationError);
        expect(error).toBeInstanceOf(PcoError);
        expect(error).toMatchObject({
            name: "PcoValidationError",
            status: 422,
            path: "/services/v2/songs",
            details: ["Title can't be blank", "Ccli number is invalid"],
        });
        expect((error as Error).message).toBe(
            `${MESSAGE}: ["Title can't be blank","Ccli number is invalid"]`
        );
        // A 422 is never retried.
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    test.each([
        ["a body that is not JSON", () => new Response("<html>Unprocessable</html>", { status: 422 })],
        ["an empty body", () => new Response(null, { status: 422 })],
        ["JSON null", () => json(null, { status: 422 })],
        ["JSON without errors", () => json({ message: "invalid" }, { status: 422 })],
        ["errors that is not a list", () => json({ errors: "invalid" }, { status: 422 })],
    ])("%s gives a PcoValidationError with no details", async (_case, makeResponse) => {
        rejectSong(makeResponse);

        const error = await pcoMutate("POST", "/songs", songBody).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(PcoValidationError);
        expect(error).toMatchObject({ status: 422, details: [] });
        expect((error as Error).message).toBe(MESSAGE);
    });

    test("keeps only the details that are non-empty strings", async () => {
        rejectSong(() =>
            json(
                {
                    errors: [
                        { title: "No detail" },
                        { detail: "Title can't be blank" },
                        { detail: 42 },
                        { detail: "" },
                        null,
                        "invalid",
                    ],
                },
                { status: 422 }
            )
        );
        await expect(pcoMutate("POST", "/songs", songBody)).rejects.toMatchObject({
            details: ["Title can't be blank"],
        });
    });

    test("a body that fails while being read gives no details", async () => {
        const body = new ReadableStream({
            pull: (controller) => controller.error(new TypeError("terminated")),
        });
        rejectSong(() => new Response(body, { status: 422 }));
        await expect(pcoMutate("POST", "/songs", songBody)).rejects.toMatchObject({
            name: "PcoValidationError",
            details: [],
        });
    });

    test("quotes the details in the message, so a detail cannot forge a log line", async () => {
        rejectSong(() => json({ errors: [{ detail: "bad\nFAKE LOG LINE" }] }, { status: 422 }));

        const error = await pcoMutate("POST", "/songs", songBody).catch((e: unknown) => e);

        expect((error as Error).message).toBe(`${MESSAGE}: ["bad\\nFAKE LOG LINE"]`);
        expect((error as PcoValidationError).details).toEqual(["bad\nFAKE LOG LINE"]);
    });

    test("a 422 to a GET is a PcoValidationError too", async () => {
        stubFetch(() => json({ errors: [{ detail: "Unknown filter" }] }, { status: 422 }));
        await expect(pcoFetch("/service_types/1/plans", "plans")).rejects.toMatchObject({
            name: "PcoValidationError",
            status: 422,
            details: ["Unknown filter"],
        });
    });

    test.each([400, 404, 409, 500])("a %i stays a plain PcoError", async (status) => {
        rejectSong(() => json({ errors: [{ detail: "Something" }] }, { status }));

        const error = await pcoMutate("POST", "/songs", songBody).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(PcoError);
        expect(error).not.toBeInstanceOf(PcoValidationError);
        expect(error).toMatchObject({ name: "PcoError", status });
        expect(error).not.toHaveProperty("details");
    });
});

describe("paced requests", () => {
    const songBody = jsonApi("Song", { title: "Amazing Grace" });

    /** Swap in the test's own pacer, whose turns are logged and granted at once. */
    function spyOnPacer(log: string[]) {
        return vi.spyOn(stubPcoPacer(), "acquire").mockImplementation(async () => {
            log.push("turn");
        });
    }

    /** Stub fetch, logging each request's method and URL; `respond` answers it. */
    function stubLoggedFetch(log: string[], respond: (call: number) => Response) {
        let call = 0;
        const fetchMock = vi
            .fn()
            .mockImplementation(async (url: string, init?: RequestInit) => {
                log.push(`${init?.method ?? "GET"} ${url}`);
                return respond(call++);
            });
        vi.stubGlobal("fetch", fetchMock);
        return fetchMock;
    }

    test("are off by default: no read or write waits for the pacer", async () => {
        const acquire = vi.spyOn(stubPcoPacer(), "acquire");
        stubFetch((url) =>
            json(
                url === `${BASE}/songs`
                    ? page([{ id: "1" }], { next: `${BASE}/songs?offset=1` })
                    : page([{ id: "2" }])
            )
        );

        await pcoFetch("/service_types/1", "serviceTypes");
        await pcoFetchAll("/songs", "songs");
        await pcoMutate("PATCH", "/songs/9", songBody);

        expect(acquire).not.toHaveBeenCalled();
    });

    test("pcoFetchAll takes a turn before every page it follows, and before a 429 retry", async () => {
        vi.useFakeTimers();
        const log: string[] = [];
        const acquire = spyOnPacer(log);
        stubLoggedFetch(log, (call) => {
            if (call === 0) return json(page([{ id: "1" }], { next: `${BASE}/songs?offset=1` }));
            if (call === 1) return tooManyRequests("1");
            if (call === 2) return json(page([{ id: "2" }], { next: `${BASE}/songs?offset=2` }));
            return json(page([{ id: "3" }]));
        });

        const result = pcoFetchAll("/songs", "songs", { maxPages: 3, paced: true });
        await vi.advanceTimersByTimeAsync(1000);

        await expect(result).resolves.toMatchObject({
            data: [{ id: "1" }, { id: "2" }, { id: "3" }],
        });
        expect(log).toEqual([
            "turn",
            `GET ${BASE}/songs`,
            "turn",
            `GET ${BASE}/songs?offset=1`,
            "turn",
            `GET ${BASE}/songs?offset=1`,
            "turn",
            `GET ${BASE}/songs?offset=2`,
        ]);
        expect(acquire).toHaveBeenCalledTimes(4);
    });

    test("pcoFetch and pcoMutate take one turn per request", async () => {
        const log: string[] = [];
        spyOnPacer(log);
        stubLoggedFetch(log, () => json({ data: {} }));

        await pcoFetch("/service_types/1", "serviceTypes", { paced: true });
        await pcoMutate("PATCH", "/songs/9", songBody, { paced: true });
        await pcoMutate("DELETE", "/songs/9", undefined, { paced: true });

        expect(log).toEqual([
            "turn",
            `GET ${BASE}/service_types/1`,
            "turn",
            `PATCH ${BASE}/songs/9`,
            "turn",
            `DELETE ${BASE}/songs/9`,
        ]);
    });

    test("sends nothing, and starts no timeout, until the pacer grants the turn", async () => {
        let grant = () => {};
        vi.spyOn(stubPcoPacer(), "acquire").mockImplementation(
            () =>
                new Promise<void>((resolve) => {
                    grant = resolve;
                })
        );
        const timeout = vi.spyOn(AbortSignal, "timeout");
        const fetchMock = stubFetch(() => json({ data: { id: "9" } }, { status: 201 }));

        const result = pcoMutate("POST", "/songs", songBody, { paced: true });
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(fetchMock).not.toHaveBeenCalled();
        expect(timeout).not.toHaveBeenCalled();

        grant();
        await expect(result).resolves.toEqual({ data: { id: "9" } });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(timeout.mock.calls).toEqual([[15_000]]);
    });

    test("a URL the guard refuses takes no turn", async () => {
        const acquire = vi.spyOn(stubPcoPacer(), "acquire").mockResolvedValue(undefined);
        const fetchMock = stubFetch(() =>
            json(page([{ id: "1" }], { next: "https://evil.example/services/v2/songs" }))
        );

        await expect(
            pcoMutate("POST", "/../people/v2/people", songBody, { paced: true })
        ).rejects.toBeInstanceOf(PcoUrlError);
        expect(acquire).not.toHaveBeenCalled();

        // The first page takes its turn; the refused links.next takes none.
        await expect(pcoFetchAll("/songs", "songs", { paced: true })).rejects.toBeInstanceOf(
            PcoUrlError
        );
        expect(acquire).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});

describe("what every response tells the pacer", () => {
    /** PCO's rate-limit headers. */
    const rate = (limit: number, count: number, period = 20) => ({
        "x-pco-api-request-rate-limit": String(limit),
        "x-pco-api-request-rate-period": String(period),
        "x-pco-api-request-rate-count": String(count),
    });

    test("an unpaced page load sets the budget", async () => {
        const pacer = stubPcoPacer();
        stubFetch(() => json({ data: {} }, { headers: rate(10, 1, 30) }));

        await pcoFetch("/service_types/1", "serviceTypes");

        expect(pacer.limits()).toEqual({ limit: 10, periodMs: 30_000, budget: 8 });
    });

    test("a failed response does too", async () => {
        const pacer = stubPcoPacer();
        stubFetch(() => json({ errors: [] }, { status: 404, headers: rate(10, 1) }));

        await expect(pcoFetch("/service_types/1", "serviceTypes")).rejects.toMatchObject({
            status: 404,
        });
        expect(pacer.limits().limit).toBe(10);
    });

    test("a busy window seen by a page load holds paced requests until it rolls over", async () => {
        vi.useFakeTimers();
        stubPcoPacer();
        const fetchMock = stubFetch((_url, call) =>
            json({ data: {} }, { headers: rate(100, call === 0 ? 85 : 1) })
        );

        await pcoFetch("/service_types/1", "serviceTypes");
        const paced = pcoFetch("/service_types/1", "serviceTypes", { paced: true });

        await vi.advanceTimersByTimeAsync(19_999);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        await expect(paced).resolves.toEqual({ data: {} });
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    test("a page load never waits, however busy the window", async () => {
        stubPcoPacer();
        const fetchMock = stubFetch(() => json({ data: {} }, { headers: rate(10, 25) }));

        for (let i = 0; i < 3; i++) {
            await pcoFetch("/service_types/1", "serviceTypes");
        }
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    test("a paced pcoFetchAll slows down as soon as a page lowers the limit", async () => {
        vi.useFakeTimers();
        stubPcoPacer();
        // PCO drops to 10 per 20 s; the first page is already the 8th request.
        const fetchMock = stubFetch((_url, call) => {
            const links = call === 0 ? { next: `${BASE}/songs?offset=1` } : {};
            return json(page([{ id: String(call) }], links), {
                headers: rate(10, call === 0 ? 8 : 1),
            });
        });

        const result = pcoFetchAll("/songs", "songs", { paced: true });
        await vi.advanceTimersByTimeAsync(19_999);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);

        await expect(result).resolves.toMatchObject({ data: [{ id: "0" }, { id: "1" }] });
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});
