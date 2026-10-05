import { describe, expect, test } from "vitest";
import { backupDirectory, databasePath } from "./config";

describe("databasePath", () => {
    test("defaults to data/service-integrator.sqlite in the working directory", () => {
        expect(databasePath({}, "/srv/app")).toBe(
            "/srv/app/data/service-integrator.sqlite"
        );
    });

    test("resolves a relative DATABASE_PATH against the working directory", () => {
        expect(databasePath({ DATABASE_PATH: "db/app.sqlite" }, "/srv/app")).toBe(
            "/srv/app/db/app.sqlite"
        );
    });

    test("keeps an absolute DATABASE_PATH", () => {
        expect(
            databasePath({ DATABASE_PATH: "/var/lib/si/app.sqlite" }, "/srv/app")
        ).toBe("/var/lib/si/app.sqlite");
    });

    test("treats an empty DATABASE_PATH as unset", () => {
        expect(databasePath({ DATABASE_PATH: "" }, "/srv/app")).toBe(
            "/srv/app/data/service-integrator.sqlite"
        );
    });

    test("reads process.env and the working directory by default", () => {
        expect(databasePath()).toBe(
            databasePath(process.env, process.cwd())
        );
    });
});

describe("backupDirectory", () => {
    test("defaults to data/backups in the working directory", () => {
        expect(backupDirectory({}, "/srv/app")).toBe("/srv/app/data/backups");
    });

    test("resolves a relative DATABASE_BACKUP_DIR against the working directory", () => {
        expect(
            backupDirectory({ DATABASE_BACKUP_DIR: "../backups" }, "/srv/app")
        ).toBe("/srv/backups");
    });

    test("keeps an absolute DATABASE_BACKUP_DIR", () => {
        expect(
            backupDirectory({ DATABASE_BACKUP_DIR: "/var/backups/si" }, "/srv/app")
        ).toBe("/var/backups/si");
    });

    test("treats an empty DATABASE_BACKUP_DIR as unset", () => {
        expect(backupDirectory({ DATABASE_BACKUP_DIR: "" }, "/srv/app")).toBe(
            "/srv/app/data/backups"
        );
    });
});
