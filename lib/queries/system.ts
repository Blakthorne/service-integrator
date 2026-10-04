import "server-only";
import { backupDirectory, databasePath, getDb } from "@/lib/db";
import { errorMessage } from "@/lib/db/errors";
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
