import { describe, expect, test } from "vitest";
import type { TuneSummary } from "@/lib/domain";
import {
    CATALOG_TUNES_PAGE_SIZE,
    filterCatalogTunes,
    parseCatalogTunesQuery,
    selectCatalogTunes,
    toCatalogTuneRow,
    type CatalogTuneRow,
} from "./tuneFilter";

let nextId = 1;

function tune(name: string, aliases: string[] = [], meter: string | null = null): CatalogTuneRow {
    return { id: nextId++, name, meter, aliases, songCount: 1 };
}

const darwall = tune("DARWALL", ["DARWAL"], "6.6.6.6.8.8");
const stAnne = tune("ST. ANNE", [], "C.M.");
const crusaders = tune("CRUSADER'S HYMN", ["ST. ELIZABETH"]);
const jungst = tune("JÜNGST");
const newBritain = tune("NEW BRITAIN", [], "C.M.");
const ROWS = [crusaders, darwall, jungst, newBritain, stAnne];

describe("toCatalogTuneRow", () => {
    test("keeps what the list shows and leaves out the notes", () => {
        const summary: TuneSummary = {
            id: 7,
            name: "ST. ANNE",
            meter: "C.M.",
            notes: "A long note the list never shows.",
            aliases: ["ST ANNE"],
            songCount: 3,
        };
        expect(toCatalogTuneRow(summary)).toEqual({
            id: 7,
            name: "ST. ANNE",
            meter: "C.M.",
            aliases: ["ST ANNE"],
            songCount: 3,
        });
    });
});

describe("parseCatalogTunesQuery", () => {
    test("reads the search, trimmed, and the page", () => {
        expect(parseCatalogTunesQuery(new URLSearchParams("q=+st+anne+&page=3"))).toEqual({
            q: "st anne",
            page: 3,
        });
    });

    test("falls back to no search and page 1", () => {
        expect(parseCatalogTunesQuery(new URLSearchParams(""))).toEqual({ q: "", page: 1 });
        expect(parseCatalogTunesQuery(new URLSearchParams("page=abc"))).toEqual({
            q: "",
            page: 1,
        });
        expect(parseCatalogTunesQuery(new URLSearchParams("page=0"))).toEqual({
            q: "",
            page: 1,
        });
    });
});

describe("filterCatalogTunes", () => {
    const names = (rows: CatalogTuneRow[]) => rows.map((row) => row.name);

    test("no search keeps every row, in order", () => {
        expect(filterCatalogTunes(ROWS, "")).toEqual(ROWS);
        expect(filterCatalogTunes(ROWS, " .- ")).toEqual(ROWS);
    });

    test("matches the name in any case and spacing, ignoring punctuation", () => {
        expect(names(filterCatalogTunes(ROWS, "st anne"))).toEqual(["ST. ANNE"]);
        expect(names(filterCatalogTunes(ROWS, "St. Anne"))).toEqual(["ST. ANNE"]);
        expect(names(filterCatalogTunes(ROWS, "crusaders"))).toEqual(["CRUSADER'S HYMN"]);
    });

    test("matches part of a word, and the words in any order", () => {
        expect(names(filterCatalogTunes(ROWS, "brit"))).toEqual(["NEW BRITAIN"]);
        expect(names(filterCatalogTunes(ROWS, "britain new"))).toEqual(["NEW BRITAIN"]);
    });

    test("needs every word", () => {
        expect(filterCatalogTunes(ROWS, "new anne")).toEqual([]);
    });

    test("matches another name", () => {
        expect(names(filterCatalogTunes(ROWS, "darwal"))).toEqual(["DARWALL"]);
        expect(names(filterCatalogTunes(ROWS, "elizabeth"))).toEqual(["CRUSADER'S HYMN"]);
    });

    test("ignores accents", () => {
        expect(names(filterCatalogTunes(ROWS, "jungst"))).toEqual(["JÜNGST"]);
    });

    test("does not search the meter", () => {
        expect(filterCatalogTunes(ROWS, "6.6.6.6.8.8")).toEqual([]);
    });
});

describe("selectCatalogTunes", () => {
    const many = Array.from({ length: 120 }, (_, index) => tune(`TUNE ${index + 1}`));

    test("pages the matching rows", () => {
        const first = selectCatalogTunes(many, { q: "", page: 1 });
        expect(first.rows).toHaveLength(CATALOG_TUNES_PAGE_SIZE);
        expect(first.rows[0].name).toBe("TUNE 1");
        expect(first).toMatchObject({ page: 1, totalPages: 3, total: 120 });

        const last = selectCatalogTunes(many, { q: "", page: 3 });
        expect(last.rows.map((row) => row.name)).toEqual(
            many.slice(100).map((row) => row.name)
        );
    });

    test("clamps the page to the last one", () => {
        const page = selectCatalogTunes(many, { q: "", page: 99 });
        expect(page.page).toBe(3);
        expect(page.rows).toHaveLength(20);
    });

    test("counts and pages only what matches", () => {
        const page = selectCatalogTunes(many, { q: "tune 11", page: 1 }, 5);
        // TUNE 11 and TUNE 110 to TUNE 119.
        expect(page.total).toBe(11);
        expect(page.totalPages).toBe(3);
        expect(page.rows.map((row) => row.name)).toEqual([
            "TUNE 11",
            "TUNE 110",
            "TUNE 111",
            "TUNE 112",
            "TUNE 113",
        ]);
    });

    test("an empty result is page 1 of 1", () => {
        expect(selectCatalogTunes(many, { q: "zzz", page: 4 })).toEqual({
            rows: [],
            page: 1,
            totalPages: 1,
            total: 0,
        });
    });
});
