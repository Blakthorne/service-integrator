import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { ImportRunKind } from "@/lib/domain";
import { planHymnsJsonImport } from "@/lib/import/hymnsJson";
import {
    createImportRun,
    discardImportRun,
    findImportRun,
    findImportRunLabel,
    finishImportRun,
    ImportRunError,
    isImportRunKind,
    listImportRuns,
} from "./importRuns";
import { openTestDb, seedImportRun } from "./testing";

const T0 = new Date("2026-10-04T12:00:00.000Z");

let db: DatabaseSync;

beforeEach(() => {
    db = openTestDb();
});

afterEach(() => {
    db.close();
});

/** A small seed: two hymns, one of them in both books. */
const plan = planHymnsJsonImport([
    {
        song_title: "Amazing Grace",
        tune_name: "NEW BRITAIN",
        rejoice_hymns: 108,
        great_hymns_of_the_faith: 247,
    },
    {
        song_title: "Doxology",
        tune_name: "OLD HUNDREDTH",
        rejoice_hymns: 14,
        great_hymns_of_the_faith: 0,
    },
]);

function preview(at: Date = T0): number {
    return createImportRun(
        db,
        { kind: "hymns-json", sourceName: "hymns.json", ...plan },
        at
    );
}

function status(id: number): string {
    return String(db.prepare("SELECT status FROM import_runs WHERE id = ?").get(id)?.status);
}

/** The error a call throws, for its reason. */
function thrown(call: () => unknown): unknown {
    try {
        call();
    } catch (error) {
        return error;
    }
    throw new Error("expected the call to throw");
}

describe("isImportRunKind", () => {
    test("knows the seed import only", () => {
        expect(isImportRunKind("hymns-json")).toBe(true);
        expect(isImportRunKind("csv")).toBe(false);
        expect(isImportRunKind(null)).toBe(false);
    });
});

describe("createImportRun", () => {
    test("stores a preview with its report and rows", () => {
        const id = preview();
        expect(
            db.prepare("SELECT at, kind, book_id, status, source_name FROM import_runs WHERE id = ?").get(id)
        ).toEqual({
            at: "2026-10-04T12:00:00.000Z",
            kind: "hymns-json",
            book_id: null,
            status: "preview",
            source_name: "hymns.json",
        });
        const stored = db.prepare("SELECT report, rows FROM import_runs WHERE id = ?").get(id);
        expect(JSON.parse(String(stored?.report))).toEqual(plan.report);
        expect(JSON.parse(String(stored?.rows))).toEqual(plan.rows);
    });

    test("refuses a kind it does not know", () => {
        expect(() =>
            createImportRun(db, {
                kind: "csv" as ImportRunKind,
                sourceName: "book.csv",
                ...plan,
            })
        ).toThrow("Unknown import run kind: csv");
        expect(listImportRuns(db)).toEqual([]);
    });
});

describe("listImportRuns", () => {
    test("is empty before the first preview", () => {
        expect(listImportRuns(db)).toEqual([]);
    });

    test("lists runs newest first, with the counts each plans", () => {
        const first = preview(T0);
        const second = preview(new Date("2026-10-05T08:00:00.000Z"));
        discardImportRun(db, first);
        expect(listImportRuns(db)).toEqual([
            {
                id: second,
                at: "2026-10-05T08:00:00.000Z",
                kind: "hymns-json",
                status: "preview",
                sourceName: "hymns.json",
                bookId: null,
                planned: {
                    books: 2,
                    hymns: 2,
                    hymnAliases: 0,
                    tunes: 2,
                    tuneAliases: 0,
                    songs: 2,
                    songsWithoutTune: 0,
                    entries: 4,
                },
            },
            expect.objectContaining({ id: first, status: "discarded" }),
        ]);
    });

    test("leaves out runs of a kind or status this build does not know", () => {
        const known = seedImportRun(db);
        seedImportRun(db, { kind: "csv" });
        seedImportRun(db, { status: "undone" });
        expect(listImportRuns(db).map(({ id }) => id)).toEqual([known]);
    });

    test("counts 0 for whatever a report does not plan", () => {
        seedImportRun(db, { report: { planned: { songs: 3, entries: "many" } } });
        seedImportRun(db, { report: {} });
        expect(listImportRuns(db).map(({ planned }) => planned)).toEqual([
            {
                books: 0,
                hymns: 0,
                hymnAliases: 0,
                tunes: 0,
                tuneAliases: 0,
                songs: 0,
                songsWithoutTune: 0,
                entries: 0,
            },
            expect.objectContaining({ songs: 3, entries: 0 }),
        ]);
    });
});

describe("findImportRun", () => {
    test("gives a run with its report", () => {
        const id = preview();
        expect(findImportRun(db, id)).toEqual({
            id,
            at: "2026-10-04T12:00:00.000Z",
            kind: "hymns-json",
            status: "preview",
            sourceName: "hymns.json",
            bookId: null,
            planned: plan.report.planned,
            report: plan.report,
        });
    });

    test("is null for a run that does not exist or that this build does not know", () => {
        expect(findImportRun(db, 999)).toBeNull();
        expect(findImportRun(db, seedImportRun(db, { kind: "csv" }))).toBeNull();
    });
});

describe("findImportRunLabel", () => {
    test("names a run by its kind and id, or is null", () => {
        const id = preview();
        expect(findImportRunLabel(db, id)).toBe(`Seed import ${id}`);
        expect(findImportRunLabel(db, 999)).toBeNull();
        expect(findImportRunLabel(db, seedImportRun(db, { kind: "csv" }))).toBeNull();
    });
});

describe("discardImportRun", () => {
    test("discards a preview", () => {
        const id = preview();
        discardImportRun(db, id);
        expect(status(id)).toBe("discarded");
    });

    test("refuses a run that is no longer a preview", () => {
        const discarded = preview();
        discardImportRun(db, discarded);
        const applied = seedImportRun(db, { status: "applied" });
        for (const id of [discarded, applied]) {
            const error = thrown(() => discardImportRun(db, id));
            expect(error).toBeInstanceOf(ImportRunError);
            expect(error).toMatchObject({
                reason: "not-preview",
                message: "The import run has already been applied or discarded.",
            });
        }
        expect(status(applied)).toBe("applied");
    });

    test("refuses a run that does not exist", () => {
        expect(thrown(() => discardImportRun(db, 999))).toMatchObject({
            reason: "not-found",
            message: "There is no such import run.",
        });
    });
});

describe("finishImportRun", () => {
    test("moves a preview on once", () => {
        const id = preview();
        finishImportRun(db, id, "applied");
        expect(status(id)).toBe("applied");
        expect(thrown(() => finishImportRun(db, id, "discarded"))).toMatchObject({
            reason: "not-preview",
        });
        expect(status(id)).toBe("applied");
    });
});
