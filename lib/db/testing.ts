import type { DatabaseSync } from "node:sqlite";
import { openDatabase } from "./connection";
import { migrate } from "./migrate";

/**
 * A new in-memory database with the app's connection settings and every
 * migration applied, for tests of `lib/db/*` (and of `lib/queries/*`, with
 * `getDb` mocked to return it). Each call is a separate, empty database.
 * Close it in `afterEach`.
 */
export function openTestDb(): DatabaseSync {
    const db = openDatabase(":memory:");
    migrate(db);
    return db;
}
