import type { CatalogSongSummary, LabelledEntry } from "@/lib/domain";
import { parseEnum, parsePage } from "@/lib/urlState";

/**
 * Searching, filtering, sorting and paging the songs list (`/catalog`). The
 * page loads every song once; the view narrows them in the browser, with the
 * search (`?q=`), book (`?book=`), Planning Center link (`?linked=`), usage
 * (`?used=`), Planning Center tag (`?tag=`), sort (`?sort=`) and page
 * (`?page=`) in the URL. Pure and safe on both sides.
 */

/** How the songs list can be sorted: by title, or by number (within the chosen book). */
export const CATALOG_SORTS = ["title", "number"] as const;

export type CatalogSort = (typeof CATALOG_SORTS)[number];

/**
 * What the link filter keeps: every song, only the songs linked to a Planning
 * Center song ("yes"), or only those that are not ("no").
 */
export const CATALOG_LINKED = ["all", "yes", "no"] as const;

export type CatalogLinked = (typeof CATALOG_LINKED)[number];

/** What the usage filter keeps: every song, or only the songs never scheduled ("never"). */
export const CATALOG_USED = ["all", "never"] as const;

export type CatalogUsed = (typeof CATALOG_USED)[number];

/** Songs per page of the songs list. */
export const CATALOG_PAGE_SIZE = 50;

