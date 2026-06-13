import { normalizeTitle } from "./normalizeTitle";

export interface RawHymn {
    song_title: string;
    tune_name: string;
    great_hymns_of_the_faith: number;
    rejoice_hymns: number;
}

export interface PcoSong {
    title: string;
    lastScheduledAt: string | null;
}

export interface HymnEntry {
    songTitle: string;
    tuneName: string;
    rejoiceNumber: number | null;
    greatHymnsNumber: number | null;
}

export interface ReviewEntry extends HymnEntry {
    reason: "ambiguous-tune" | "near-match";
    matchedPcoTitle: string;
}

export interface UnusedHymnsResult {
    unused: HymnEntry[];
    review: ReviewEntry[];
    meta: {
        songsScanned: number;
        usedTitleCount: number;
        computedAt: string;
        totals: { rejoice: number; greatHymns: number };
    };
}

const NEAR_MATCH_MAX_DISTANCE = 2;
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
