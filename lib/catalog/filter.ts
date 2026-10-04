import type { CatalogSongSummary, LabelledEntry } from "@/lib/domain";
import { parseEnum, parsePage } from "@/lib/urlState";

/**
 * Searching, filtering, sorting and paging the songs list (`/catalog`). The
 * page loads every song once; the view narrows them in the browser, with the
 * search (`?q=`), book (`?book=`), sort (`?sort=`) and page (`?page=`) in the
 * URL. Pure and safe on both sides.
 */

/** How the songs list can be sorted: by title, or by number (within the chosen book). */
export const CATALOG_SORTS = ["title", "number"] as const;

export type CatalogSort = (typeof CATALOG_SORTS)[number];

/** Songs per page of the songs list. */
export const CATALOG_PAGE_SIZE = 50;

/** The songs list's view, read from the URL by `parseCatalogSongsQuery`. */
export interface CatalogSongsQuery {
    /** The search, trimmed; "" for none. */
    q: string;
    /** A book's code as the catalog spells it, or null for every book. */
    book: string | null;
    sort: CatalogSort;
    /** The page asked for, at least 1; `pageCatalogSongs` clamps it to the last page. */
    page: number;
}

/** What `useSearchParams()` and `URLSearchParams` both offer. */
interface QueryParams {
    get(name: string): string | null;
}

/**
 * Read the songs list's view from the query string. A missing or unknown
 * value falls back: no search, every book, by title, page 1. `?book=` is
 * matched without regard to case against `bookCodes` (the catalog's codes)
 * and comes back as the catalog spells it.
 */
export function parseCatalogSongsQuery(
    params: QueryParams,
    bookCodes: readonly string[]
): CatalogSongsQuery {
    const book = params.get("book")?.toLowerCase();
    return {
        q: params.get("q")?.trim() ?? "",
        book: bookCodes.find((code) => code.toLowerCase() === book) ?? null,
        sort: parseEnum(params.get("sort"), CATALOG_SORTS, "title"),
        page: parsePage(params.get("page")),
    };
}

/** Accents a decomposed letter carries ("é" is "e" and U+0301). */
const COMBINING_MARKS = /[̀-ͯ]/g;

/** Apostrophes, straight and curly, which join a word rather than split it ("O'er"). */
const APOSTROPHES = /['‘’ʼ]/g;

/** Anything that is not a letter or a digit. */
const NOT_LETTER_OR_DIGIT = /[^\p{L}\p{N}]+/gu;

/**
 * The form text is searched in: lower case, accents and apostrophes dropped,
 * "&" spelled "and", and every other run of punctuation and space made one
 * space. "Jesus' Name", "JESUS NAME" and "jesus  name" are all "jesus name";
 * "JÜNGST" is "jungst" and "O'er" is "oer".
 */
export function foldForSearch(text: string): string {
    return text
        .normalize("NFD")
        .replace(COMBINING_MARKS, "")
        .toLowerCase()
        .replace(APOSTROPHES, "")
        .replace(/&/g, " and ")
        .replace(NOT_LETTER_OR_DIGIT, " ")
        .trim();
}

/** A label without its punctuation and spaces: "R-396", "r 396" and "R396" are all "r396". */
function compactLabel(text: string): string {
    return foldForSearch(text).replace(/ /g, "");
}

/** What a row is searched and sorted by, worked out once per row. */
interface SearchData {
    /** Its title, aliases, tune name and tune aliases, folded, one per line. */
    text: string;
    /** Its title, folded, to sort by. */
    title: string;
    /** Its tune name, folded, to sort by; "" when the tune is unknown. */
    tune: string;
    /** Its entries' labels, compacted. */
    labels: Set<string>;
    /** Its entries' numbers. */
    numbers: Set<number>;
}

/**
 * Search data by row. Rows come from the server once and stay the same
 * objects while the viewer types, so each is folded once; a weak map lets
 * rows that are gone be collected.
 */
const searchData = new WeakMap<CatalogSongSummary, SearchData>();

function searchDataOf(row: CatalogSongSummary): SearchData {
    let data = searchData.get(row);
    if (!data) {
        const fields = [row.title, ...row.aliases, row.tuneName ?? "", ...row.tuneAliases];
        data = {
            text: fields.map(foldForSearch).join("\n"),
            title: foldForSearch(row.title),
            tune: foldForSearch(row.tuneName ?? ""),
            labels: new Set(row.entries.map(({ label }) => compactLabel(label))),
            numbers: new Set(
                row.entries.flatMap(({ number }) => (number === null ? [] : [number]))
            ),
        };
        searchData.set(row, data);
    }
    return data;
}

/** A search, prepared once for every row it is tested against. */
interface Search {
    /** Its words, each to be found in the row's text. */
    words: string[];
    /** It as a label ("r396"), or "" if it has no letters or digits. */
    label: string;
    /** It as a number, when it is only digits. */
    number: number | null;
}

function prepareSearch(q: string): Search | null {
    const folded = foldForSearch(q);
    if (folded === "") {
        return null;
    }
    return {
        words: folded.split(" "),
        label: folded.replace(/ /g, ""),
        number: /^[0-9]+$/.test(q) ? Number(q) : null,
    };
}

/**
 * Whether a row matches a search: every word of it is part of the title, an
 * alias, the tune name or a tune alias (in any order: "grace amazing" finds
 * Amazing Grace); or it is the number of one of the row's entries ("396"
 * finds R-396 and G-396); or it is one of their labels, in any case and
 * spacing ("R-396", "r396", "G front cover").
 */
function matchesSearch(row: CatalogSongSummary, search: Search): boolean {
    const data = searchDataOf(row);
    return (
        (search.number !== null && data.numbers.has(search.number)) ||
        data.labels.has(search.label) ||
        search.words.every((word) => data.text.includes(word))
    );
}

/**
 * The rows that match `q` (see `matchesSearch`; a search with no letters or
 * digits matches every row) and, when `book` is a code, have an entry in
 * that book. Keeps the rows' order.
 */
export function filterCatalogSongs(
    rows: readonly CatalogSongSummary[],
    { q, book }: Pick<CatalogSongsQuery, "q" | "book">
): CatalogSongSummary[] {
    const search = prepareSearch(q);
    return rows.filter(
        (row) =>
            (book === null || row.entries.some(({ bookCode }) => bookCode === book)) &&
            (search === null || matchesSearch(row, search))
    );
}

/** Compare by a key; equal keys give 0. */
function compareBy<T>(a: T, b: T): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Title order: by the title's searched form (so case, accents and
 * punctuation do not count: "'Tis So Sweet" sorts under T), then as written,
 * then by tune name, an unknown tune last.
 */
