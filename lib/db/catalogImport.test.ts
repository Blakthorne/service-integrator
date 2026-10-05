import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
    countCatalog,
    findBook,
    findCatalogSong,
    listCatalogSongs,
    listTunes,
} from "./catalog";
import { applyImportRun, findApplyRefusal, previewBookCsvRun, readBookCsvCatalog } from "./catalogImport";
import { createImportRun, findImportRun, ImportRunError } from "./importRuns";
import {
    SEED_FIXTURE_COUNTS,
    emptySeedRows,
    openTestDb,
    seedBook,
    seedEntry,
    seedHymn,
    seedImportRun,
    seedPlan,
    seedSong,
    seedTune,
} from "./testing";

let db: DatabaseSync;

beforeEach(() => {
    db = openTestDb();
});

afterEach(() => {
    db.close();
});

/** Store a seed run, as a preview did while the seed could be previewed: its stored report and rows. */
function preview(plan: ReturnType<typeof seedPlan> = seedPlan()): number {
    return createImportRun(db, { kind: "hymns-json", sourceName: "hymns.json", ...plan });
}

function status(id: number): string {
    return String(db.prepare("SELECT status FROM import_runs WHERE id = ?").get(id)?.status);
}

/** The ImportRunError a call throws. */
function refusal(call: () => unknown): ImportRunError {
    try {
        call();
    } catch (error) {
        if (error instanceof ImportRunError) {
            return error;
        }
        throw error;
    }
    throw new Error("expected the call to be refused");
}

const EMPTY = { books: 0, hymns: 0, tunes: 0, songs: 0, entries: 0 };

describe("applyImportRun with a seed's stored rows", () => {
    // The seed can no longer be previewed, but a run it stored can be applied
    // while the catalog is empty, so what applying writes is still pinned,
    // against the small fixture (`smallSeedRows`).
    let runId: number;

    beforeEach(() => {
        runId = preview();
    });

    test("adds exactly what the preview planned, and marks the run applied", () => {
        expect(applyImportRun(db, runId)).toEqual(SEED_FIXTURE_COUNTS);
        expect(countCatalog(db)).toEqual({
            books: 2,
            hymns: 6,
            tunes: 6,
            songs: 8,
            entries: 13,
        });
        expect(findImportRun(db, runId)?.status).toBe("applied");
    });

    test("gives Amazing Grace its Rejoice and Great Hymns numbers", () => {
        applyImportRun(db, runId);
        const amazingGrace = listCatalogSongs(db).filter(
            ({ title }) => title === "Amazing Grace"
        );
        expect(amazingGrace).toHaveLength(1);
        expect(amazingGrace[0]).toMatchObject({ tuneName: "NEW BRITAIN" });
        expect(amazingGrace[0].entries.map(({ label }) => label)).toEqual([
            "R-130",
            "G-236",
        ]);
    });

    test("lists the Doxology first in G, as Front Cover", () => {
        applyImportRun(db, runId);
        const great = findBook(db, "G");
        expect(great?.entries[0]).toMatchObject({
            title: "Doxology",
            tuneName: "OLD HUNDREDTH",
            number: null,
            locationLabel: "front cover",
            label: "G-Front Cover",
        });
        expect(great?.entries).toHaveLength(5);
        expect(findBook(db, "r")?.entries).toHaveLength(8);
    });

    test("keeps the aliases and the variants' notes", () => {
        applyImportRun(db, runId);
        const rejoice = listCatalogSongs(db).find(
            ({ title }) => title === "Rejoice, the Lord Is King"
        );
        expect(rejoice).toMatchObject({
            aliases: ["Rejoice \u2013 the Lord Is King!"],
            tuneName: "DARWALL",
            tuneAliases: ["DARWAL"],
        });
        expect(rejoice?.entries.map(({ label }) => label)).toEqual(["R-43", "G-143"]);

        const hark = listCatalogSongs(db).find(
            ({ title }) => title === "Hark! the Herald Angels Sing"
        );
        expect(
            hark?.entries.map(({ label, variantNote }) => [label, variantNote])
        ).toEqual([
            ["R-227", null],
            ["R-228", "Descant - last stanza only"],
            ["G-93", null],
        ]);
    });

    test("gives Thank You, Lord its two tunes and a tune-less song", () => {
        applyImportRun(db, runId);
        const thankYou = listCatalogSongs(db).filter(
            ({ title }) => title === "Thank You, Lord"
        );
        expect(thankYou.map(({ tuneName, entries }) => [tuneName, entries[0].label])).toEqual([
            ["LYNCH", "R-561"],
            ["THANK YOU, LORD", "R-266"],
            [null, "G-221"],
        ]);
        const detail = findCatalogSong(db, thankYou[2].id);
        expect(detail?.otherTunes.map(({ tuneName }) => tuneName)).toEqual([
            "LYNCH",
            "THANK YOU, LORD",
        ]);
    });

    test("shares tunes between hymns", () => {
        applyImportRun(db, runId);
        expect(
            listTunes(db).find(({ name }) => name === "OLD HUNDREDTH")?.songCount
        ).toBe(2);
    });

    test("refuses to run twice", () => {
        applyImportRun(db, runId);
        expect(refusal(() => applyImportRun(db, runId)).reason).toBe("not-preview");
        const again = preview();
        expect(refusal(() => applyImportRun(db, again))).toMatchObject({
            reason: "catalog-not-empty",
            message: "The catalog already has books, so the seed import cannot run again.",
        });
        expect(status(again)).toBe("preview");
        expect(countCatalog(db).songs).toBe(8);
    });
});

