import type { Migration } from ".";

/**
 * Settings and the log of background runs.
 *
 * - `settings`: one row per key, its value as JSON text.
 * - `sync_runs`: one row per run of a background job (the daily backup now;
 *   Planning Center syncs later). `kind` is checked in TypeScript
 *   (`SYNC_RUN_KINDS` in `lib/db/syncRuns.ts`) rather than with a CHECK, so a
 *   new kind needs no migration. `finished_at` and `ok` are both null while a
 *   run is in progress. `counts` is a JSON object of numbers.
 *
 * Timestamps are ISO 8601 UTC text (`2026-10-03T12:00:00.000Z`), which sorts
 * by time.
 */
const migration: Migration = {
    id: "0001_init",
    sql: `
        CREATE TABLE settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL CHECK (json_valid(value)),
            updated_at TEXT NOT NULL
        ) STRICT;

        CREATE TABLE sync_runs (
            id INTEGER PRIMARY KEY,
            kind TEXT NOT NULL,
            started_at TEXT NOT NULL,
            finished_at TEXT,
            ok INTEGER CHECK (ok IN (0, 1)),
            message TEXT,
            counts TEXT CHECK (json_valid(counts)),
            CHECK ((finished_at IS NULL) = (ok IS NULL))
        ) STRICT;

        CREATE INDEX sync_runs_kind ON sync_runs (kind);
    `,
};

export default migration;
