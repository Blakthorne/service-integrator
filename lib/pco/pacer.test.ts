import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
    createPacer,
    readRateLimit,
    readRetryAfter,
    type ObservedResponse,
    type Pacer,
} from "./pacer";

const LIMIT = "x-pco-api-request-rate-limit";
const PERIOD = "x-pco-api-request-rate-period";
const COUNT = "x-pco-api-request-rate-count";

/** A response with these headers, as the pacer observes it. */
function observed(headers: Record<string, string>, status = 200): ObservedResponse {
    return { status, headers: new Headers(headers) };
}

afterEach(() => {
    vi.useRealTimers();
});

/** A pacer on a hand-driven clock; its sleeps advance the clock and are logged. */
function setup() {
    let time = 1_000;
    const sleeps: number[] = [];
    const pacer = createPacer({
        now: () => time,
        sleep: async (ms) => {
            sleeps.push(ms);
            time += ms;
        },
    });
    return {
        pacer,
        sleeps,
        now: () => time,
        advance: (ms: number) => {
            time += ms;
        },
    };
}

async function acquireMany(pacer: Pacer, count: number): Promise<void> {
    for (let i = 0; i < count; i++) {
        await pacer.acquire();
    }
}

/** Fake timers that also drive performance.now, the pacer's default clock. */
function useFakeClock() {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "performance"] });
}

describe("createPacer", () => {
    test("until PCO says otherwise, assumes 100 requests per 20 s and paces 80 of them", () => {
        expect(createPacer().limits()).toEqual({ limit: 100, periodMs: 20_000, budget: 80 });
    });

    test("lets 80 requests start at once and holds the 81st until the first is 20 s old", async () => {
        const { pacer, sleeps, now, advance } = setup();

        await acquireMany(pacer, 80);
        expect(sleeps).toEqual([]);

        advance(5_000);
        await pacer.acquire();
        expect(sleeps).toEqual([15_000]);
        expect(now()).toBe(21_000);
    });

    test("frees each turn 20 s after it was taken, not a whole window at once", async () => {
        const { pacer, sleeps, advance } = setup();
        // Turns at 1000, 1100, …, 8900 ms.
        for (let i = 0; i < 80; i++) {
            await pacer.acquire();
            advance(100);
        }

        // At 9000 ms: the turn taken at 1000 frees at 21000, the next at 21100.
        await pacer.acquire();
        await pacer.acquire();
        expect(sleeps).toEqual([12_000, 100]);
    });

    test("never starts more than 80 requests in any 20-second window", async () => {
        const { pacer, now, advance } = setup();
        const starts: number[] = [];
        for (let i = 0; i < 400; i++) {
            await pacer.acquire();
            starts.push(now());
            advance(i % 7 === 0 ? 900 : 13);
        }

        const busiest = Math.max(
            ...starts.map(
                (start) => starts.filter((t) => t >= start && t < start + 20_000).length
            )
        );
        expect(busiest).toBe(80);
    });

    test("serves concurrent callers in the order they called", async () => {
        const { pacer, sleeps, now } = setup();
        const order: number[] = [];

        await Promise.all(
            Array.from({ length: 83 }, (_, i) =>
                pacer.acquire().then(() => {
                    order.push(i);
                })
            )
        );

        expect(order).toEqual(Array.from({ length: 83 }, (_, i) => i));
        // The 81st waited for the first 80, all taken at once, to come back.
        expect(sleeps).toEqual([20_000]);
        expect(now()).toBe(21_000);
    });

    test("holds a waiting turn until the window frees, later callers queued behind it", async () => {
        useFakeClock();
        const pacer = createPacer();
        await acquireMany(pacer, 80);

        const granted: number[] = [];
        void pacer.acquire().then(() => granted.push(81));
        void pacer.acquire().then(() => granted.push(82));

        await vi.advanceTimersByTimeAsync(19_999);
        expect(granted).toEqual([]);
        await vi.advanceTimersByTimeAsync(1);
        expect(granted).toEqual([81, 82]);
    });

    test("a wait that fails rejects that caller only", async () => {
        let time = 0;
        const sleep = vi
            .fn()
            .mockRejectedValueOnce(new Error("timer failed"))
            .mockImplementation(async (ms: number) => {
                time += ms;
            });
        const pacer = createPacer({ now: () => time, sleep });
        await acquireMany(pacer, 80);

        const failed = pacer.acquire();
        const next = pacer.acquire();

        await expect(failed).rejects.toThrow("timer failed");
        await expect(next).resolves.toBeUndefined();
    });
});

