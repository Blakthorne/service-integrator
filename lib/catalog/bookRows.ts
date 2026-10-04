import type { BookDetail } from "@/lib/domain";
import { entryNotes } from "./entryNotes";

/**
 * A row of a book's page: what its table shows, and nothing it can work out.
 *
 * The page sends every row of a book (hundreds) to a client component as one
 * prop, which Next serialises as a single piece that compresses well. A
 * server-rendered table sent each row's elements as a chunk of its own, and
 * `next start` compressed each chunk separately: the book of 708 entries cost
 * about 300 KB on the wire. Every field here is paid for once per row, so the
 * entry's other columns (its ids, its book's code, the song's Planning Center
 * link) stay out, with one exception: a book without numbers lists its
 * entries in an order that can be changed, so each of its rows has the
 * entry's id for its Move up and Move down buttons (`entryId`).
 */
export interface BookRow {
    /**
     * The entry's number, which anchors the row for "Go to number". Null for
     * an entry at a location (the front cover) and in an unnumbered book.
     */
    number: number | null;
    /**
     * The first column: a numbered book's label ("R-396", "G-Front Cover"), or
     * an unnumbered book's position in it ("12", or a dash with none).
     */
    placement: string;
    /** The song the row links to. */
    songId: number;
    /** The hymn's title. */
    title: string;
    /** The tune's name, or null when it is not known. */
    tune: string | null;
    /** The entry's variant note and location, as `entryNotes` words them, joined; empty with none. */
    note: string;
    /**
     * The entry's id, so it can be moved up and down. Only in a book without
     * numbers, whose entries are ordered by hand; a numbered book's rows have
     * none, to keep its hundreds of rows lean.
     */
    entryId?: number;
}

/**
 * The rows of a book's page, from the book as `getCatalogBook` reads it, in
 * the same (browse) order.
 */
export function toBookRows(
    book: Pick<BookDetail, "numbered" | "entries">
): BookRow[] {
    return book.entries.map((entry) => ({
        number: entry.number,
        placement: book.numbered
            ? entry.label
            : entry.position === null
              ? "—"
              : String(entry.position),
        songId: entry.songId,
        title: entry.title,
        tune: entry.tuneName,
        note: entryNotes(book, entry).join(" · "),
        ...(book.numbered ? {} : { entryId: entry.id }),
    }));
}
