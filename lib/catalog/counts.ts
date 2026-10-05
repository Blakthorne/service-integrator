/**
 * How the catalog pages word counts. The numbers are grouped for en-US
 * explicitly, so the server's HTML and the browser's render agree.
 */

/** 1247 → "1,247": grouped the same way on the server and in every browser. */
export function formatCount(count: number): string {
    return count.toLocaleString("en-US");
}

/** "1 book", "921 songs", "1,247 entries" (pass the plural when it is not "-s"). */
export function countOf(
    count: number,
    singular: string,
    plural: string = `${singular}s`
): string {
    return `${formatCount(count)} ${count === 1 ? singular : plural}`;
}

/**
 * The count line above a list that can be narrowed: "921 songs" when every
 * row is shown, "12 of 921 songs" when a search or filter leaves `matching`
 * of the `all` rows (none: "0 of 921 songs"). The total decides the noun.
 */
export function formatMatchCount(
    matching: number,
    all: number,
    singular: string,
    plural: string = `${singular}s`
): string {
    const total = countOf(all, singular, plural);
    return matching === all ? total : `${formatCount(matching)} of ${total}`;
}