describe("pcoPacer", () => {
    const SLOT = /^service-integrator\.pcoPacer\.v\d+$/;

    const slots = () =>
        Object.getOwnPropertySymbols(globalThis).filter((symbol) =>
            SLOT.test(symbol.description ?? "")
        );

    /** Remove the shared pacer from globalThis, whatever its version. */
    function clearSharedPacer() {
        const scope = globalThis as unknown as Record<symbol, unknown>;
        for (const symbol of slots()) {
            delete scope[symbol];
        }
    }

    /** A fresh copy of the module, as a server action's layer would load it. */
    async function loadCopy() {
        vi.resetModules();
        return import("./pacer");
    }

    beforeEach(clearSharedPacer);
    afterEach(clearSharedPacer);

    test("is one bucket shared by every copy of the module", async () => {
        useFakeClock();
        const first = await loadCopy();
        const second = await loadCopy();
        expect(second.createPacer).not.toBe(first.createPacer);
        expect(second.pcoPacer()).toBe(first.pcoPacer());

        await acquireMany(first.pcoPacer(), 80);
        let granted = false;
        void second
            .pcoPacer()
            .acquire()
            .then(() => {
                granted = true;
            });

        await vi.advanceTimersByTimeAsync(19_999);
        expect(granted).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(granted).toBe(true);
    });

    test("is created on first use, in one versioned slot on globalThis", async () => {
        const { pcoPacer } = await loadCopy();
        expect(slots()).toHaveLength(0);

        pcoPacer();
        pcoPacer();
        expect(slots()).toHaveLength(1);
    });
});

describe("readRateLimit", () => {
    test("reads PCO's lowercase rate-limit headers", () => {
        const headers = new Headers({ [LIMIT]: "100", [PERIOD]: "20", [COUNT]: "7" });
        expect(readRateLimit(headers)).toStrictEqual({ limit: 100, periodSeconds: 20, count: 7 });
    });

    test("finds them whatever their case", () => {
        const headers = new Headers({ "X-PCO-API-Request-Rate-Limit": "10" });
        expect(readRateLimit(headers).limit).toBe(10);
    });

    test.each(["20", "20 seconds", " 20 "])("reads a period of %j as 20 seconds", (value) => {
        expect(readRateLimit(new Headers({ [PERIOD]: value })).periodSeconds).toBe(20);
    });

    test("reads a count past the limit, as a 429 carries", () => {
        const headers = new Headers({ [LIMIT]: "100", [COUNT]: "118" });
        expect(readRateLimit(headers)).toMatchObject({ limit: 100, count: 118 });
    });

    test.each([
        "",
        "soon",
        "twenty",
        "1e3",
        "20s",
        "1,000",
        "-20",
        "0x14",
        "Infinity",
        "99999999999999999999",
    ])("treats %j as no information, never as zero", (value) => {
        const headers = new Headers({ [LIMIT]: value, [PERIOD]: value, [COUNT]: value });
        expect(readRateLimit(headers)).toEqual({});
    });

    test("a limit or period of 0, or a period over an hour, is no information; a count of 0 is", () => {
        expect(readRateLimit(new Headers({ [LIMIT]: "0", [PERIOD]: "0", [COUNT]: "0" }))).toEqual({
            count: 0,
        });
        expect(readRateLimit(new Headers({ [PERIOD]: "3601" }))).toEqual({});
        expect(readRateLimit(new Headers({ [PERIOD]: "3600" }))).toEqual({ periodSeconds: 3600 });
    });

    test("a response without the headers, or without headers at all, says nothing", () => {
        expect(readRateLimit(new Headers({ "content-type": "application/json" }))).toEqual({});
        expect(readRateLimit(undefined)).toEqual({});
    });
});

