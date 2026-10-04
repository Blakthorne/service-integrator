/**
 * Small pure helpers shared by the books pages. Not a client module, so both
 * the server components that render rows and the client component that jumps
 * to one can import them.
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
