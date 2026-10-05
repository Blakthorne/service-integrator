import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { withDeadline } from "./deadline";

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

/** A promise settled from outside, as a slow request would settle. */
function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

describe("withDeadline", () => {
    test("gives the value of a promise that settles in time, and clears its timer", async () => {
        const slow = deferred<string>();
        const result = withDeadline(slow.promise, 5000, () => "too late");

        slow.resolve("on time");

        await expect(result).resolves.toBe("on time");
        expect(vi.getTimerCount()).toBe(0);
    });

    test("gives what onTimeout returns when the promise has not settled by then", async () => {
        const slow = deferred<string>();
        const onTimeout = vi.fn(() => "too late");
        const result = withDeadline(slow.promise, 5000, onTimeout);

        await vi.advanceTimersByTimeAsync(4999);
        expect(onTimeout).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);

        await expect(result).resolves.toBe("too late");
        expect(onTimeout).toHaveBeenCalledTimes(1);
    });

    test("ignores a promise that settles after the deadline", async () => {
        const slow = deferred<string>();
        const result = withDeadline(slow.promise, 100, () => "too late");
        await vi.advanceTimersByTimeAsync(100);

        slow.resolve("later");

        await expect(result).resolves.toBe("too late");
    });

    test("rejects when the promise rejects in time", async () => {
        const failing = deferred<string>();
        const result = withDeadline(failing.promise, 5000, () => "too late");
        const caught = result.catch((error: unknown) => error);

        const cause = new Error("PCO is down");
        failing.reject(cause);

        await expect(caught).resolves.toBe(cause);
        expect(vi.getTimerCount()).toBe(0);
    });

    test("handles a rejection that comes after the deadline, so it is not reported as unhandled", async () => {
        const failing = deferred<string>();
        const result = withDeadline(failing.promise, 100, () => "too late");
        await vi.advanceTimersByTimeAsync(100);
        await expect(result).resolves.toBe("too late");

        failing.reject(new Error("PCO is down"));

        // Nothing else to await: the rejection must not escape as an unhandled one.
        await vi.advanceTimersByTimeAsync(0);
    });

    test("rejects when onTimeout throws", async () => {
        const slow = deferred<string>();
        const result = withDeadline(slow.promise, 100, () => {
            throw new Error("no fallback");
        });
        const caught = result.catch((error: unknown) => error);

        await vi.advanceTimersByTimeAsync(100);

        await expect(caught).resolves.toEqual(new Error("no fallback"));
    });

    test("takes any thenable", async () => {
        const result = withDeadline({ then: (done: (value: number) => void) => done(7) } as PromiseLike<number>, 100, () => 0);

        await expect(result).resolves.toBe(7);
    });
});