describe("observe", () => {
    test("adapts to a lowered limit: at 10 per 20 s it lets 8 start, then waits", async () => {
        const { pacer, sleeps, now } = setup();
        pacer.observe(observed({ [LIMIT]: "10", [PERIOD]: "20" }));
        expect(pacer.limits()).toEqual({ limit: 10, periodMs: 20_000, budget: 8 });

        await acquireMany(pacer, 8);
        expect(sleeps).toEqual([]);
        await pacer.acquire();
        expect(sleeps).toEqual([20_000]);
        expect(now()).toBe(21_000);
    });

    test("follows a raised limit and a longer period", async () => {
        const { pacer, sleeps } = setup();
        pacer.observe(observed({ [LIMIT]: "200", [PERIOD]: "60 seconds" }));
        expect(pacer.limits()).toEqual({ limit: 200, periodMs: 60_000, budget: 160 });

        await acquireMany(pacer, 161);
        expect(sleeps).toEqual([60_000]);
    });

    test("keeps at least one paced request a period", () => {
        const pacer = createPacer();
        pacer.observe(observed({ [LIMIT]: "1" }));
        expect(pacer.limits().budget).toBe(1);
    });

    test("learns nothing from a missing or garbage header", () => {
        const pacer = createPacer();
        pacer.observe(observed({ [LIMIT]: "10", [PERIOD]: "30" }));
        for (const response of [
            {},
            observed({}),
            observed({ [LIMIT]: "soon", [PERIOD]: "0", [COUNT]: "lots" }),
        ]) {
            pacer.observe(response);
            expect(pacer.limits()).toEqual({ limit: 10, periodMs: 30_000, budget: 8 });
        }
    });

    test("a count that has reached the budget holds paced callers for a whole period", async () => {
        const { pacer, sleeps, now } = setup();
        pacer.observe(observed({ [LIMIT]: "100", [COUNT]: "79" }));
        await pacer.acquire();
        expect(sleeps).toEqual([]);

        // PCO's window could have started just now, so it waits a whole period.
        pacer.observe(observed({ [LIMIT]: "100", [COUNT]: "80" }));
        await pacer.acquire();
        expect(sleeps).toEqual([20_000]);
        expect(now()).toBe(21_000);
    });

    test("judges a count against the limit in the same response", async () => {
        const { pacer, sleeps } = setup();
        pacer.observe(observed({ [LIMIT]: "10", [PERIOD]: "20", [COUNT]: "8" }));
        await pacer.acquire();
        expect(sleeps).toEqual([20_000]);
    });
});

describe("pause", () => {
    test("holds every paced caller, queued ones included, until it ends", async () => {
        useFakeClock();
        const pacer = createPacer();
        await pacer.acquire();

        pacer.pause(10_000);
        const granted: number[] = [];
        void pacer.acquire().then(() => granted.push(1));
        void pacer.acquire().then(() => granted.push(2));

        await vi.advanceTimersByTimeAsync(9_999);
        expect(granted).toEqual([]);
        await vi.advanceTimersByTimeAsync(1);
        expect(granted).toEqual([1, 2]);
    });

    test("is never shortened by a shorter one", async () => {
        const { pacer, sleeps } = setup();
        pacer.pause(30_000);
        pacer.pause(5_000);
        await pacer.acquire();
        expect(sleeps).toEqual([30_000]);
    });

    test("lengthens the wait of a caller already waiting for a token", async () => {
        useFakeClock();
        const pacer = createPacer();
        pacer.observe(observed({ [LIMIT]: "1" }));
        await pacer.acquire();
        let granted = false;
        // Its token comes back at 20 s.
        void pacer.acquire().then(() => {
            granted = true;
        });

        await vi.advanceTimersByTimeAsync(15_000);
        pacer.pause(10_000);
        await vi.advanceTimersByTimeAsync(9_999);
        expect(granted).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(granted).toBe(true);
    });
});

describe("readRetryAfter", () => {
    test.each([
        ["0", 0],
        ["5", 5],
        [" 30 ", 30],
        ["600", 600],
    ])("reads %j as %i seconds", (value, seconds) => {
        expect(readRetryAfter(new Headers({ "Retry-After": value }))).toBe(seconds);
    });

    test.each(["", "soon", "-1", "5 seconds", "1.5", "Wed, 21 Oct 2026 07:28:00 GMT"])(
        "reads %j as nothing",
        (value) => {
            expect(readRetryAfter(new Headers({ "Retry-After": value }))).toBeUndefined();
        }
    );

    test("reads a missing header, or no headers at all, as nothing", () => {
        expect(readRetryAfter(new Headers())).toBeUndefined();
        expect(readRetryAfter(undefined)).toBeUndefined();
    });
});

describe("observe a 429", () => {
    test("holds paced callers until its Retry-After, though its count is past the limit", async () => {
        const { pacer, sleeps } = setup();
        pacer.observe(observed({ [LIMIT]: "100", [COUNT]: "118", "Retry-After": "3" }, 429));
        await pacer.acquire();
        expect(sleeps).toEqual([3_000]);
    });

    test("without Retry-After, holds them a whole period", async () => {
        const { pacer, sleeps } = setup();
        pacer.observe(observed({ [PERIOD]: "30" }, 429));
        await pacer.acquire();
        expect(sleeps).toEqual([30_000]);
    });

    test("holds them at most 60 s, however long Retry-After is", async () => {
        const { pacer, sleeps } = setup();
        pacer.observe(observed({ "Retry-After": "300" }, 429));
        await pacer.acquire();
        expect(sleeps).toEqual([60_000]);
    });

    test("still learns the limit from it", () => {
        const pacer = createPacer();
        pacer.observe(observed({ [LIMIT]: "10", [COUNT]: "11", "Retry-After": "1" }, 429));
        expect(pacer.limits().budget).toBe(8);
    });
});
