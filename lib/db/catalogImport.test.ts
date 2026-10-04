import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { hymnCatalog } from "@/lib/hymnCatalog";
import { planHymnsJsonImport, type HymnsJsonImport } from "@/lib/import/hymnsJson";
import {
    countCatalog,
    findBook,
    findCatalogSong,
    listCatalogSongs,
    listTunes,
} from "./catalog";
import { applyImportRun, findApplyRefusal } from "./catalogImport";
import { createImportRun, findImportRun, ImportRunError } from "./importRuns";
import { openTestDb, seedBook, seedImportRun } from "./testing";

let db: DatabaseSync;

beforeEach(() => {
    db = openTestDb();
});

afterEach(() => {
    db.close();
});

function preview(plan: HymnsJsonImport): number {
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

describe("applyImportRun with the real seed", () => {
    let seed: HymnsJsonImport;
    let runId: number;

    beforeAll(() => {
        seed = planHymnsJsonImport(hymnCatalog);
    });

    beforeEach(() => {
        runId = preview(seed);
    });

    test("adds exactly what the preview planned, and marks the run applied", () => {
        expect(applyImportRun(db, runId)).toEqual(seed.report.planned);
        expect(countCatalog(db)).toEqual({
            books: 2,
            hymns: 895,
            tunes: 768,
            songs: 921,
            entries: 1247,
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
        expect(great?.entries).toHaveLength(539);
        expect(findBook(db, "r")?.entries).toHaveLength(708);
    });

    test("keeps the merges' aliases and the variants' notes", () => {
        applyImportRun(db, runId);
        const rejoice = listCatalogSongs(db).find(
            ({ title }) => title === "Rejoice, the Lord Is King"
        );
        expect(rejoice).toMatchObject({
            aliases: ["Rejoice – the Lord Is King!"],
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
        const again = preview(seed);
        expect(refusal(() => applyImportRun(db, again))).toMatchObject({
            reason: "catalog-not-empty",
            message: "The catalog already has books, so the seed import cannot run again.",
        });
        expect(status(again)).toBe("preview");
        expect(countCatalog(db).songs).toBe(921);
    });
});

describe("applyImportRun's refusals", () => {
    test("refuses a run that does not exist, or of a kind this build does not know", () => {
        expect(refusal(() => applyImportRun(db, 999)).reason).toBe("not-found");
        const csv = seedImportRun(db, { kind: "csv" });
        expect(refusal(() => applyImportRun(db, csv)).reason).toBe("not-found");
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
        const { rows } = planHymnsJsonImport([]);
        const id = seedImportRun(db, {
            rows: {
                ...rows,
                songs: [{ hymnKey: "missing hymn", tuneKey: null }],
            },
        });
        expect(refusal(() => applyImportRun(db, id)).reason).toBe("invalid-rows");
        expect(status(id)).toBe("preview");
        expect(countCatalog(db)).toEqual(EMPTY);
    });

    test("writes nothing when the database refuses a row", () => {
        const plan = planHymnsJsonImport([
            {
                song_title: "Amazing Grace",
                tune_name: "NEW BRITAIN",
                rejoice_hymns: 108,
                great_hymns_of_the_faith: -1,
            },
        ]);
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
        expect(findApplyRefusal(db, seedImportRun(db, { kind: "csv" }))).toBe("not-found");
        expect(findApplyRefusal(db, seedImportRun(db, { status: "applied" }))).toBe(
            "not-preview"
        );
        const preview = seedImportRun(db);
        seedBook(db);
        expect(findApplyRefusal(db, preview)).toBe("catalog-not-empty");
        expect(status(preview)).toBe("preview");
    });
});
