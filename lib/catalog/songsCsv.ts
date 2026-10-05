import { toCsv } from "@/lib/csv";
import type { Book, CatalogSongSummary } from "@/lib/domain";
import type { CatalogSongsQuery } from "./filter";
import { lastScheduledDate } from "./lastScheduled";
import { SONG_MARKS, SONG_MARK_LABELS } from "./marks";

/**
 * The songs list as a CSV file (`/catalog`'s Export CSV): which rows and
 * columns it has, and what the file is called. The text itself comes from
 * `lib/csv.ts`. Pure and safe on both sides.
 */

/** What the export needs of a book: its code, to find a song's entries, and its name, for the column's header. */
export type CsvBook = Pick<Book, "code" | "name">;

/**
 * A song's entries in one book, as their labels ("R-396"), joined by "; "
 * when there are several (a descant has a number of its own), and "" when
 * the song is not in the book.
 */
function labelsIn(song: CatalogSongSummary, bookCode: string): string {
    return song.entries
        .filter((entry) => entry.bookCode === bookCode)
        .map((entry) => entry.label)
        .join("; ");
}

/**
 * The records of the export: a header and a record for each song, in the
 * order given. The columns are the title, the tune ("" when it is unknown),
 * one column for each of `books` (in the order given) holding the song's
 * labels in that book, whether the song is linked to a Planning Center song
 * ("yes" or "no"), the date it was last scheduled as `YYYY-MM-DD` ("" when
 * it never was), and a column for each mark ("To learn": "yes" or "no").
 */
export function catalogSongsCsvRecords(
    songs: readonly CatalogSongSummary[],
    books: readonly CsvBook[]
): string[][] {
    return [
        [
            "Title",
            "Tune",
            ...books.map(({ name }) => name),
            "Linked",
            "Last scheduled",
            ...SONG_MARKS.map((mark) => SONG_MARK_LABELS[mark]),
        ],
        ...songs.map((song) => [
            song.title,
            song.tuneName ?? "",
            ...books.map(({ code }) => labelsIn(song, code)),
            song.pcoSongId === null ? "no" : "yes",
            lastScheduledDate(song.lastScheduledAt) ?? "",
            ...SONG_MARKS.map((mark) => (song.marks.includes(mark) ? "yes" : "no")),
        ]),
    ];
}

/** The export as CSV text (`catalogSongsCsvRecords`, written by `toCsv`). */
export function catalogSongsCsv(
    songs: readonly CatalogSongSummary[],
    books: readonly CsvBook[]
): string {
    return toCsv(catalogSongsCsvRecords(songs, books));
}

/**
 * A day as `YYYY-MM-DD` in the local time zone (the viewer's, in the browser)
 * rather than UTC's: for a file saved today, the viewer's own calendar day.
 */
export function localDateStamp(date: Date): string {
    const year = String(date.getFullYear()).padStart(4, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

/**
 * The export's file name: "catalog", then a word for each filter in use, then
 * the day, such as `catalog-unused-2026-10-04.csv` for the songs never
 * scheduled, or `catalog-g-unlinked-2026-10-04.csv` for the songs of book G
 * with no Planning Center song. The words are the book's code in lower case,
 * "linked" or "unlinked", "unused", the mark ("to-learn") and, for a search,
 * "search".
 */
export function catalogCsvFilename(
    filters: Pick<CatalogSongsQuery, "q" | "book" | "linked" | "used"> &
        Partial<Pick<CatalogSongsQuery, "mark">>,
    now: Date
): string {
    const parts = ["catalog"];
    // A book code is letters, digits, "-" and "_" (parseBookCode); keep it so.
    const book = filters.book?.toLowerCase().replace(/[^a-z0-9_-]/g, "") ?? "";
    if (book !== "") {
        parts.push(book);
    }
    if (filters.linked !== "all") {
        parts.push(filters.linked === "yes" ? "linked" : "unlinked");
    }
    if (filters.used === "never") {
        parts.push("unused");
    }
    if (filters.mark !== undefined && filters.mark !== "all") {
        parts.push(filters.mark);
    }
    if (filters.q !== "") {
        parts.push("search");
    }
    parts.push(localDateStamp(now));
    return `${parts.join("-")}.csv`;
}
