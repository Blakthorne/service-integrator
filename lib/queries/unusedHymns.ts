import "server-only";
import { hymnCatalog } from "@/lib/hymnCatalog";
import { fetchAllSongs } from "@/lib/pco";
import { createTtlCache, type TtlCache } from "@/lib/ttlCache";
import { computeUnusedHymns, type UnusedHymnsResult } from "@/lib/unusedHymns";

const UNUSED_HYMNS_TTL_MS = 60 * 60 * 1000; // 1 hour

const CACHE_KEY = "unused-hymns";

const CACHE_GLOBAL = "__unusedHymnsCache";

/**
 * The cache is process-local, so shared by every request on a single
 * long-running server (this app's PM2 deploy); on a multi-instance or
 * serverless host each instance has its own.
 *
 * It lives on globalThis, not in a module-level constant, because this module
 * is loaded twice: a server action that a client component imports is
 * compiled in its own module layer, apart from the page that renders the
 * result. Two module-level caches would mean Refresh updates one while the
 * page goes on reading the other, stale for up to an hour. Every copy of the
 * module in the process shares globalThis.
 */
function sharedCache(): TtlCache<string, UnusedHymnsResult> {
    const scope = globalThis as unknown as {
        [CACHE_GLOBAL]?: TtlCache<string, UnusedHymnsResult>;
    };
    return (scope[CACHE_GLOBAL] ??= createTtlCache<string, UnusedHymnsResult>({
        ttlMs: UNUSED_HYMNS_TTL_MS,
    }));
}

const cache = sharedCache();

/** Options for getUnusedHymns. */
export interface GetUnusedHymnsOptions {
    /** Drop the cached result and recompute it from Planning Center now. */
    refresh?: boolean;
}

/**
 * The hymnbook entries that have never been scheduled in Planning Center,
 * computed from the whole PCO song library. The result is cached for an hour,
 * and concurrent calls share one load.
 *
 * `refresh: true` invalidates the cache first, so the result is always newly
 * computed and is what later calls get. Errors from PCO pass through and are
 * never cached, so the next call tries again. Note that a failed refresh has
 * already dropped the previous result.
 */
export async function getUnusedHymns({
    refresh = false,
}: GetUnusedHymnsOptions = {}): Promise<UnusedHymnsResult> {
    if (refresh) {
        cache.invalidate(CACHE_KEY);
    }
    return cache.get(CACHE_KEY, async () =>
        computeUnusedHymns(
            hymnCatalog,
            await fetchAllSongs(),
            new Date().toISOString()
        )
    );
}
