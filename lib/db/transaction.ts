import "server-only";
import type { DatabaseSync } from "node:sqlite";

/**
 * Where the open-transaction depth of each connection lives. It is on
 * globalThis, like the connection `getDb()` caches, because Next bundles this
 * module more than once (convention 15) and every copy must agree on whether
 * a connection is inside a transaction. Bump the version if its shape changes.
 */
const DEPTHS_GLOBAL = Symbol.for("service-integrator.db.transactionDepths.v1");

function transactionDepths(): WeakMap<DatabaseSync, number> {
    const scope = globalThis as unknown as {
        [DEPTHS_GLOBAL]?: WeakMap<DatabaseSync, number>;
    };
    return (scope[DEPTHS_GLOBAL] ??= new WeakMap());
}

function isPromiseLike(value: unknown): boolean {
    return (
        (typeof value === "object" || typeof value === "function") &&
        value !== null &&
        typeof (value as { then?: unknown }).then === "function"
    );
}

/** Undo the current transaction or savepoint, if SQLite has not already. */
function rollBack(db: DatabaseSync, sql: string): void {
    try {
        db.exec(sql);
    } catch {
        // Some failures (a full disk, a conflict clause of ROLLBACK) make
        // SQLite roll the whole transaction back itself, so there is nothing
        // left to undo. The caller rethrows the original error.
    }
}

/**
 * Run `fn` in a transaction and return its result: commit when it returns,
 * roll back and rethrow when it throws (a failed commit rolls back too).
 *
 * `fn` must be synchronous. `node:sqlite` is synchronous, so nothing else runs
 * on the connection while `fn` does; a function that awaits would let other
 * requests' statements into the transaction, and its own writes after the
 * await would run outside it. Returning a promise is therefore an error: the
 * transaction is rolled back and a TypeError thrown.
 *
 * The outermost call starts with `BEGIN IMMEDIATE`, which takes the write lock
 * up front (waiting up to the busy timeout for another connection), so it never
 * fails halfway through on a lock. A call inside another is a savepoint: its
 * failure undoes only its own writes, and the outer `fn` may catch the error
 * and carry on. Never run BEGIN, COMMIT or ROLLBACK yourself on a connection
 * that uses this.
 */
export function withTransaction<T>(db: DatabaseSync, fn: () => T): T {
    const depths = transactionDepths();
    const depth = depths.get(db) ?? 0;
    const savepoint = `nested_${depth}`;
    db.exec(depth === 0 ? "BEGIN IMMEDIATE" : `SAVEPOINT ${savepoint}`);
    depths.set(db, depth + 1);
    try {
        const result = fn();
        if (isPromiseLike(result)) {
            throw new TypeError(
                "withTransaction needs a synchronous function, but this one returned a promise: its writes after an await would run outside the transaction."
            );
        }
        db.exec(depth === 0 ? "COMMIT" : `RELEASE ${savepoint}`);
        return result;
    } catch (error) {
        rollBack(
            db,
            depth === 0
                ? "ROLLBACK"
                : `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`
        );
        throw error;
    } finally {
        depths.set(db, depth);
    }
}
