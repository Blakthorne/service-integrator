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
    /** Recompute from Planning Center now and, if that works, replace the cached result. */
    refresh?: boolean;
}

/**
 * The hymnbook entries that have never been scheduled in Planning Center,
 * computed from the whole PCO song library. The result is cached for an hour,
 * and concurrent calls share one load.
 *
 * `refresh: true` always recomputes, and replaces the cached result only once
 * that succeeds: a failed refresh throws and leaves the previous result in
 * place, so page loads are still served from it while Planning Center is
 * down. Errors from PCO pass through and are never cached, so after a failed
 * plain call (nothing cached to serve) the next call tries again.
 */
export async function getUnusedHymns({
    refresh = false,
}: GetUnusedHymnsOptions = {}): Promise<UnusedHymnsResult> {
    const load = async () =>
        computeUnusedHymns(
            hymnCatalog,
            await fetchAllSongs(),
            new Date().toISOString()
        );
    return refresh ? cache.refresh(CACHE_KEY, load) : cache.get(CACHE_KEY, load);
}
