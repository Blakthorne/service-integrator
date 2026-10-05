import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { countCatalog, findBook } from "@/lib/db/catalog";
import { createImportRun } from "@/lib/db/importRuns";
import {
    SEED_FIXTURE_COUNTS,
    openTestDb,
    seedBook,
    seedEntry,
    seedImportRun,
    seedPlan,
    seedSong,
} from "@/lib/db/testing";

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
    previewBookCsvImport,
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

describe("a seed run the app stored, now that the seed cannot be previewed", () => {
    // The seed's preview is gone from the app, but the runs it stored are in the
    // database, and render and apply from their stored report and rows.
    function storedSeedRun(): number {
        return createImportRun(db, { kind: "hymns-json", sourceName: "hymns.json", ...seedPlan() });
    }

    test("is listed, and reviewed from its stored report, which still has the seed's findings", () => {
        const first = storedSeedRun();

        expect(getCatalogImportRuns()).toEqual([
            expect.objectContaining({
                id: first,
                kind: "hymns-json",
                status: "preview",
                sourceName: "hymns.json",
                planned: SEED_FIXTURE_COUNTS,
            }),
        ]);
        const review = getCatalogImportRun(first);
        expect(review?.applyRefusal).toBeNull();
        expect(review?.run.report.planned).toEqual(SEED_FIXTURE_COUNTS);
        expect(review?.run.kind === "hymns-json" && review.run.report.splitPairs).toHaveLength(1);
        expect(review?.run.kind === "hymns-json" && review.run.report.variants).toHaveLength(1);
        expect(getCatalogImportRunLabel(String(first))).toBe(`Seed import ${first}`);
    });

    test("is applied once while the catalog is empty, and a second is refused", () => {
        const first = storedSeedRun();
        expect(countCatalog(db).books).toBe(0);

        // A seed adds the books, so there is no book to go to.
        expect(applyCatalogImport(first)).toEqual({ ok: true, counts: SEED_FIXTURE_COUNTS, bookCode: null });
        expect(countCatalog(db)).toEqual({
            books: 2,
            hymns: 6,
            tunes: 6,
            songs: 8,
            entries: 13,
        });
        expect(getCatalogImportRun(first)).toMatchObject({
            run: { status: "applied" },
            applyRefusal: {
                reason: "not-preview",
                message: "The import run has already been applied or discarded.",
            },
        });

        const second = storedSeedRun();
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

describe("a book's CSV file, end to end", () => {
    const AT = new Date("2026-10-04T12:00:00.000Z");

    test("previews the file as a run, lists it beside the seed's, applies it once", () => {
        const seedRun = seedImportRun(db, { status: "applied" });
        const rejoice = seedBook(db, { code: "R", name: "Rejoice Hymns" });
        const result = previewBookCsvImport(
            { bookId: rejoice, sourceName: "  rejoice   hymns.csv ", text: "number,title,tune\n400,Be Thou My Vision,SLANE\n" },
            AT
        );
        expect(result).toEqual({ ok: true, runId: expect.any(Number) });
        const runId = result.ok ? result.runId : 0;

        expect(getCatalogImportRuns().map(({ id, kind, status, sourceName }) => [id, kind, status, sourceName])).toEqual([
            [runId, "csv", "preview", "rejoice hymns.csv"],
            [seedRun, "hymns-json", "applied", "hymns.json"],
        ]);
        const review = getCatalogImportRun(runId);
        expect(review).toMatchObject({ run: { kind: "csv", bookId: rejoice }, applyRefusal: null });
        expect(review?.run.kind === "csv" && review.run.report.rows.map(({ label, outcome }) => [label, outcome])).toEqual([
            ["R-400", "add"],
        ]);
        expect(getCatalogImportRunLabel(String(runId))).toBe(`CSV import ${runId}`);

        expect(applyCatalogImport(runId)).toEqual({
            ok: true,
            counts: {
                books: 0,
                hymns: 1,
                hymnAliases: 0,
                tunes: 1,
                tuneAliases: 0,
                songs: 1,
                songsWithoutTune: 0,
                entries: 1,
            },
            // Where applying a book's file goes: to the book.
            bookCode: "R",
        });
        expect(findBook(db, "R")?.entries.map(({ label, title }) => [label, title])).toEqual([["R-400", "Be Thou My Vision"]]);
        expect(applyCatalogImport(runId)).toMatchObject({ ok: false, reason: "not-preview" });
    });

    test("stores a file with problems, whose review says why Apply is refused, and discards it", () => {
        const rejoice = seedBook(db, { code: "R", name: "Rejoice Hymns" });
        seedEntry(db, { bookId: rejoice, songId: seedSong(db), number: 400 });
        const result = previewBookCsvImport({ bookId: rejoice, sourceName: "r.csv", text: "number,title\n400,A\n400,B\n" });
        const runId = result.ok ? result.runId : 0;
        const review = getCatalogImportRun(runId);
        expect(review?.run.kind === "csv" && review.run.report.problems.map(({ reason }) => reason)).toEqual([
            "number-duplicated",
        ]);
        expect(review?.applyRefusal).toEqual({
            reason: "has-problems",
            message: "The file has problems that block the import. Fix them in the file, then preview it again.",
        });
        expect(applyCatalogImport(runId)).toMatchObject({ ok: false, reason: "has-problems" });
        expect(discardCatalogImport(runId)).toEqual({ ok: true });
        expect(findBook(db, "R")?.entries).toHaveLength(1);
    });

    test("refuses, storing nothing, a file over 1 MB and a book that is not in the catalog", () => {
        const rejoice = seedBook(db, { code: "R" });
        const big = `number,title\n${"1,A\n".repeat(270_000)}`;
        expect(previewBookCsvImport({ bookId: rejoice, sourceName: "big.csv", text: big })).toEqual({
            ok: false,
            reason: "too-large",
            message: "The file is larger than 1 MB. A book's CSV file is much smaller: is it the right file?",
        });
        // 1 MB counts bytes of UTF-8: a character outside ASCII counts for two or more.
        const wide = `number,title\n1,${"\u00e9".repeat(530_000)}\n`;
        expect(wide.length).toBeLessThan(1024 * 1024);
        expect(previewBookCsvImport({ bookId: rejoice, sourceName: "wide.csv", text: wide })).toMatchObject({
            ok: false,
            reason: "too-large",
        });
        expect(previewBookCsvImport({ bookId: 999, sourceName: "x.csv", text: "number,title\n1,A\n" })).toEqual({
            ok: false,
            reason: "book-not-found",
            message: "That book is not in the catalog. Choose one from the list.",
        });
        expect(getCatalogImportRuns()).toEqual([]);
    });
});
