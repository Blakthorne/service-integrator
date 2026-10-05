import "server-only";
import type * as NodeSqlite from "node:sqlite";
import type { DatabaseSync } from "node:sqlite";

/** How long a statement waits for another connection's lock before failing with SQLITE_BUSY. */
export const BUSY_TIMEOUT_MS = 5000;

/**
 * Node's built-in SQLite module.
 *
 * It is loaded with `process.getBuiltinModule` rather than a static
 * `import … from "node:sqlite"`. Webpack (`next build`) and Turbopack
 * (`next dev`) both handle the static import, but Vitest 2 strips the `node:`
 * prefix from built-in modules, and `sqlite` exists only under the prefix.
 * Loading it at first use also makes a Node without it a clear error from
 * `getDb()`, instead of a failure to load every module that imports this one.
 */
export function loadSqlite(): typeof NodeSqlite {
    let sqlite: typeof NodeSqlite | undefined;
    try {
        sqlite = process.getBuiltinModule?.("node:sqlite");
    } catch {
        sqlite = undefined;
    }
    if (!sqlite) {
        throw new Error(
            `The database needs node:sqlite, which Node 22.13 or later provides; this is Node ${process.version}.`
        );
    }
    return sqlite;
}

/**
 * Open a database with the app's connection settings: a busy timeout, the WAL
 * journal and foreign keys on. `location` is a file path or `":memory:"` (an
 * in-memory database keeps its "memory" journal). It does not migrate: the app
 * opens its database through `getDb()`, and tests through `openTestDb()`.
 */
export function openDatabase(location: string): DatabaseSync {
    const { DatabaseSync } = loadSqlite();
    const db = new DatabaseSync(location);
    try {
        // The timeout comes first, so that switching the journal to WAL waits
        // for another connection's lock instead of failing at once.
        db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
        db.exec("PRAGMA journal_mode = WAL");
        db.exec("PRAGMA foreign_keys = ON");
    } catch (error) {
        db.close();
        throw error;
    }
    return db;
}
