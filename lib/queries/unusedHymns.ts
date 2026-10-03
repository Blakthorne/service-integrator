import "server-only";
import { hymnCatalog } from "@/lib/hymnCatalog";
import { fetchAllSongs } from "@/lib/pco";
import { createTtlCache } from "@/lib/ttlCache";
import { computeUnusedHymns, type UnusedHymnsResult } from "@/lib/unusedHymns";

const UNUSED_HYMNS_TTL_MS = 60 * 60 * 1000; // 1 hour

const CACHE_KEY = "unused-hymns";

// Process-local, so shared by every request on a single long-running server
// (this app's PM2 deploy). On a multi-instance or serverless host each
// instance has its own copy.
const cache = createTtlCache<string, UnusedHymnsResult>({
    ttlMs: UNUSED_HYMNS_TTL_MS,
});

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
