import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { countCatalog } from "@/lib/db/catalog";
import { openTestDb, seedImportRun } from "@/lib/db/testing";

// vi.hoisted: vi.mock factories run before the module's own declarations.
const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/lib/db", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/db")>()),
    getDb,
}));

import {
    applyCatalogImport,
    discardCatalogImport,
    getCatalogImportRun,
    getCatalogImportRunLabel,
    getCatalogImportRuns,
    previewSeedImport,
} from "./catalogImport";

let db: DatabaseSync;

beforeEach(() => {
    db = openTestDb();
    getDb.mockReturnValue(db);
    vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
    db.close();
    getDb.mockReset();
    vi.restoreAllMocks();
});

const SEED_COUNTS = {
    books: 2,
    hymns: 895,
    hymnAliases: 4,
    tunes: 768,
    tuneAliases: 1,
    songs: 921,
    songsWithoutTune: 107,
    entries: 1247,
};

describe("the seed import, end to end", () => {
    test("previews the seed from hymns.json, applies it once, and refuses a second", () => {
        const first = previewSeedImport();
        expect(getCatalogImportRuns()).toEqual([
            expect.objectContaining({
                id: first,
                kind: "hymns-json",
                status: "preview",
                sourceName: "hymns.json",
                planned: SEED_COUNTS,
            }),
        ]);
        const review = getCatalogImportRun(first);
        expect(review?.applyRefusal).toBeNull();
        expect(review?.run.report.planned).toEqual(SEED_COUNTS);
        expect(review?.run.report.splitPairs).toHaveLength(3);
        expect(countCatalog(db).books).toBe(0);

        expect(applyCatalogImport(first)).toEqual({ ok: true, counts: SEED_COUNTS });
        expect(countCatalog(db)).toEqual({
            books: 2,
            hymns: 895,
            tunes: 768,
            songs: 921,
            entries: 1247,
        });
        expect(getCatalogImportRun(first)).toMatchObject({
            run: { status: "applied" },
            applyRefusal: {
                reason: "not-preview",
                message: "The import run has already been applied or discarded.",
            },
        });

        const second = previewSeedImport();
        const catalogNotEmpty = {
            reason: "catalog-not-empty",
            message: "The catalog already has books, so the seed import cannot run again.",
        };
        expect(getCatalogImportRun(second)?.applyRefusal).toEqual(catalogNotEmpty);
        expect(applyCatalogImport(second)).toEqual({ ok: false, ...catalogNotEmpty });
        expect(getCatalogImportRuns().map(({ id, status }) => [id, status])).toEqual([
            [second, "preview"],
            [first, "applied"],
        ]);
    });
});

describe("applyCatalogImport", () => {
    test("refuses a run that does not exist", () => {
        expect(applyCatalogImport(999)).toEqual({
            ok: false,
            reason: "not-found",
            message: "There is no such import run.",
        });
    });

    test("throws what it cannot explain, such as a database that will not open", () => {
        getDb.mockImplementation(() => {
            throw new Error("Could not open the database at /srv/data/x: denied");
        });
        expect(() => applyCatalogImport(1)).toThrow("Could not open the database");
    });
});

describe("discardCatalogImport", () => {
    test("discards a preview once", () => {
        const id = seedImportRun(db);
        expect(discardCatalogImport(id)).toEqual({ ok: true });
        expect(getCatalogImportRun(id)?.run.status).toBe("discarded");
        expect(discardCatalogImport(id)).toEqual({
            ok: false,
            reason: "not-preview",
            message: "The import run has already been applied or discarded.",
        });
    });

    test("refuses a run that does not exist", () => {
        expect(discardCatalogImport(999)).toMatchObject({ ok: false, reason: "not-found" });
    });

    test("leaves a discarded run unappliable", () => {
        const id = seedImportRun(db);
        discardCatalogImport(id);
        expect(applyCatalogImport(id)).toMatchObject({ ok: false, reason: "not-preview" });
        expect(countCatalog(db).books).toBe(0);
    });
});

describe("getCatalogImportRun", () => {
    test("is null for a run that does not exist", () => {
        expect(getCatalogImportRun(999)).toBeNull();
    });
});

describe("getCatalogImportRunLabel", () => {
    test("names the run, or falls back", () => {
        const id = seedImportRun(db);
        expect(getCatalogImportRunLabel(String(id))).toBe(`Seed import ${id}`);
        expect(getCatalogImportRunLabel("999")).toBe("Import run");
        expect(getCatalogImportRunLabel("abc")).toBe("Import run");
        expect(console.error).not.toHaveBeenCalled();
    });

    test("falls back and logs when the database fails, never throwing", () => {
        getDb.mockImplementation(() => {
            throw new Error("Could not open the database at /srv/data/x: denied");
        });
        expect(getCatalogImportRunLabel("1")).toBe("Import run");
        expect(console.error).toHaveBeenCalledOnce();
    });
});
