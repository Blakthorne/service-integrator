import "server-only";
import {
    closeSync,
    fsyncSync,
    mkdirSync,
    openSync,
    readdirSync,
    renameSync,
    rmSync,
} from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

/** How many backups `backupDatabase` keeps. */
export const BACKUPS_TO_KEEP = 14;

/** How old the newest backup may get before another is due. */
export const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** What a backup is written as until it is complete. */
const PARTIAL_SUFFIX = ".partial";

/** A backup file in the backup folder. */
export interface Backup {
    /** Its full path. */
    file: string;
    /** When it was taken (from its name), as ISO 8601 UTC. */
    takenAt: string;
}

/**
 * The name of a backup taken at `at`, such as
 * `service-integrator-2026-10-03T12-00-00-000Z.sqlite`. Names sort by time.
 */
export function backupFileName(at: Date): string {
    return `service-integrator-${at.toISOString().replace(/[:.]/g, "-")}.sqlite`;
}

const BACKUP_NAME =
    /^service-integrator-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.sqlite$/;

/** When the backup named `name` was taken, as ISO 8601 UTC, or null for any other name. */
export function backupTakenAt(name: string): string | null {
    const match = BACKUP_NAME.exec(name);
    if (!match) {
        return null;
    }
    const [, date, hours, minutes, seconds, millis] = match;
    const at = new Date(`${date}T${hours}:${minutes}:${seconds}.${millis}Z`);
    // The round trip rejects an impossible date, such as February 30.
    return !Number.isNaN(at.getTime()) && backupFileName(at) === name
        ? at.toISOString()
        : null;
}

function readFolder(dir: string): string[] {
    try {
        return readdirSync(dir);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return [];
        }
        throw error;
    }
}

/** The backups in `dir`, newest first. A folder that does not exist has none. */
export function listBackups(dir: string): Backup[] {
    return readFolder(dir)
        .flatMap((name) => {
            const takenAt = backupTakenAt(name);
            return takenAt ? [{ file: path.join(dir, name), takenAt }] : [];
        })
        .sort((a, b) => b.takenAt.localeCompare(a.takenAt));
}

/** Whether a backup is due at `now`: `dir` has none, or the newest is a day old or more. */
export function isBackupDue(dir: string, now: Date = new Date()): boolean {
    const [newest] = listBackups(dir);
    return (
        newest === undefined ||
        now.getTime() - Date.parse(newest.takenAt) >= BACKUP_INTERVAL_MS
    );
}

/**
 * Delete all but the newest `keep` backups in `dir`, and any partial backup
 * (left by a crash during a backup) older than the newest. Other files are
 * never touched. Returns the backups it deleted.
 */
export function pruneBackups(
    dir: string,
    keep: number = BACKUPS_TO_KEEP
): string[] {
    if (!(keep >= 1)) {
        throw new RangeError(`Keep at least one backup, not ${keep}`);
    }
    const backups = listBackups(dir);
    const stale = backups.slice(keep).map(({ file }) => file);
    for (const file of stale) {
        rmSync(file, { force: true });
    }

    const newest = backups[0]?.takenAt;
    for (const name of readFolder(dir)) {
        if (!name.endsWith(PARTIAL_SUFFIX)) {
            continue;
        }
        const takenAt = backupTakenAt(name.slice(0, -PARTIAL_SUFFIX.length));
        if (takenAt !== null && newest !== undefined && takenAt < newest) {
            rmSync(path.join(dir, name), { force: true });
        }
    }
    return stale;
}

/** Make sure a file's contents are on disk before it is renamed into place. */
function flushToDisk(file: string): void {
    const fd = openSync(file, "r+");
    try {
        fsyncSync(fd);
    } finally {
        closeSync(fd);
    }
}

/** Options for backupDatabase. */
export interface BackupOptions {
    /** The backup folder, created if missing. */
    dir: string;
    /** When the backup is taken, which names the file. Defaults to now. */
    at?: Date;
    /** How many backups to keep. */
    keep?: number;
}

/** What backupDatabase did. */
export interface BackupResult {
    /** The new backup. */
    file: string;
    /** The old backups it deleted. */
    pruned: string[];
}

/**
 * Write a consistent copy of `db` to a new file in `dir` with `VACUUM INTO`,
 * then prune the folder to the newest `keep` backups.
 *
 * The copy is written under a `.partial` name, flushed to disk (`VACUUM INTO`
 * does not) and only then renamed, so a crash part-way never leaves a file
 * that looks like a complete backup. It runs synchronously, blocking the
 * server for the few milliseconds the copy takes, and cannot run inside a
 * transaction. Throws on a failure, leaving no partial file.
 */
export function backupDatabase(
    db: DatabaseSync,
    { dir, at = new Date(), keep = BACKUPS_TO_KEEP }: BackupOptions
): BackupResult {
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, backupFileName(at));
    const partial = `${file}${PARTIAL_SUFFIX}`;
    try {
        db.prepare("VACUUM INTO ?").run(partial);
        flushToDisk(partial);
        renameSync(partial, file);
    } catch (error) {
        rmSync(partial, { force: true });
        throw error;
    }
    return { file, pruned: pruneBackups(dir, keep) };
}
