import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { errorMessage } from "./errors";

/**
 * Thrown by `withTransaction` when SQLite rolled the whole transaction back by
 * itself under a nested call (some errors do that: a conflict clause of
 * ROLLBACK, a full disk, an I/O error). Every call still open on the
 * connection then fails with this same error, so nothing is committed, even
 * where an outer function caught it and carried on. Its `cause` is the error
 * that brought the transaction down.
 */
export class TransactionAbortedError extends Error {
    constructor(cause: unknown) {
        super(
            `SQLite rolled back the whole transaction: ${errorMessage(cause)}`,
            { cause }
        );
        this.name = "TransactionAbortedError";
    }
}

/** The `withTransaction` calls open on one connection. */
interface TransactionState {
    /** How many are open: 0 outside a transaction. */
    depth: number;
    /** Set once SQLite has rolled the transaction back under a nested call. */
    aborted: TransactionAbortedError | null;
}

/**
 * Where each connection's transaction state lives. It is on globalThis, like
 * the connection `getDb()` caches, because Next bundles this module more than
 * once (convention 15) and every copy must agree on whether a connection is
 * inside a transaction. `node:sqlite` cannot say (`isTransaction` needs Node
 * 22.16). Bump the version if the state's shape changes.
 */
const STATES_GLOBAL = Symbol.for("service-integrator.db.transactions.v2");

function transactionState(db: DatabaseSync): TransactionState {
    const scope = globalThis as unknown as {
        [STATES_GLOBAL]?: WeakMap<DatabaseSync, TransactionState>;
    };
    const states = (scope[STATES_GLOBAL] ??= new WeakMap());
    let state = states.get(db);
    if (!state) {
        state = { depth: 0, aborted: null };
        states.set(db, state);
    }
    return state;
}

function isPromiseLike(value: unknown): boolean {
    return (
        (typeof value === "object" || typeof value === "function") &&
        value !== null &&
        typeof (value as { then?: unknown }).then === "function"
    );
}

/** Run `sql`; false if it failed. */
function tryExec(db: DatabaseSync, sql: string): boolean {
    try {
        db.exec(sql);
        return true;
    } catch {
        return false;
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
 * and carry on.
 *
 * Except when SQLite rolls the whole transaction back by itself under a nested
 * call: the savepoint is then gone, so that call opens a stand-in transaction
 * (anything the callers write before they give up stays inside it, rather than
 * committing on its own) and throws a `TransactionAbortedError`. Every call
 * still open fails with that error, even one whose `fn` caught it, and the
 * outermost rolls the stand-in back, so nothing commits. The same can happen
 * to a statement `fn` runs itself, and `withTransaction` cannot see it: so
 * catch a statement's error inside `fn` only around a nested `withTransaction`.
 * Never run BEGIN, COMMIT or ROLLBACK yourself on a connection that uses this.
 */
export function withTransaction<T>(db: DatabaseSync, fn: () => T): T {
    const state = transactionState(db);
    const depth = state.depth;
    if (depth === 0) {
        state.aborted = null;
    } else if (state.aborted) {
        // The transaction this call would join is gone.
        throw state.aborted;
    }
    const savepoint = `nested_${depth}`;
    db.exec(depth === 0 ? "BEGIN IMMEDIATE" : `SAVEPOINT ${savepoint}`);
    state.depth = depth + 1;
    try {
        const result = fn();
        if (isPromiseLike(result)) {
            throw new TypeError(
                "withTransaction needs a synchronous function, but this one returned a promise: its writes after an await would run outside the transaction."
            );
        }
        if (state.aborted) {
            // fn caught a nested call's TransactionAbortedError and carried on.
            throw state.aborted;
        }
        db.exec(depth === 0 ? "COMMIT" : `RELEASE ${savepoint}`);
        return result;
    } catch (error) {
        if (depth === 0) {
            // Fails, harmlessly, when SQLite has already rolled back.
            tryExec(db, "ROLLBACK");
            const aborted = state.aborted;
            state.aborted = null;
            throw aborted ?? error;
        }
        if (
            !state.aborted &&
            !tryExec(db, `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`)
        ) {
            // The savepoint is gone, so SQLite rolled the whole transaction
            // back. Open a stand-in, so that later writes cannot commit on
            // their own (it fails, keeping them in, if a transaction is still
            // open after all), and fail every open call.
            state.aborted = new TransactionAbortedError(error);
            tryExec(db, "BEGIN");
        }
        throw state.aborted ?? error;
    } finally {
        state.depth = depth;
    }
}
