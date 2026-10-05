import type { TuneSummary } from "@/lib/domain";
import { parsePage } from "@/lib/urlState";
import { foldForSearch } from "./filter";

/**
 * Searching and paging the tunes list (`/catalog/tunes`), as
 * `lib/catalog/filter.ts` does for the songs list: the page loads every
 * tune once, and the view narrows them in the browser, with the search
 * (`?q=`) and page (`?page=`) in the URL. Pure and safe on both sides.
 */

/** What the tunes list shows and searches of a tune: everything but its notes. */
export type CatalogTuneRow = Pick<
    TuneSummary,
    "id" | "name" | "meter" | "aliases" | "songCount"
>;

/** A tune as a row of the tunes list, so the page sends the browser no more than the list shows. */
export function toCatalogTuneRow({
    id,
    name,
    meter,
    aliases,
    songCount,
}: TuneSummary): CatalogTuneRow {
    return { id, name, meter, aliases, songCount };
}

/** Tunes per page of the tunes list. */
export const CATALOG_TUNES_PAGE_SIZE = 50;

/** The tunes list's view, read from the URL by `parseCatalogTunesQuery`. */
export interface CatalogTunesQuery {
    /** The search, trimmed; "" for none. */
    q: string;
    /** The page asked for, at least 1; `selectCatalogTunes` clamps it to the last page. */
    page: number;
}

/** What `useSearchParams()` and `URLSearchParams` both offer. */
interface QueryParams {
    get(name: string): string | null;
}

/** Read the tunes list's view from the query string: no search and page 1 when missing or bad. */
export function parseCatalogTunesQuery(params: QueryParams): CatalogTunesQuery {
    return {
        q: params.get("q")?.trim() ?? "",
        page: parsePage(params.get("page")),
    };
}

/**
 * The rows whose name or other names hold every word of `q`, in any order
 * and ignoring case, accents and punctuation (`foldForSearch`, as the songs
 * list searches): "darwal" finds DARWALL by its other name DARWAL, and
 * "st anne" finds ST. ANNE. A search with no letters or digits keeps every
 * row. Keeps the rows' order.
 */
export function filterCatalogTunes<T extends CatalogTuneRow>(
    rows: readonly T[],
    q: string
): T[] {
    const folded = foldForSearch(q);
    if (folded === "") {
        return [...rows];
    }
    const words = folded.split(" ");
    return rows.filter((row) => {
        const text = [row.name, ...row.aliases].map(foldForSearch).join("\n");
        return words.every((word) => text.includes(word));
    });
}

/** One page of the tunes list. */
export interface CatalogTunesPage<T> {
    /** The rows on this page. */
    rows: T[];
    /** The page shown: the one asked for, clamped to the last. */
    page: number;
    /** How many pages there are, at least 1. */
    totalPages: number;
    /** How many rows match, on every page together. */
    total: number;
}

/** Search and page the tunes list for a view: the whole of what the view renders. */
export function selectCatalogTunes<T extends CatalogTuneRow>(
    rows: readonly T[],
    query: CatalogTunesQuery,
    pageSize: number = CATALOG_TUNES_PAGE_SIZE
): CatalogTunesPage<T> {
    const matching = filterCatalogTunes(rows, query.q);
    const totalPages = Math.max(1, Math.ceil(matching.length / pageSize));
    const page = Math.min(Math.max(1, Math.floor(query.page)), totalPages);
    return {
        rows: matching.slice((page - 1) * pageSize, page * pageSize),
        page,
        totalPages,
        total: matching.length,
    };
}
