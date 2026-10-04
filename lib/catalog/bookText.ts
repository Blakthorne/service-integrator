/**
 * Small pure helpers shared by the books pages, safe on both sides: the
 * server components that render rows and the client component that jumps to
 * one import the same ones.
 */

/**
 * The DOM id of the row of the entry numbered `number`, which "Go to number"
 * scrolls to. A book has at most one entry per number.
 */
export function entryRowId(number: number): string {
    return `entry-${number}`;
}

/** "1 entry", "708 entries". */
export function formatEntryCount(count: number): string {
    return `${count} ${count === 1 ? "entry" : "entries"}`;
}

/**
 * The id of the Add a book form's section on the books page, which a link
 * with `#` and this id scrolls to (`routes.catalogBookAdd`).
 */
export const ADD_BOOK_ID = "add-book";

/** The notice at the top of the page of a book that is not in use. */
export const NOT_IN_USE_NOTICE =
    "This book is not in use. Its entries are still listed here, but they are left out of the schedule text, the hymnal notes and the songs list's book filter. Edit the book to put it back in use.";

/**
 * What the page of a book without numbers says about its order: its entries
 * are kept in a list, which the buttons in each row put in order, and a new
 * entry goes at the end of it.
 */
export const UNNUMBERED_ORDER_NOTE =
    "This book has no numbers, so its entries are kept in a list. Use the arrows in a row to move an entry up or down. A song's page adds it to the end of the list.";
