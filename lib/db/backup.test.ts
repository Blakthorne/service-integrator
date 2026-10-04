import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
    BACKUPS_TO_KEEP,
    backupDatabase,
    backupFileName,
    backupTakenAt,
    isBackupDue,
    listBackups,
    pruneBackups,
} from "./backup";
import { openDatabase } from "./connection";
import { openTestDb } from "./testing";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const T0 = new Date("2026-10-03T12:00:00.000Z");

/** `days` days after T0. */
const day = (days: number) => new Date(T0.getTime() + days * DAY_MS);

let dir: string;
let db: DatabaseSync;

beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "si-db-backup-"));
    db = openTestDb();
});

afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
});

/** An empty file named like a backup taken at `at`. */
function fakeBackup(at: Date): string {
    const file = path.join(dir, backupFileName(at));
    writeFileSync(file, "");
    return file;
}

describe("backup file names", () => {
    test("encode the time in a name that sorts by it", () => {
        expect(backupFileName(T0)).toBe(
            "service-integrator-2026-10-03T12-00-00-000Z.sqlite"
        );
        expect(backupFileName(day(1)) > backupFileName(T0)).toBe(true);
    });

    test("decode back to the time", () => {
        expect(backupTakenAt(backupFileName(T0))).toBe("2026-10-03T12:00:00.000Z");
        const odd = new Date("2027-01-31T23:59:59.999Z");
        expect(backupTakenAt(backupFileName(odd))).toBe(odd.toISOString());
    });

    test("anything else is not a backup", () => {
        for (const name of [
            "notes.txt",
            "service-integrator.sqlite",
            "service-integrator-latest.sqlite",
            "service-integrator-2026-10-03T12-00-00-000Z.sqlite.partial",
            "service-integrator-2026-10-03T12-00-00-000Z.sqlite-wal",
            "service-integrator-2026-02-30T12-00-00-000Z.sqlite",
            "service-integrator-2026-10-03T12:00:00.000Z.sqlite",
        ]) {
            expect(backupTakenAt(name)).toBeNull();
        }
    });
});

describe("listBackups", () => {
    test("lists the backups newest first, ignoring other files", () => {
        const older = fakeBackup(T0);
        const newer = fakeBackup(day(1));
        writeFileSync(path.join(dir, "notes.txt"), "");
        expect(listBackups(dir)).toEqual([
            { file: newer, takenAt: day(1).toISOString() },
            { file: older, takenAt: T0.toISOString() },
        ]);
    });

    test("finds none in a folder that does not exist", () => {
        expect(listBackups(path.join(dir, "missing"))).toEqual([]);
    });
});

describe("isBackupDue", () => {
    test("is due when there is no backup", () => {
        expect(isBackupDue(path.join(dir, "missing"), T0)).toBe(true);
        expect(isBackupDue(dir, T0)).toBe(true);
    });

    test("is due once the newest backup is a day old", () => {
        fakeBackup(day(-3));
        fakeBackup(T0);
        expect(isBackupDue(dir, new Date(T0.getTime() + 23 * HOUR_MS))).toBe(false);
        expect(isBackupDue(dir, new Date(T0.getTime() + DAY_MS - 1))).toBe(false);
        expect(isBackupDue(dir, day(1))).toBe(true);
    });
});

describe("backupDatabase", () => {
    test("writes a copy of the database, creating the folder", () => {
        db.prepare(
            "INSERT INTO settings (key, value, updated_at) VALUES ('ccliLicenseNumber', '\"1564484\"', ?)"
        ).run(T0.toISOString());
        const folder = path.join(dir, "backups");

        const { file, pruned } = backupDatabase(db, { dir: folder, at: T0 });
        expect(file).toBe(path.join(folder, backupFileName(T0)));
        expect(pruned).toEqual([]);
        expect(readdirSync(folder)).toEqual([backupFileName(T0)]);

        const copy = openDatabase(file);
        try {
            expect(copy.prepare("SELECT key, value FROM settings").all()).toEqual([
                { key: "ccliLicenseNumber", value: '"1564484"' },
            ]);
            expect(
                copy.prepare("SELECT id FROM schema_migrations").all()
            ).toEqual([{ id: "0001_init" }]);
        } finally {
            copy.close();
        }
    });

    test(`keeps the newest ${BACKUPS_TO_KEEP} backups and never deletes other files`, () => {
        writeFileSync(path.join(dir, "notes.txt"), "");
        const files: string[] = [];
        for (let i = 0; i < BACKUPS_TO_KEEP + 2; i++) {
            const { file, pruned } = backupDatabase(db, { dir, at: day(i) });
            files.push(file);
            expect(pruned).toEqual(
                i < BACKUPS_TO_KEEP ? [] : [files[i - BACKUPS_TO_KEEP]]
            );
        }
        expect(listBackups(dir).map(({ file }) => file)).toEqual(
            files.slice(2).reverse()
        );
        expect(existsSync(path.join(dir, "notes.txt"))).toBe(true);
    });

    test("honours a smaller keep", () => {
        backupDatabase(db, { dir, at: T0, keep: 2 });
        backupDatabase(db, { dir, at: day(1), keep: 2 });
        const { pruned } = backupDatabase(db, { dir, at: day(2), keep: 2 });
        expect(pruned).toEqual([path.join(dir, backupFileName(T0))]);
        expect(listBackups(dir)).toHaveLength(2);
    });

    test("cleans up a partial backup left by an earlier crash", () => {
        const leftover = `${path.join(dir, backupFileName(T0))}.partial`;
        writeFileSync(leftover, "half a database");
        backupDatabase(db, { dir, at: day(1) });
        expect(existsSync(leftover)).toBe(false);
        expect(readdirSync(dir)).toEqual([backupFileName(day(1))]);
    });

    test("fails without leaving a partial file", () => {
        mkdirSync(dir, { recursive: true });
        db.exec("BEGIN");
        try {
            expect(() => backupDatabase(db, { dir, at: T0 })).toThrow(
                /cannot VACUUM from within a transaction/
            );
        } finally {
            db.exec("ROLLBACK");
        }
        expect(readdirSync(dir)).toEqual([]);
    });
});

describe("pruneBackups", () => {
    test("refuses to keep fewer than one backup", () => {
        fakeBackup(T0);
        expect(() => pruneBackups(dir, 0)).toThrow(RangeError);
        expect(listBackups(dir)).toHaveLength(1);
    });
});
