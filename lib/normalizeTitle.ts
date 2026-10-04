/**
 * Normalize a song title for tolerant comparison between PCO's free-text titles
 * and hymns.json titles. Lowercase, straighten curly quotes (U+2018, U+2019,
 * U+02BC and U+2032 become ', and U+201C, U+201D and U+2033 become "), expand
 * "&" to "and", collapse whitespace, and drop trailing punctuation.
 *
 * The quote classes are escape sequences on purpose: written as literal
 * characters, they were once silently turned into straight quotes.
 */
export function normalizeTitle(raw: string): string {
    return raw
        .toLowerCase()
        .replace(/[\u2018\u2019\u02BC\u2032]/g, "'")
        .replace(/[\u201C\u201D\u2033]/g, '"')
        .replace(/&/g, " and ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/[.,!?;:]+$/g, "")
        .trim();
}
