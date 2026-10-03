import { describe, expect, test, vi } from "vitest";
import { createTtlCache } from "./ttlCache";

const TTL = 1000;

/** A cache on a hand-driven clock. */
function setup() {
    let time = 10_000;
    const cache = createTtlCache<string, string>({ ttlMs: TTL, now: () => time });
    return {
        cache,
        advance: (ms: number) => {
            time += ms;
        },
    };
}

/** A promise with its resolve/reject exposed, to hold a load in flight. */
function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

describe("createTtlCache", () => {
    test("serves a loaded value from the cache until the TTL is up", async () => {
        const { cache, advance } = setup();
        const load = vi.fn().mockResolvedValueOnce("first").mockResolvedValueOnce("second");

        await expect(cache.get("k", load)).resolves.toBe("first");
        advance(TTL - 1);
        await expect(cache.get("k", load)).resolves.toBe("first");
        expect(load).toHaveBeenCalledTimes(1);

        advance(1);
        await expect(cache.get("k", load)).resolves.toBe("second");
        expect(load).toHaveBeenCalledTimes(2);
    });

    test("counts the TTL from when the load finished", async () => {
        const { cache, advance } = setup();
        const slow = deferred<string>();
        const load = vi.fn().mockReturnValueOnce(slow.promise).mockResolvedValue("reloaded");

        const first = cache.get("k", load);
        advance(5000); // the load takes longer than the TTL
        slow.resolve("slow value");
        await expect(first).resolves.toBe("slow value");

        advance(TTL - 1);
        await expect(cache.get("k", load)).resolves.toBe("slow value");
        expect(load).toHaveBeenCalledTimes(1);
    });

    test("keeps keys apart", async () => {
        const { cache } = setup();
        await cache.get("a", async () => "A");
        await cache.get("b", async () => "B");
        await expect(cache.get("a", async () => "other")).resolves.toBe("A");
        await expect(cache.get("b", async () => "other")).resolves.toBe("B");
    });

    test("never caches a failure", async () => {
        const { cache } = setup();
        const load = vi
            .fn()
            .mockRejectedValueOnce(new Error("PCO down"))
            .mockResolvedValueOnce("recovered");

        await expect(cache.get("k", load)).rejects.toThrow("PCO down");
        await expect(cache.get("k", load)).resolves.toBe("recovered");
        expect(load).toHaveBeenCalledTimes(2);
    });

    test("turns a load that throws synchronously into a rejection, not cached", async () => {
        const { cache } = setup();
        const load = vi.fn((): Promise<string> => {
            throw new Error("sync boom");
        });
        const result = cache.get("k", load);
        await expect(result).rejects.toThrow("sync boom");
        await expect(cache.get("k", async () => "fine")).resolves.toBe("fine");
    });

    test("concurrent calls for a key share one load", async () => {
        const { cache } = setup();
        const pending = deferred<string>();
        const load = vi.fn().mockReturnValue(pending.promise);

        const first = cache.get("k", load);
        const second = cache.get("k", load);
        pending.resolve("shared");

        await expect(first).resolves.toBe("shared");
        await expect(second).resolves.toBe("shared");
        expect(load).toHaveBeenCalledTimes(1);
    });

    test("concurrent calls share a failure too, and the next call retries", async () => {
        const { cache } = setup();
        const pending = deferred<string>();
        const load = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue("retried");

        const first = cache.get("k", load);
        const second = cache.get("k", load);
        pending.reject(new Error("boom"));

        await expect(first).rejects.toThrow("boom");
        await expect(second).rejects.toThrow("boom");
        await expect(cache.get("k", load)).resolves.toBe("retried");
        expect(load).toHaveBeenCalledTimes(2);
    });

    test("invalidate forgets a key", async () => {
        const { cache } = setup();
        await cache.get("k", async () => "old");
        await cache.get("other", async () => "kept");

        cache.invalidate("k");

        await expect(cache.get("k", async () => "new")).resolves.toBe("new");
        await expect(cache.get("other", async () => "x")).resolves.toBe("kept");
    });

    test("invalidate during a load starts a fresh load and drops the old result", async () => {
        const { cache } = setup();
        const stale = deferred<string>();
        const before = cache.get("k", () => stale.promise);

        cache.invalidate("k");
        await expect(cache.get("k", async () => "fresh")).resolves.toBe("fresh");

        // The old load finishes last. Its caller still gets its result...
        stale.resolve("stale");
        await expect(before).resolves.toBe("stale");
        // ...but it does not overwrite what the cache keeps.
        await expect(cache.get("k", async () => "unused")).resolves.toBe("fresh");
    });

    test("an orphaned load that fails does not disturb the load that replaced it", async () => {
        const { cache } = setup();
        const stale = deferred<string>();
        const fresh = deferred<string>();
        const before = cache.get("k", () => stale.promise);
        cache.invalidate("k");
        const after = cache.get("k", () => fresh.promise);

        stale.reject(new Error("old load failed"));
        await expect(before).rejects.toThrow("old load failed");

        // A new caller still joins the replacement load instead of starting one.
        const third = vi.fn(async () => "third load");
        const joined = cache.get("k", third);
        fresh.resolve("fresh");
        await expect(after).resolves.toBe("fresh");
        await expect(joined).resolves.toBe("fresh");
        expect(third).not.toHaveBeenCalled();
    });

    test("clear forgets everything", async () => {
        const { cache } = setup();
        await cache.get("a", async () => "A");
        await cache.get("b", async () => "B");

        cache.clear();

        await expect(cache.get("a", async () => "A2")).resolves.toBe("A2");
        await expect(cache.get("b", async () => "B2")).resolves.toBe("B2");
    });

    test("uses Date.now by default", async () => {
        vi.useFakeTimers();
        try {
            vi.setSystemTime(0);
            const cache = createTtlCache<string, number>({ ttlMs: TTL });
            const load = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);
            await expect(cache.get("k", load)).resolves.toBe(1);
            vi.setSystemTime(TTL);
            await expect(cache.get("k", load)).resolves.toBe(2);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe("TtlCache.refresh", () => {
    test("loads a new value even while a fresh one is cached, and replaces it", async () => {
        const { cache } = setup();
        await cache.get("k", async () => "old");

        await expect(cache.refresh("k", async () => "new")).resolves.toBe("new");

        const load = vi.fn(async () => "unused");
        await expect(cache.get("k", load)).resolves.toBe("new");
        expect(load).not.toHaveBeenCalled();
    });

    test("loads and caches a key that was empty", async () => {
        const { cache } = setup();
        await expect(cache.refresh("k", async () => "first")).resolves.toBe("first");

        const load = vi.fn(async () => "unused");
        await expect(cache.get("k", load)).resolves.toBe("first");
        expect(load).not.toHaveBeenCalled();
    });

    test("counts the TTL from when the refresh finished", async () => {
        const { cache, advance } = setup();
        await cache.get("k", async () => "old");
        advance(TTL - 1); // the old value is about to expire
        await cache.refresh("k", async () => "new");

        advance(TTL - 1); // past the old expiry, inside the new one
        const load = vi.fn(async () => "reloaded");
        await expect(cache.get("k", load)).resolves.toBe("new");
        expect(load).not.toHaveBeenCalled();

        advance(1);
        await expect(cache.get("k", load)).resolves.toBe("reloaded");
    });

    test("a failed refresh rejects and keeps the previous value", async () => {
        const { cache } = setup();
        await cache.get("k", async () => "old");

        await expect(
            cache.refresh("k", () => Promise.reject(new Error("PCO down")))
        ).rejects.toThrow("PCO down");

        const load = vi.fn(async () => "unused");
        await expect(cache.get("k", load)).resolves.toBe("old");
        expect(load).not.toHaveBeenCalled();
    });

    test("a load that throws synchronously is a failed refresh too", async () => {
        const { cache } = setup();
        await cache.get("k", async () => "old");

        const load = vi.fn((): Promise<string> => {
            throw new Error("sync boom");
        });
        await expect(cache.refresh("k", load)).rejects.toThrow("sync boom");

        await expect(cache.get("k", async () => "unused")).resolves.toBe("old");
    });

    test("a failed refresh does not extend the previous value's life", async () => {
        const { cache, advance } = setup();
        await cache.get("k", async () => "old");
        advance(TTL - 1);
        await expect(
            cache.refresh("k", () => Promise.reject(new Error("boom")))
        ).rejects.toThrow("boom");

        advance(1); // the old value's original expiry
        await expect(cache.get("k", async () => "reloaded")).resolves.toBe("reloaded");
    });

    test("a failed refresh of an empty key caches nothing", async () => {
        const { cache } = setup();
        await expect(
            cache.refresh("k", () => Promise.reject(new Error("boom")))
        ).rejects.toThrow("boom");

        await expect(cache.get("k", async () => "loaded")).resolves.toBe("loaded");
    });

    test("get keeps serving the previous value while a refresh loads", async () => {
        const { cache } = setup();
        await cache.get("k", async () => "old");
        const pending = deferred<string>();
        const refreshing = cache.refresh("k", () => pending.promise);

        const load = vi.fn(async () => "unused");
        await expect(cache.get("k", load)).resolves.toBe("old");
        expect(load).not.toHaveBeenCalled();

        pending.resolve("new");
        await expect(refreshing).resolves.toBe("new");
        await expect(cache.get("k", load)).resolves.toBe("new");
    });

    test("a get with nothing fresh cached joins a refresh in flight, and its failure", async () => {
        const { cache } = setup();
        const pending = deferred<string>();
        const refreshing = cache.refresh("k", () => pending.promise);
        const load = vi.fn(async () => "unused");
        const joined = cache.get("k", load);

        pending.reject(new Error("boom"));

        await expect(refreshing).rejects.toThrow("boom");
        await expect(joined).rejects.toThrow("boom");
        expect(load).not.toHaveBeenCalled();
    });

    test("always loads: it supersedes a load already in flight", async () => {
        const { cache } = setup();
        const stale = deferred<string>();
        const before = cache.get("k", () => stale.promise);
        const load = vi.fn(async () => "fresh");

        await expect(cache.refresh("k", load)).resolves.toBe("fresh");
        expect(load).toHaveBeenCalledTimes(1);

        // The older load finishes last. Its caller still gets its result...
        stale.resolve("stale");
        await expect(before).resolves.toBe("stale");
        // ...but the cache keeps the newer one.
        await expect(cache.get("k", async () => "unused")).resolves.toBe("fresh");
    });

    test("keeps keys apart", async () => {
        const { cache } = setup();
        await cache.get("a", async () => "A");
        await cache.get("b", async () => "B");

        await cache.refresh("a", async () => "A2");

        await expect(cache.get("a", async () => "unused")).resolves.toBe("A2");
        await expect(cache.get("b", async () => "unused")).resolves.toBe("B");
    });

    test("an invalidate during a refresh drops its result", async () => {
        const { cache } = setup();
        await cache.get("k", async () => "old");
        const pending = deferred<string>();
        const refreshing = cache.refresh("k", () => pending.promise);

        cache.invalidate("k");
        pending.resolve("new");

        await expect(refreshing).resolves.toBe("new"); // its caller still gets it
        await expect(cache.get("k", async () => "reloaded")).resolves.toBe("reloaded");
    });
});
