import { describe, expect, test } from "vitest";
import {
    EXPORT_BACKUP_NOTE,
    EXPORT_BUTTON_LABEL,
    EXPORT_DESCRIPTION,
    EXPORT_FAILED_MESSAGE,
    describeExported,
} from "./exportText";

describe("the export's words", () => {
    test("the button is named for what it downloads", () => {
        expect(EXPORT_BUTTON_LABEL).toBe("Export catalog (JSON)");
    });

    test("the description says that two exports diff cleanly in git, and what is in one", () => {
        expect(EXPORT_DESCRIPTION).toContain("two exports diff cleanly in git");
        for (const part of ["books", "hymns", "tunes", "songs", "entries", "marks"]) {
            expect(EXPORT_DESCRIPTION).toContain(part);
        }
    });

    test("the note says what the export leaves out, beside the database's own backups", () => {
        expect(EXPORT_BACKUP_NOTE).toContain("backed up every day");
        expect(EXPORT_BACKUP_NOTE).toContain("settings");
    });

    test("a failure says nothing was downloaded", () => {
        expect(EXPORT_FAILED_MESSAGE).toContain("nothing was downloaded");
    });

    test("names the file that was downloaded", () => {
        expect(describeExported("catalog-2026-10-04.json")).toBe("Downloaded catalog-2026-10-04.json.");
    });
});