/** The songs list's view, read from the URL by `parseCatalogSongsQuery`. */
export interface CatalogSongsQuery {
    /** The search, trimmed; "" for none. */
    q: string;
    /** A book's code as the catalog spells it, or null for every book. */
    book: string | null;
    linked: CatalogLinked;
    /** "never" keeps the songs for which `isUsed` is false: not linked, or linked to a song never scheduled. */
    used: CatalogUsed;
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
 * value falls back: no search, every book, linked or not, used or not, by
 * title, page 1. `?book=` is matched without regard to case against
 * `bookCodes` (the catalog's codes) and comes back as the catalog spells it;
 * `?linked=` and `?used=` must be spelled exactly ("yes", "no", "never").
 */
export function parseCatalogSongsQuery(
    params: QueryParams,
    bookCodes: readonly string[]
): CatalogSongsQuery {
    const book = params.get("book")?.toLowerCase();
    return {
        q: params.get("q")?.trim() ?? "",
        book: bookCodes.find((code) => code.toLowerCase() === book) ?? null,
        linked: parseEnum(params.get("linked"), CATALOG_LINKED, "all"),
        used: parseEnum(params.get("used"), CATALOG_USED, "all"),
        sort: parseEnum(params.get("sort"), CATALOG_SORTS, "title"),
        page: parsePage(params.get("page")),
    };
}

/** What `parseEnum` falls back to for `?tag=`: no tag, which is never a tag's id. */
const ANY_TAG = "";

/**
 * Read the tag filter from the query string: the id of one of `tagIds` (the
 * mirror's song tags), spelled exactly, or null for any tag, which is also
 * what a missing, unknown or misspelled value falls back to. It is read
 * apart from `parseCatalogSongsQuery` because it needs the tags, which only
 * the songs list has.
 */
export function parseCatalogTag(params: QueryParams, tagIds: readonly string[]): string | null {
    const tag = parseEnum(params.get("tag"), tagIds, ANY_TAG);
    return tag === ANY_TAG ? null : tag;
}

/**
 * The tag filter, with what it filters by. Tags are Planning Center's, so
 * only a song linked to a Planning Center song has any.
 */
export interface CatalogTagFilter {
    /** The id of the tag a song must have (`parseCatalogTag`). */
    tagId: string;
    /**
     * Each Planning Center song's tag ids, by the song's id (`getTagIdsBySong`,
     * trimmed by `catalogTagIdsBySong`); a song with no tags has no entry.
     */
    tagIdsBySong: Readonly<Record<string, readonly string[]>>;
}

/**
 * The entries of `tagIdsBySong` that the songs list needs: those of the
 * Planning Center songs `rows` are linked to, so the browser gets no tags of
 * songs that are not in the catalog.
 */
export function catalogTagIdsBySong(
    rows: readonly Pick<CatalogSongSummary, "pcoSongId">[],
    tagIdsBySong: Readonly<Record<string, readonly string[]>>
): Record<string, string[]> {
    const trimmed: Record<string, string[]> = {};
    for (const { pcoSongId } of rows) {
        if (pcoSongId !== null && Object.hasOwn(tagIdsBySong, pcoSongId)) {
            trimmed[pcoSongId] = [...tagIdsBySong[pcoSongId]];
        }
    }
    return trimmed;
}

/**
 * Whether a song has been scheduled: its Planning Center song has a last
 * scheduled date. Planning Center counts upcoming plans in it, so "used"
 * means scheduled, not sung. A song that is not linked has no such date (the
 * list reads it through the link), so it is never used.
 */
export function isUsed({ lastScheduledAt }: Pick<CatalogSongSummary, "lastScheduledAt">): boolean {
    return lastScheduledAt !== null;
}

/** Accents a decomposed letter carries ("é" is "e" and U+0301). */
const COMBINING_MARKS = /[\u0300-\u036F]/g;

/** Apostrophes, straight and curly, which join a word rather than split it ("O'er"). */
const APOSTROPHES = /['\u2018\u2019\u02BC]/g;

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

/** Whether a row passes the link filter: linked to a Planning Center song, or not, as asked. */
function matchesLinked(row: CatalogSongSummary, linked: CatalogLinked): boolean {
    return linked === "all" || (row.pcoSongId !== null) === (linked === "yes");
}

/** Whether a row's Planning Center song has the filter's tag; a row that is not linked has no tags. */
function matchesTag(row: CatalogSongSummary, { tagId, tagIdsBySong }: CatalogTagFilter): boolean {
    const { pcoSongId } = row;
    return (
        pcoSongId !== null &&
        Object.hasOwn(tagIdsBySong, pcoSongId) &&
        tagIdsBySong[pcoSongId].includes(tagId)
    );
}

/** What `filterCatalogSongs` narrows by: the query's filters, and the tag filter, if any. */
export type CatalogSongsFilters = Pick<CatalogSongsQuery, "q" | "book" | "linked" | "used"> & {
    /** The tag filter; none (every song) when it is null or left out. */
    tag?: CatalogTagFilter | null;
};

/**
 * The rows that match `q` (see `matchesSearch`; a search with no letters or
 * digits matches every row) and, when `book` is a code, have an entry in
 * that book; with `linked` "yes" or "no", are or are not linked to a Planning
 * Center song; with `used` "never", are not used (see `isUsed`); and with a
 * `tag` filter, are linked to a Planning Center song that has the tag. Keeps
 * the rows' order.
 */
export function filterCatalogSongs(
    rows: readonly CatalogSongSummary[],
    { q, book, linked, used, tag = null }: CatalogSongsFilters
): CatalogSongSummary[] {
    const search = prepareSearch(q);
    return rows.filter(
        (row) =>
            (book === null || row.entries.some(({ bookCode }) => bookCode === book)) &&
            matchesLinked(row, linked) &&
            (used === "all" || !isUsed(row)) &&
            (tag === null || matchesTag(row, tag)) &&
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
 * Every row the view's filters leave (the tag filter too, when the query
 * has one), in the chosen sort order and not paged: what "Export CSV"
 * writes. `bookCodes` are the catalog's book codes in book order.
 */
export function arrangeCatalogSongs(
    rows: readonly CatalogSongSummary[],
    query: Omit<CatalogSongsQuery, "page"> & Pick<CatalogSongsFilters, "tag">,
    bookCodes: readonly string[]
): CatalogSongSummary[] {
    const matching = filterCatalogSongs(rows, query);
    return sortCatalogSongs(matching, query.sort, query.book, bookCodes);
}

/**
 * Filter, sort and page the songs list for a view: the whole of what the
 * view renders. `bookCodes` are the catalog's book codes in book order.
 */
export function selectCatalogSongs(
    rows: readonly CatalogSongSummary[],
    query: CatalogSongsQuery & Pick<CatalogSongsFilters, "tag">,
    bookCodes: readonly string[],
    pageSize: number = CATALOG_PAGE_SIZE
): CatalogSongsPage {
    return pageCatalogSongs(arrangeCatalogSongs(rows, query, bookCodes), query.page, pageSize);
}
