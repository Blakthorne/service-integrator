/** A noun's singular and plural, for counts: `{ one: "song", other: "songs" }`. */
export interface CountNoun {
    one: string;
    other: string;
}

/** A whole number as the lists print it: "921", "1,247". The same on server and browser. */
function formatCount(count: number): string {
    return count.toLocaleString("en-US");
}

/** "1 song", "921 songs", "1,247 entries". */
export function formatCountOf(count: number, noun: CountNoun): string {
    return `${formatCount(count)} ${count === 1 ? noun.one : noun.other}`;
}

/**
 * The count line above a list that can be narrowed: "921 songs" when every
 * row is shown, "12 of 921 songs" when a search or filter leaves `matching`
 * of the `all` rows (none: "0 of 921 songs").
 */
export function formatMatchCount(
    matching: number,
    all: number,
    noun: CountNoun
): string {
    return matching === all
        ? formatCountOf(all, noun)
        : `${formatCount(matching)} of ${formatCountOf(all, noun)}`;
}
