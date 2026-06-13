/**
 * Normalize a song title for tolerant comparison between PCO's free-text titles
 * and hymns.json titles. Lowercase, straighten smart quotes, expand "&" to "and",
 * collapse whitespace, and drop trailing punctuation.
 */
export function normalizeTitle(raw: string): string {
    return raw
        .toLowerCase()
        .replace(/[''ʼ′]/g, "'")
        .replace(/[""″]/g, '"')
        .replace(/&/g, " and ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/[.,!?;:]+$/g, "")
        .trim();
}
