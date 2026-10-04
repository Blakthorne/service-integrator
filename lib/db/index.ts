import "server-only";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { databasePath } from "./config";
import { openDatabase } from "./connection";
import { errorMessage } from "./errors";
import { migrate } from "./migrate";

export { backupDirectory, databasePath } from "./config";
export { withTransaction } from "./transaction";

/**
 * Where the open connection lives. It is on globalThis, not in a module
 * constant, because Next bundles this module more than once (the
 * instrumentation hook, server components and server actions each get a
 * copy; see convention 15), and all of them must share one connection. Bump
 * the version if what is stored here changes.
 */
const DB_GLOBAL = Symbol.for("service-integrator.db.v1");

function openAppDatabase(file: string): DatabaseSync {
    try {
        mkdirSync(path.dirname(file), { recursive: true });
        const db = openDatabase(file);
        try {
            for (const id of migrate(db).applied) {
                console.log(`Database ${file}: applied migration ${id}`);
            }
        } catch (error) {
            db.close();
            throw error;
        }
        return db;
    } catch (error) {
        throw new Error(
            `Could not open the database at ${file}: ${errorMessage(error)}`,
            { cause: error }
        );
    }
}

/**
 * The app's database, opened on first use: the file at `DATABASE_PATH`
 * (default `./data/service-integrator.sqlite`, relative to the working
 * directory), its folder created if missing, with the connection settings of
 * `openDatabase` (WAL, foreign keys, busy timeout) and every migration applied.
 * Later calls return the same connection.
 *
 * Nothing opens the database at import time, so `next build`, which has no
 * database, never does. Throws an error naming the file when it cannot be
 * opened or migrated (or `node:sqlite` is missing); nothing is cached then, so
 * the next call tries again.
 */
export function getDb(): DatabaseSync {
    const scope = globalThis as unknown as { [DB_GLOBAL]?: DatabaseSync };
    return (scope[DB_GLOBAL] ??= openAppDatabase(databasePath()));
}
