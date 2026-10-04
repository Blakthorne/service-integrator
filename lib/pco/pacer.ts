import "server-only";

/**
 * At most PACER_LIMIT paced requests start in any PACER_WINDOW_MS. PCO allows
 * the whole org 100 requests per 20 s, so 20 are left for page loads, which
 * are never paced, while a sync job runs.
 */
export const PACER_LIMIT = 80;
export const PACER_WINDOW_MS = 20_000;

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

/** Rations the requests of sync jobs to Planning Center. */
export interface Pacer {
    /**
     * Resolves when one more request may start, using up one turn. Callers
     * are served in the order they call.
     */
    acquire(): Promise<void>;
}

/** Options for createPacer; tests inject both. */
export interface PacerOptions {
    /** A monotonic clock in milliseconds. Defaults to performance.now. */
    now?: () => number;
    /** Wait `ms` milliseconds. Defaults to setTimeout. */
    sleep?: (ms: number) => Promise<void>;
}

/**
 * A token bucket of PACER_LIMIT tokens in which each request takes one and
 * every token comes back PACER_WINDOW_MS after it was taken (not at a steady
 * rate, which would let a full bucket's burst plus the refill exceed PCO's
 * limit). So the first PACER_LIMIT requests start at once, the next waits
 * until the first is a window old, and no window, fixed or sliding, ever
 * holds more than PACER_LIMIT starts. The default clock is monotonic, so a
 * wall-clock change cannot stall a sync or release a burst.
 */
export function createPacer({
    now = () => performance.now(),
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}: PacerOptions = {}): Pacer {
    // When each token still out was taken, oldest first.
    const taken: number[] = [];
    // Turns are granted one at a time, in call order.
    let queue: Promise<void> = Promise.resolve();

    async function takeToken(): Promise<void> {
        for (;;) {
            const time = now();
            while (taken.length > 0 && taken[0] <= time - PACER_WINDOW_MS) {
                taken.shift();
            }
            if (taken.length < PACER_LIMIT) {
                taken.push(time);
                return;
            }
            // Rounded up: setTimeout truncates, and waking early only loops.
            await sleep(Math.ceil(taken[0] + PACER_WINDOW_MS - time));
        }
    }

    return {
        acquire() {
            const turn = queue.then(takeToken);
            // A failed wait rejects its own caller, never the ones queued behind.
            queue = turn.catch(() => {});
            return turn;
        },
    };
}

/**
 * Where the shared pacer lives on globalThis. Whichever copy of this module
 * asks first creates it, and it is kept for the life of the process, so a
 * pacer with other limits would never replace it, not even on a dev server's
 * hot reload. Bump the version whenever the pacer's shape or limits change.
 */
const PACER_GLOBAL = Symbol.for("service-integrator.pcoPacer.v1");

/**
 * The pacer that every paced request in the process waits on, created on
 * first use. It lives on globalThis, not in a module-level constant, because
 * this module is loaded more than once: a server action that a client
 * component imports is compiled in its own module layer (convention 15), and
 * instrumentation.ts, which starts the scheduled sync jobs, is bundled apart
 * from the pages. A bucket per copy would let through a multiple of the rate.
 */
export function pcoPacer(): Pacer {
    const scope = globalThis as unknown as { [PACER_GLOBAL]?: Pacer };
    return (scope[PACER_GLOBAL] ??= createPacer());
}