function compareTitles(a: CatalogSongSummary, b: CatalogSongSummary): number {
    const first = searchDataOf(a);
    const second = searchDataOf(b);
    return (
        compareBy(first.title, second.title) ||
        compareBy(a.title, b.title) ||
        compareBy(a.tuneName === null, b.tuneName === null) ||
        compareBy(first.tune, second.tune) ||
        a.id - b.id
    );
}

/**
 * Where an entry falls within its book: at a location (the front cover)
 * first, then by number, then by position, as the book's page lists it.
 */
function placement(entry: LabelledEntry): [number, number] {
    if (entry.number !== null) {
        return [1, entry.number];
    }
    if (entry.position !== null) {
        return [2, entry.position];
    }
    return [0, 0];
}

/**
 * The entry a row sorts by in number order: its first in `book`, or with no
 * book its first of all (a row's entries come in book order), as
 * [book rank, placement…]; rows with none sort last.
 */
function numberKey(
    row: CatalogSongSummary,
    book: string | null,
    bookCodes: readonly string[]
): number[] {
    const entry =
        book === null
            ? row.entries[0]
            : row.entries.find(({ bookCode }) => bookCode === book);
    if (!entry) {
        return [Number.POSITIVE_INFINITY];
    }
    const rank = bookCodes.indexOf(entry.bookCode);
    return [rank === -1 ? bookCodes.length : rank, ...placement(entry)];
}

function compareKeys(a: number[], b: number[]): number {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const difference = compareBy(a[i] ?? 0, b[i] ?? 0);
        if (difference !== 0) {
            return difference;
        }
    }
    return 0;
}

/**
 * Sort rows (a new array). "title" sorts by title, then tune name.
 * "number" sorts by the number of each row's entry in `book` (the front
 * cover first, an unnumbered book by position); with no book, by each row's
 * first entry, in book order (`bookCodes`, the catalog's codes in book
 * order), so Rejoice's numbers come before the songs only in Great Hymns.
 * Rows without such an entry come last; ties go by title.
 */
export function sortCatalogSongs(
    rows: readonly CatalogSongSummary[],
    sort: CatalogSort,
    book: string | null,
    bookCodes: readonly string[]
): CatalogSongSummary[] {
    if (sort === "title") {
        return [...rows].sort(compareTitles);
    }
    const keys = new Map(rows.map((row) => [row, numberKey(row, book, bookCodes)]));
    return [...rows].sort(
        (a, b) => compareKeys(keys.get(a)!, keys.get(b)!) || compareTitles(a, b)
    );
}

/** One page of the songs list. */
export interface CatalogSongsPage {
    /** The rows on this page. */
    rows: CatalogSongSummary[];
    /** The page shown: the one asked for, clamped to the last. */
    page: number;
    /** How many pages there are, at least 1. */
    totalPages: number;
    /** How many rows there are on every page together. */
    total: number;
}

/** The `page`th page of `pageSize` rows, clamped to the last page (an empty list is page 1 of 1). */
export function pageCatalogSongs(
    rows: readonly CatalogSongSummary[],
    page: number,
    pageSize: number = CATALOG_PAGE_SIZE
): CatalogSongsPage {
    const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
    const shown = Math.min(Math.max(1, Math.floor(page)), totalPages);
    return {
        rows: rows.slice((shown - 1) * pageSize, shown * pageSize),
        page: shown,
        totalPages,
        total: rows.length,
    };
}

/**
 * Filter, sort and page the songs list for a view: the whole of what the
 * view renders. `bookCodes` are the catalog's book codes in book order.
 */
export function selectCatalogSongs(
    rows: readonly CatalogSongSummary[],
    query: CatalogSongsQuery,
    bookCodes: readonly string[],
    pageSize: number = CATALOG_PAGE_SIZE
): CatalogSongsPage {
    const matching = filterCatalogSongs(rows, query);
    const sorted = sortCatalogSongs(matching, query.sort, query.book, bookCodes);
    return pageCatalogSongs(sorted, query.page, pageSize);
}
