/**
 * Fuzzy comparison of titles: how many single-character edits apart two
 * strings are, and whether two normalized titles are close enough to be one
 * title spelt two ways. Pure and safe on both sides.
 */

/** Two titles are a near match when at most this many edits apart… */
export const NEAR_MATCH_MAX_DISTANCE = 2;

/** …and both are at least this long. */
const NEAR_MATCH_MIN_LENGTH = 6;

/** Classic two-row Levenshtein edit distance. */
export function levenshtein(a: string, b: string): number {
    const m = a.length;
    const n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    let prev = Array.from({ length: n + 1 }, (_, i) => i);
    let curr = new Array<number>(n + 1);
    for (let i = 1; i <= m; i++) {
        curr[0] = i;
        for (let j = 1; j <= n; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
        }
        [prev, curr] = [curr, prev];
    }
    return prev[n];
}

/** True when two normalized titles are close but not equal (a likely typo/variant). */
export function isNearMatch(a: string, b: string): boolean {
    if (a === b) return false;
    if (a.length < NEAR_MATCH_MIN_LENGTH || b.length < NEAR_MATCH_MIN_LENGTH) {
        return false;
    }
    if (Math.abs(a.length - b.length) > NEAR_MATCH_MAX_DISTANCE) return false;
    return levenshtein(a, b) <= NEAR_MATCH_MAX_DISTANCE;
}
