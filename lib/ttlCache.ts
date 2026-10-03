/** Options for createTtlCache. */
export interface TtlCacheOptions {
    /** How long a loaded value stays fresh, in milliseconds. */
    ttlMs: number;
    /** The clock in epoch milliseconds; tests inject one. Defaults to Date.now. */
    now?: () => number;
}

/** An in-memory, per-process cache of async results with a fixed lifetime. */
export interface TtlCache<K, V> {
    /**
     * The cached value for `key` if it is still fresh; otherwise `load()`'s
     * result, which is cached for `ttlMs` from when it resolves. A rejected
     * load is never cached. Concurrent calls for a key share one load.
     */
    get(key: K, load: () => Promise<V>): Promise<V>;
    /**
     * Load a new value for `key` and store it in place of the current one,
     * even if that is still fresh (for a "refresh" button). The stored value is
     * replaced only once the load succeeds: a rejected load is rethrown and
     * leaves the previous value in place, so it keeps being served until its
     * own TTL is up. While the refresh loads, `get` still serves that previous
     * value; a `get` with nothing fresh to serve joins the refresh.
     *
     * A refresh never joins a load already in flight: it starts its own and
     * supersedes the earlier one, whose callers still get its result but whose
     * result is not stored.
     */
    refresh(key: K, load: () => Promise<V>): Promise<V>;
    /** Forget `key`. A load already in flight for it will not be stored. */
    invalidate(key: K): void;
    /** Forget every key, including loads in flight. */
    clear(): void;
}

/**
 * Create a TtlCache. The cache lives as long as the module holding it, so on
 * a single long-running server (this app's deploy) it is shared by all
 * requests; on a multi-instance host each instance has its own. Expired
 * entries are dropped whenever a new value is stored.
 */
export function createTtlCache<K, V>({
    ttlMs,
    now = Date.now,
}: TtlCacheOptions): TtlCache<K, V> {
    const values = new Map<K, { value: V; expiresAt: number }>();
    const inFlight = new Map<K, Promise<V>>();

    function store(key: K, value: V): void {
        const time = now();
        for (const [k, entry] of values) {
            if (entry.expiresAt <= time) {
                values.delete(k);
            }
        }
        values.set(key, { value, expiresAt: time + ttlMs });
    }

    /**
     * Start loading `key` and register the load, so a concurrent `get` joins
     * it. Its result is stored only if it is still the registered load when it
     * settles; a failure stores nothing and leaves any stored value alone.
     */
    function startLoad(key: K, load: () => Promise<V>): Promise<V> {
        // Calling load() from a `then` turns a synchronous throw into a
        // rejection, and runs it only once `promise` is registered.
        const promise: Promise<V> = Promise.resolve()
            .then(load)
            .then(
                (value) => {
                    // Skip the store if invalidate()/clear() or a newer load
                    // ran meanwhile.
                    if (inFlight.get(key) === promise) {
                        inFlight.delete(key);
                        store(key, value);
                    }
                    return value;
                },
                (error: unknown) => {
                    if (inFlight.get(key) === promise) {
                        inFlight.delete(key);
                    }
                    throw error;
                }
            );
        inFlight.set(key, promise);
        return promise;
    }

    return {
        get(key, load) {
            const cached = values.get(key);
            if (cached && cached.expiresAt > now()) {
                return Promise.resolve(cached.value);
            }
            return inFlight.get(key) ?? startLoad(key, load);
        },
        refresh(key, load) {
            return startLoad(key, load);
        },
        invalidate(key) {
            values.delete(key);
            inFlight.delete(key);
        },
        clear() {
            values.clear();
            inFlight.clear();
        },
    };
}