describe("applyImportRun's refusals", () => {
    test("refuses a run that does not exist, or of a kind this build does not know", () => {
        expect(refusal(() => applyImportRun(db, 999)).reason).toBe("not-found");
        const unknown = seedImportRun(db, { kind: "spreadsheet" });
        expect(refusal(() => applyImportRun(db, unknown)).reason).toBe("not-found");
        expect(countCatalog(db)).toEqual(EMPTY);
    });

    test("refuses a run that was applied or discarded", () => {
        for (const runStatus of ["applied", "discarded"]) {
            const id = seedImportRun(db, { status: runStatus });
            expect(refusal(() => applyImportRun(db, id)).reason).toBe("not-preview");
            expect(status(id)).toBe(runStatus);
        }
        expect(countCatalog(db)).toEqual(EMPTY);
    });

    test("refuses any run while the catalog has books", () => {
        seedBook(db, { code: "CB", numbered: false });
        const id = seedImportRun(db);
        expect(refusal(() => applyImportRun(db, id)).reason).toBe("catalog-not-empty");
        expect(status(id)).toBe("preview");
        expect(countCatalog(db)).toEqual({ ...EMPTY, books: 1 });
    });

    test("refuses rows of the wrong shape", () => {
        for (const rows of ["not rows", { books: [{ code: "R" }] }]) {
            const id = seedImportRun(db, { rows });
            expect(refusal(() => applyImportRun(db, id))).toMatchObject({
                reason: "invalid-rows",
                message: "The import run's planned rows are damaged. Discard it and preview again.",
            });
            expect(status(id)).toBe("preview");
        }
        expect(countCatalog(db)).toEqual(EMPTY);
    });

    test("refuses rows that do not hang together, writing nothing", () => {
        const id = seedImportRun(db, {
            rows: {
                ...emptySeedRows(),
                songs: [{ hymnKey: "missing hymn", tuneKey: null }],
            },
        });
        expect(refusal(() => applyImportRun(db, id)).reason).toBe("invalid-rows");
        expect(status(id)).toBe("preview");
        expect(countCatalog(db)).toEqual(EMPTY);
    });

    test("refuses rows that plan a key twice, writing nothing", () => {
        const plan = seedPlan();
        for (const rows of [
            { ...plan.rows, hymns: [...plan.rows.hymns, ...plan.rows.hymns] },
            { ...plan.rows, tunes: [...plan.rows.tunes, ...plan.rows.tunes] },
            { ...plan.rows, songs: [...plan.rows.songs, ...plan.rows.songs] },
        ]) {
            const id = seedImportRun(db, { report: plan.report, rows });
            expect(refusal(() => applyImportRun(db, id)).reason).toBe("invalid-rows");
            expect(status(id)).toBe("preview");
        }
        expect(countCatalog(db)).toEqual(EMPTY);
    });

    test("writes nothing when the database refuses a row", () => {
        const plan = seedPlan();
        const duplicate = { ...plan.rows.entries[0] };
        const id = seedImportRun(db, {
            report: plan.report,
            rows: { ...plan.rows, entries: [plan.rows.entries[0], duplicate] },
        });
        expect(() => applyImportRun(db, id)).toThrow(/UNIQUE constraint failed/);
        expect(status(id)).toBe("preview");
        expect(countCatalog(db)).toEqual(EMPTY);
    });
});

