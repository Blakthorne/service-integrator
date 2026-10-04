import "server-only";
import { parseBookCode, parseCatalogId } from "@/lib/catalog/ids";
import { getDb } from "@/lib/db";
import {
    countCatalog,
    findBook,
    findBookLabel,
    findCatalogSong,
    findCatalogSongLabel,
    findTune,
    findTuneLabel,
    listBooks,
    listCatalogSongs,
    listTunes,
} from "@/lib/db/catalog";
import type {
    BookDetail,
    BookSummary,
    CatalogCounts,
    CatalogSongDetail,
    CatalogSongSummary,
    TuneDetail,
    TuneSummary,
} from "@/lib/domain";

/**
 * The song catalog, for its pages. Each read is synchronous (the database is
 * local) and throws when the database cannot be opened, which the page's
 * error boundary shows; the `…Label` functions for `generateMetadata` never
 * throw. Detail reads take an ID that `parseCatalogId` (or a code that
 * `parseBookCode`) already checked, and return null when there is no such
 * row, for the page's `notFound()`.
 */

/** Every song as a row of the songs list, by title, then tune name. Empty before the seed import. */
export function getCatalogSongs(): CatalogSongSummary[] {
    return listCatalogSongs(getDb());
}

/** One song with its hymn, tune, entries and relatives, or null. */
export function getCatalogSong(songId: number): CatalogSongDetail | null {
    return findCatalogSong(getDb(), songId);
}

/** Every tune with its song count, by name. */
export function getCatalogTunes(): TuneSummary[] {
    return listTunes(getDb());
}

/** One tune with its songs, or null. */
export function getCatalogTune(tuneId: number): TuneDetail | null {
    return findTune(getDb(), tuneId);
}

/** Every book with its entry count, in book order, in use or not: the books page lists them all. */
export function getCatalogBooks(): BookSummary[] {
    return listBooks(getDb());
}

/**
 * The books in use, with their entry counts, in book order: what the songs
 * list's book filter offers. A book not in use stays browsable on the books
 * page, but is left out of the filter, the schedule text and the hymnal
 * notes.
 */
export function getActiveCatalogBooks(): BookSummary[] {
    return listBooks(getDb(), { activeOnly: true });
}

/** The book with this code, in any case, with its entries in browse order, or null. */
export function getCatalogBook(code: string): BookDetail | null {
    return findBook(getDb(), code);
}

/** How many books, hymns, tunes, songs and entries the catalog holds; all zero before the seed import. */
export function getCatalogCounts(): CatalogCounts {
    return countCatalog(getDb());
}

/**
 * A page-title label for `generateMetadata` (convention 12): the label `find`
 * gives for a key that passed `parse`, or `fallback` when the key is invalid
 * (the page renders the 404), there is no such row, or reading fails (logged).
 * Never throws, and never calls `find` for a key that does not parse.
 */
export function labelOr<K>(
    raw: string,
    parse: (raw: unknown) => K | null,
    find: (key: K) => string | null,
    fallback: string
): string {
    const key = parse(raw);
    if (key === null) {
        return fallback;
    }
    try {
        return find(key) ?? fallback;
    } catch (error) {
        console.error(
            `Failed to load the label for ${fallback.toLowerCase()} ${raw}:`,
            error
        );
        return fallback;
    }
}

/** A song page's title, "Amazing Grace (NEW BRITAIN)", or "Song". Never throws. */
export function getCatalogSongLabel(songId: string): string {
    return labelOr(
        songId,
        parseCatalogId,
        (id) => findCatalogSongLabel(getDb(), id),
        "Song"
    );
}

/** A tune page's title, its name, or "Tune". Never throws. */
export function getCatalogTuneLabel(tuneId: string): string {
    return labelOr(
        tuneId,
        parseCatalogId,
        (id) => findTuneLabel(getDb(), id),
        "Tune"
    );
}

/** A book page's title, its name, or "Book". Never throws. */
export function getCatalogBookLabel(code: string): string {
    return labelOr(
        code,
        parseBookCode,
        (key) => findBookLabel(getDb(), key),
        "Book"
    );
}
