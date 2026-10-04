import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { openTestDb, seedBook, seedEntry, seedHymn, seedSong } from "@/lib/db/testing";

// vi.hoisted: vi.mock factories run before the module's own declarations.
const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/lib/db", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/db")>()),
    getDb,
}));

import { exportCatalogJson } from "./export";

let db: DatabaseSync;

beforeEach(() => {
    db = openTestDb();
    getDb.mockReturnValue(db);
});

afterEach(() => {
    db.close();
    getDb.mockReset();
});

describe("exportCatalogJson", () => {
    test("gives the whole catalog as its JSON document, the same each time", () => {
        const book = seedBook(db, { code: "R" });
        seedEntry(db, { bookId: book, songId: seedSong(db, { hymnId: seedHymn(db, { title: "Amazing Grace" }) }), number: 108 });
        const text = exportCatalogJson();
        expect(JSON.parse(text)).toMatchObject({
            format: "service-integrator-catalog",
            books: [expect.objectContaining({ code: "R" })],
            hymns: [expect.objectContaining({ title: "Amazing Grace" })],
            entries: [expect.objectContaining({ number: 108 })],
        });
        expect(exportCatalogJson()).toBe(text);
    });

    test("throws when the database cannot be opened", () => {
        getDb.mockImplementation(() => {
            throw new Error("Could not open the database at /srv/data/x: denied");
        });
        expect(() => exportCatalogJson()).toThrow("Could not open the database");
    });
});
