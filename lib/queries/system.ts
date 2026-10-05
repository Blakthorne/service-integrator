import "server-only";
import { backupDirectory, databasePath, getDb } from "@/lib/db";
import { errorMessage } from "@/lib/db/errors";
import { countHistory, type HistoryCounts } from "@/lib/db/history";
import { appliedMigrations } from "@/lib/db/migrate";
import { latestSyncRun, type SyncRun } from "@/lib/db/syncRuns";

/** The database's state, for the Settings page. */
export type DatabaseStatus =
    | {
          ok: true;
          /** The database file. */
          path: string;
          /** How many migrations the database records. */
          appliedMigrations: number;
          /** The newest migration's id, or null if there is none. */
          latestMigration: string | null;
          /** The latest backup run, finished or not, or null before the first. */
          lastBackup: SyncRun | null;
          /** The folder backups are written to. */
          backupDir: string;
      }
    | {
          ok: false;
          /** Why the database is unavailable. */
          error: string;
      };

/**
 * Whether the database opens, and its file, migrations and last backup.
 * Never throws: a failure is logged and returned as `{ ok: false, error }`.
 */
export function getDatabaseStatus(): DatabaseStatus {
    try {
        const db = getDb();
        const migrations = appliedMigrations(db);
        return {
            ok: true,
            path: databasePath(),
            appliedMigrations: migrations.length,
            latestMigration: migrations.at(-1)?.id ?? null,
            lastBackup: latestSyncRun(db, "backup"),
            backupDir: backupDirectory(),
        };
    } catch (error) {
        console.error("Database status unavailable:", error);
        return { ok: false, error: errorMessage(error) };
    }
}

/** The Planning Center song sync, for the Settings page: its latest run, or that it cannot be read. */
export type PcoSongsSyncStatus =
    | {
          ok: true;
          /** The latest run, finished or not, or null before the first. */
          lastRun: SyncRun | null;
      }
    | { ok: false };

/**
 * The latest run of the Planning Center song sync (`pco-songs`), for the
 * Settings page's sync card. Never throws: when the database cannot be read
 * it logs the error and gives `{ ok: false }`, and the Database card above
 * says why.
 */
export function getLastPcoSongsSync(): PcoSongsSyncStatus {
    try {
        return { ok: true, lastRun: latestSyncRun(getDb(), "pco-songs") };
    } catch (error) {
        console.error("Song sync status unavailable:", error);
        return { ok: false };
    }
}

/** The plan history sync, for the Settings page: its latest run, and what the history holds. */
export type HistorySyncStatus =
    | {
          ok: true;
          /** The latest run, finished or not, or null before the first. */
          lastRun: SyncRun | null;
          /** How many plans and song items the history holds, and the dates they span. */
          counts: HistoryCounts;
      }
    | { ok: false };

/**
 * The latest run of the plan history sync (`history`) and what the history
 * holds, for the Settings page's history card. Never throws: when the
 * database cannot be read it logs the error and gives `{ ok: false }`, and
 * the Database card says why.
 */
export function getLastHistorySync(): HistorySyncStatus {
    try {
        const db = getDb();
        return { ok: true, lastRun: latestSyncRun(db, "history"), counts: countHistory(db) };
    } catch (error) {
        console.error("History sync status unavailable:", error);
        return { ok: false };
    }
}
