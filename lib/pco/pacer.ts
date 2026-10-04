import "server-only";

/**
 * The rate limit assumed until a PCO response says otherwise. PCO adjusts its
 * limits at any time (silently down to 10 per 20 s for a burst at one
 * endpoint) and says to rely on its headers, so these are only a start.
 */
export const DEFAULT_RATE_LIMIT = 100;
export const DEFAULT_RATE_PERIOD_SECONDS = 20;

/**
 * Paced requests use at most this share of the advertised limit (and at least
 * one request a period), leaving the rest for page loads, which never wait.
 */
export const PACED_SHARE = 0.8;

/**
 * The longest a 429 holds paced requests. A paced request that PCO tells to
 * wait longer fails with its 429 instead, so a sync job never hangs on a long
 * block.
 */
export const MAX_PACED_WAIT_SECONDS = 60;

/** What one PCO response's headers say about the rate limit. */
export interface RateLimitInfo {
    /** Requests allowed per period: x-pco-api-request-rate-limit. */
    limit?: number;
    /** The period in seconds: x-pco-api-request-rate-period. */
    periodSeconds?: number;
    /** Requests so far in the current period: x-pco-api-request-rate-count. */
    count?: number;
}

/** A period longer than this is taken for a corrupt header, not believed. */
const MAX_PERIOD_SECONDS = 3600;

/** A whole number, alone or followed by words: "20", "20 seconds". */
const WHOLE_NUMBER = /^\s*(\d+)(?:\s|$)/;

/** The header `name` as a whole number in [min, max], or undefined. */
function wholeNumber(
    headers: Pick<Headers, "get"> | undefined,
    name: string,
    min: number,
    max = Number.MAX_SAFE_INTEGER
): number | undefined {
    // Optional chaining: bare test doubles ({ ok, json }) have no headers.
    const match = WHOLE_NUMBER.exec(headers?.get(name) ?? "");
    const value = match ? Number(match[1]) : NaN;
    return value >= min && value <= max ? value : undefined;
}

/**
 * Read PCO's rate-limit headers from a response (PCO sends a bare "20" for
 * the period; its docs show "20 seconds"). A header that is missing, not a
 * whole number, or out of range (a limit or period of 0, a period over an
 * hour) is left out: no information, never a zero.
 */
export function readRateLimit(headers: Pick<Headers, "get"> | undefined): RateLimitInfo {
    return {
        limit: wholeNumber(headers, "x-pco-api-request-rate-limit", 1),
        periodSeconds: wholeNumber(headers, "x-pco-api-request-rate-period", 1, MAX_PERIOD_SECONDS),
        count: wholeNumber(headers, "x-pco-api-request-rate-count", 0),
    };
}

/**
 * Retry-After as whole seconds, or undefined when it is missing or anything
 * else (an HTTP date, a negative number).
 */
export function readRetryAfter(headers: Pick<Headers, "get"> | undefined): number | undefined {
    // Optional chaining: bare test doubles ({ ok, status }) have no headers.
    const header = headers?.get("Retry-After")?.trim();
    return header && /^\d+$/.test(header) ? Number(header) : undefined;
}

/** What the pacer reads from a response; bare test doubles may have neither. */
export interface ObservedResponse {
    status?: number;
    headers?: Pick<Headers, "get">;
}

/** The limits a pacer works to. */
export interface PacerLimits {
    /** The advertised limit: requests per period. */
    limit: number;
    periodMs: number;
    /** Paced requests per period: PACED_SHARE of the limit, at least 1. */
    budget: number;
}

/** Rations the requests of sync jobs to Planning Center. */
export interface Pacer {
    /**
     * Resolves when one more paced request may start, using up one turn.
     * Callers are served in the order they call.
     */
    acquire(): Promise<void>;
    /**
     * Learn from any PCO response, paced or not: adopt its limit and period.
     * A 429 holds every paced caller until its Retry-After (a whole period
     * without one, at most MAX_PACED_WAIT_SECONDS); any other response whose
     * count has reached the budget holds them until the window has rolled
     * over.
     */
    observe(response: ObservedResponse): void;
    /** Hold every paced caller for `ms` from now; a hold is never shortened. */
    pause(ms: number): void;
    limits(): PacerLimits;
}

