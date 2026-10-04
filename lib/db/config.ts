import "server-only";
import path from "node:path";

/** The database file when `DATABASE_PATH` is not set, relative to the working directory. */
export const DEFAULT_DATABASE_PATH = "./data/service-integrator.sqlite";

/** The backup folder when `DATABASE_BACKUP_DIR` is not set, relative to the working directory. */
export const DEFAULT_BACKUP_DIR = "./data/backups";

type Env = Record<string, string | undefined>;

/**
 * The database file: `DATABASE_PATH`, or the default, resolved against `cwd`.
 * An empty value counts as unset. Production sets an absolute path outside
 * the folder each deploy extracts into.
 */
export function databasePath(
    env: Env = process.env,
    cwd: string = process.cwd()
): string {
    return path.resolve(cwd, env.DATABASE_PATH || DEFAULT_DATABASE_PATH);
}

/** The backup folder: `DATABASE_BACKUP_DIR`, or the default, resolved against `cwd`. */
export function backupDirectory(
    env: Env = process.env,
    cwd: string = process.cwd()
): string {
    return path.resolve(cwd, env.DATABASE_BACKUP_DIR || DEFAULT_BACKUP_DIR);
}
