import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { PACER_LIMIT, PACER_WINDOW_MS, createPacer, type Pacer } from "./pacer";

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
    test("allows 80 requests per 20 seconds, under PCO's 100", () => {
        expect(PACER_LIMIT).toBe(80);
        expect(PACER_WINDOW_MS).toBe(20_000);
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