/** Options for createPacer; tests inject both. */
export interface PacerOptions {
    /** A monotonic clock in milliseconds. Defaults to performance.now. */
    now?: () => number;
    /** Wait `ms` milliseconds. Defaults to setTimeout. */
    sleep?: (ms: number) => Promise<void>;
}

/**
 * A token bucket of `budget` tokens in which each paced request takes one and
 * every token comes back a period after it was taken (not at a steady rate,
 * which would let a full bucket's burst plus the refill exceed the limit). So
 * the first `budget` requests start at once, the next waits until the first
 * is a period old, and no window, fixed or sliding, holds more than `budget`
 * paced starts. The limit and period follow PCO's headers (see observe).
 * The default clock is monotonic, so a wall-clock change cannot stall a sync
 * or release a burst.
 */
export function createPacer({
    now = () => performance.now(),
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}: PacerOptions = {}): Pacer {
    let limit = DEFAULT_RATE_LIMIT;
    let periodMs = DEFAULT_RATE_PERIOD_SECONDS * 1000;
    // No paced request starts before this.
    let heldUntil = -Infinity;
    // When each token still out was taken, oldest first.
    const taken: number[] = [];
    // Turns are granted one at a time, in call order.
    let queue: Promise<void> = Promise.resolve();

    const budget = () => Math.max(1, Math.floor(limit * PACED_SHARE));

    function pause(ms: number): void {
        heldUntil = Math.max(heldUntil, now() + ms);
    }

    async function takeToken(): Promise<void> {
        for (;;) {
            const time = now();
            if (time < heldUntil) {
                await sleep(Math.ceil(heldUntil - time));
                continue;
            }
            while (taken.length > 0 && taken[0] <= time - periodMs) {
                taken.shift();
            }
            if (taken.length < budget()) {
                taken.push(time);
                return;
            }
            // Rounded up: setTimeout truncates, and waking early only loops.
            await sleep(Math.ceil(taken[0] + periodMs - time));
        }
    }

    return {
        acquire() {
            const turn = queue.then(takeToken);
            // A failed wait rejects its own caller, never the ones queued behind.
            queue = turn.catch(() => {});
            return turn;
        },
        observe({ status, headers }) {
            const info = readRateLimit(headers);
            limit = info.limit ?? limit;
            periodMs = info.periodSeconds === undefined ? periodMs : info.periodSeconds * 1000;
            if (status === 429) {
                // Retry-After says when the window rolls over, so it wins over
                // the count, which a 429 always has past the limit.
                const seconds = readRetryAfter(headers);
                const waitMs = seconds === undefined ? periodMs : seconds * 1000;
                pause(Math.min(waitMs, MAX_PACED_WAIT_SECONDS * 1000));
            } else if (info.count !== undefined && info.count >= budget()) {
                // PCO does not say when its window started, so only a whole
                // period from now is sure to be past it.
                pause(periodMs);
            }
        },
        pause,
        limits: () => ({ limit, periodMs, budget: budget() }),
    };
}

/**
 * Where the shared pacer lives on globalThis. Whichever copy of this module
 * asks first creates it, and it is kept for the life of the process, so a
 * pacer of another shape would never replace it, not even on a dev server's
 * hot reload. Bump the version whenever the pacer's shape or defaults change.
 * Exported for stubPcoPacer in testing.ts.
 */
export const PACER_GLOBAL = Symbol.for("service-integrator.pcoPacer.v2");

/**
 * The pacer that every paced request in the process waits on, created on
 * first use. It lives on globalThis, not in a module-level constant, because
 * this module is loaded more than once: a server action that a client
 * component imports is compiled in its own module layer (convention 15), and
 * instrumentation.ts, which starts the scheduled sync jobs, is bundled apart
 * from the pages. A bucket per copy would let through a multiple of the rate,
 * and what one copy learns from PCO's headers would be lost on the others.
 */
export function pcoPacer(): Pacer {
    const scope = globalThis as unknown as { [PACER_GLOBAL]?: Pacer };
    return (scope[PACER_GLOBAL] ??= createPacer());
}