describe("findApplyRefusal", () => {
    test("is null for a preview while the catalog is empty", () => {
        expect(findApplyRefusal(db, seedImportRun(db))).toBeNull();
    });

    test("names what apply would refuse, without writing", () => {
        expect(findApplyRefusal(db, 999)).toBe("not-found");
        expect(findApplyRefusal(db, seedImportRun(db, { kind: "spreadsheet" }))).toBe("not-found");
        expect(findApplyRefusal(db, seedImportRun(db, { status: "applied" }))).toBe(
            "not-preview"
        );
        const preview = seedImportRun(db);
        seedBook(db);
        expect(findApplyRefusal(db, preview)).toBe("catalog-not-empty");
        expect(status(preview)).toBe("preview");
    });
});

describe("a book's CSV file", () => {
    const AT = new Date("2026-10-04T12:00:00.000Z");

    /** Rejoice Hymns with Amazing Grace (NEW BRITAIN) at R-108, and a Chorus Book with one chorus. */
    function seedBooks() {
        const rejoice = seedBook(db, { code: "R", name: "Rejoice Hymns" });
        const chorus = seedBook(db, { code: "CB", name: "Chorus Book", numbered: false });
        const newBritain = seedTune(db, { name: "NEW BRITAIN" });
        const amazingGrace = seedSong(db, {
            hymnId: seedHymn(db, { title: "Amazing Grace", aliases: ["Amazing Grace! How Sweet the Sound"] }),
            tuneId: newBritain,
        });
        seedEntry(db, { bookId: rejoice, songId: amazingGrace, number: 108 });
        const alleluia = seedSong(db, { hymnId: seedHymn(db, { title: "Alleluia" }) });
        seedEntry(db, { bookId: chorus, songId: alleluia, position: 1 });
        return { rejoice, chorus, newBritain, amazingGrace };
    }

    const REJOICE_FILE = [
        "number,title,tune,variant",
        "109,Amazing Grace! How Sweet the Sound,NEW BRITAIN,Descant",
        "400,Be Thou My Vision,SLANE,",
        '401,"Come, Thou Fount",,',
        "",
    ].join("\r\n");

    function previewFile(bookId: number, text: string): number {
        const id = previewBookCsvRun(db, { bookId, sourceName: "rejoice.csv", text }, AT);
        if (id === null) {
            throw new Error("expected a run");
        }
        return id;
    }

    test("previews a file as a run of the book, with its report and what apply plans from", () => {
        const { rejoice } = seedBooks();
        const id = previewFile(rejoice, REJOICE_FILE);
        const run = findImportRun(db, id);
        expect(run).toMatchObject({
            id,
            at: AT.toISOString(),
            kind: "csv",
            status: "preview",
            sourceName: "rejoice.csv",
            bookId: rejoice,
            planned: { books: 0, hymns: 2, tunes: 1, songs: 2, songsWithoutTune: 1, entries: 3 },
        });
        expect(run?.kind === "csv" && run.report.problems).toEqual([]);
        const stored = JSON.parse(String(db.prepare("SELECT rows FROM import_runs WHERE id = ?").get(id)?.rows));
        expect(stored.records).toHaveLength(4);
        expect(stored.planned.entries).toHaveLength(3);
        expect(findApplyRefusal(db, id)).toBeNull();
        expect(previewBookCsvRun(db, { bookId: 999, sourceName: "x.csv", text: REJOICE_FILE })).toBeNull();
    });

    test("applies a numbered book's file: new hymns, tunes and songs, and the entries", () => {
        const { rejoice, amazingGrace } = seedBooks();
        const id = previewFile(rejoice, REJOICE_FILE);
        expect(applyImportRun(db, id)).toEqual({
            books: 0,
            hymns: 2,
            hymnAliases: 0,
            tunes: 1,
            tuneAliases: 0,
            songs: 2,
            songsWithoutTune: 1,
            entries: 3,
        });
        expect(findImportRun(db, id)?.status).toBe("applied");
        expect(findBook(db, "R")?.entries.map(({ label, title, tuneName, variantNote }) => [label, title, tuneName, variantNote])).toEqual([
            ["R-108", "Amazing Grace", "NEW BRITAIN", null],
            ["R-109", "Amazing Grace", "NEW BRITAIN", "Descant"],
            ["R-400", "Be Thou My Vision", "SLANE", null],
            ["R-401", "Come, Thou Fount", null, null],
        ]);
        expect(findCatalogSong(db, amazingGrace)?.entries.map(({ label }) => label)).toEqual(["R-108", "R-109"]);
        expect(refusal(() => applyImportRun(db, id)).reason).toBe("not-preview");
    });

    test("applies a file to a book without numbers, after its entries", () => {
        const { chorus } = seedBooks();
        const id = previewFile(chorus, "position,title\n2,Deep and Wide\n1,Jesus Loves Me\n");
        applyImportRun(db, id);
        expect(findBook(db, "CB")?.entries.map(({ title, position }) => [title, position])).toEqual([
            ["Alleluia", 1],
            ["Jesus Loves Me", 2],
            ["Deep and Wide", 3],
        ]);
    });

    test("applies a file with no tune column: its rows join the songs the catalog has, making no twins", () => {
        const { chorus, amazingGrace } = seedBooks();
        const before = countCatalog(db);
        const id = previewFile(chorus, "position,title\n1,Amazing Grace\n");
        expect(applyImportRun(db, id)).toMatchObject({ hymns: 0, tunes: 0, songs: 0, entries: 1 });
        expect(countCatalog(db)).toEqual({ ...before, entries: before.entries + 1 });
        expect(findCatalogSong(db, amazingGrace)?.entries.map(({ label }) => label)).toEqual(["R-108", "Chorus Book"]);
    });

    test("refuses a file with problems, writing nothing", () => {
        const { rejoice } = seedBooks();
        const id = previewFile(rejoice, "number,title\n108,Taken\n500,Fine\n");
        const run = findImportRun(db, id);
        expect(run?.kind === "csv" && run.report.problems.map(({ reason }) => reason)).toEqual(["number-taken"]);
        expect(findApplyRefusal(db, id)).toBe("has-problems");
        expect(refusal(() => applyImportRun(db, id))).toMatchObject({
            reason: "has-problems",
            message: "The file has problems that block the import. Fix them in the file, then preview it again.",
        });
        expect(findBook(db, "R")?.entries).toHaveLength(1);
        expect(status(id)).toBe("preview");
    });

    test("refuses a file whose plan the catalog has changed since the preview, writing nothing", () => {
        const { rejoice } = seedBooks();
        const taken = previewFile(rejoice, REJOICE_FILE);
        seedEntry(db, { bookId: rejoice, songId: seedSong(db), number: 400 });
        expect(findApplyRefusal(db, taken)).toBe("stale");

        const matched = previewFile(rejoice, "number,title\n500,Be Still My Soul\n");
        seedHymn(db, { title: "be still my soul!" });
        expect(refusal(() => applyImportRun(db, matched))).toMatchObject({
            reason: "stale",
            message:
                "The catalog has changed since this preview, so it would not add what the report shows. Preview the file again.",
        });
        expect(countCatalog(db).entries).toBe(3);
    });

    test("refuses a file whose book is gone or no longer numbers its songs", () => {
        const { rejoice, chorus } = seedBooks();
        const numbered = previewFile(rejoice, "number,title\n500,A\n");
        db.prepare("UPDATE books SET numbered = 0, label_format = 'Rejoice' WHERE id = ?").run(rejoice);
        expect(findApplyRefusal(db, numbered)).toBe("book-not-found");

        const gone = previewFile(chorus, "position,title\n1,B\n");
        db.prepare("UPDATE import_runs SET book_id = NULL WHERE id = ?").run(gone);
        expect(refusal(() => applyImportRun(db, gone)).reason).toBe("book-not-found");
    });

    test("refuses damaged rows", () => {
        const { rejoice } = seedBooks();
        const id = previewFile(rejoice, "number,title\n500,A\n");
        db.prepare("UPDATE import_runs SET rows = '{\"records\": 7}' WHERE id = ?").run(id);
        expect(refusal(() => applyImportRun(db, id)).reason).toBe("invalid-rows");
    });

    test("reads what the plan needs: every hymn and tune with their other names, the songs, the book's entries", () => {
        const { rejoice, newBritain, amazingGrace } = seedBooks();
        const snapshot = readBookCsvCatalog(db, rejoice);
        expect(snapshot.hymns).toEqual([
            { id: expect.any(Number), title: "Amazing Grace", aliases: ["Amazing Grace! How Sweet the Sound"] },
            { id: expect.any(Number), title: "Alleluia", aliases: [] },
        ]);
        expect(snapshot.tunes).toEqual([{ id: newBritain, name: "NEW BRITAIN", aliases: [] }]);
        expect(snapshot.songs).toHaveLength(2);
        expect(snapshot.entries).toEqual([{ songId: amazingGrace, number: 108, position: null, variantNote: null }]);
    });
});
