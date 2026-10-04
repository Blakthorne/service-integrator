import { isNearMatch } from "./fuzzy";
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

function toHymnEntry(h: RawHymn): HymnEntry {
    return {
        songTitle: h.song_title,
        tuneName: h.tune_name,
        rejoiceNumber: h.rejoice_hymns > 0 ? h.rejoice_hymns : null,
        greatHymnsNumber:
            h.great_hymns_of_the_faith > 0 ? h.great_hymns_of_the_faith : null,
    };
}

/**
 * Determine which hymnbook entries (one per hymns.json record / tune-variant)
 * have never been scheduled in PCO. Pure: no I/O. `computedAt` is supplied so the
 * function stays deterministic for tests.
 *
 * - Exact normalized title match to a used PCO song:
 *     - unique title  -> used (excluded)
 *     - multi-tune title -> used only if the PCO title names this tune;
 *       otherwise the variant goes to the review bucket (ambiguous tune)
 * - Near (but not exact) match to a used title -> review bucket (near-match)
 * - No match at all -> unused
 */
export function computeUnusedHymns(
    hymns: RawHymn[],
    pcoSongs: PcoSong[],
    computedAt: string
): UnusedHymnsResult {
    // Normalized title -> original PCO titles (kept for tune attribution + display).
    // We index each used PCO song under both its full normalized title AND the
    // normalized base title (stripping any parenthetical suffix such as a tune
    // name or key). This lets us match "Abba, Father (PRITCHARD)" against the
    // hymn entry for "Abba, Father".
    const usedNormToOriginals = new Map<string, string[]>();
    function addToIndex(normKey: string, originalTitle: string) {
        if (normKey.length === 0) return;
        const originals = usedNormToOriginals.get(normKey) ?? [];
        if (!originals.includes(originalTitle)) originals.push(originalTitle);
        usedNormToOriginals.set(normKey, originals);
    }
    for (const song of pcoSongs) {
        if (song.lastScheduledAt == null) continue;
        const norm = normalizeTitle(song.title);
        addToIndex(norm, song.title);
        // Also index by base title (strip leading parenthetical content).
        const baseNorm = normalizeTitle(song.title.replace(/\s*\(.*\)\s*$/, "").trim());
        if (baseNorm !== norm) {
            addToIndex(baseNorm, song.title);
        }
    }
    const usedNormTitles = [...usedNormToOriginals.keys()];

    // How many tune-variants share each normalized hymn title.
    const variantCount = new Map<string, number>();
    for (const h of hymns) {
        const norm = normalizeTitle(h.song_title);
        variantCount.set(norm, (variantCount.get(norm) ?? 0) + 1);
    }

    const unused: HymnEntry[] = [];
    const review: ReviewEntry[] = [];
    const totals = { rejoice: 0, greatHymns: 0 };

    for (const h of hymns) {
        if (h.rejoice_hymns > 0) totals.rejoice++;
        if (h.great_hymns_of_the_faith > 0) totals.greatHymns++;

        const entry = toHymnEntry(h);
        const norm = normalizeTitle(h.song_title);
        const isMultiTune = (variantCount.get(norm) ?? 0) > 1;
        const usedOriginals = usedNormToOriginals.get(norm);

        if (usedOriginals) {
            if (!isMultiTune) {
                continue; // unique title, confidently used
            }
            // Check whether a given tune name is explicitly mentioned in the
            // extra portion of a PCO title (beyond the base song title).
            const isTuneNamedInOriginals = (tuneNorm: string): boolean =>
                tuneNorm.length > 0 &&
                usedOriginals.some((orig) => {
                    const origNorm = normalizeTitle(orig);
                    // Only look at the extra suffix (parenthetical, etc.) to
                    // avoid false positives when the tune name equals the song
                    // title itself.
                    const extra = origNorm.startsWith(norm)
                        ? origNorm.slice(norm.length)
                        : origNorm;
                    return extra.includes(tuneNorm);
                });

            const tuneNorm = normalizeTitle(h.tune_name);
            if (isTuneNamedInOriginals(tuneNorm)) {
                continue; // this specific tune was named in a used PCO title
            }

            // This variant's tune was not named. Only treat it as unused when
            // EVERY used original names some (other) specific tune — positive
            // evidence each scheduling referred to a different tune. If any used
            // original is tune-less, that scheduling is ambiguous and could refer
            // to this variant, so route it to review rather than mislabel it unused.
            const allOriginalsNameATune = usedOriginals.every((orig) => {
                const origNorm = normalizeTitle(orig);
                const extra = origNorm.startsWith(norm)
                    ? origNorm.slice(norm.length)
                    : origNorm;
                return extra.trim().length > 0;
            });

            if (allOriginalsNameATune) {
                unused.push(entry);
            } else {
                review.push({
                    ...entry,
                    reason: "ambiguous-tune",
                    matchedPcoTitle: usedOriginals[0],
                });
            }
            continue;
        }

        const near = usedNormTitles.find((u) => isNearMatch(norm, u));
        if (near) {
            review.push({
                ...entry,
                reason: "near-match",
                matchedPcoTitle: usedNormToOriginals.get(near)![0],
            });
            continue;
        }

        unused.push(entry);
    }

    return {
        unused,
        review,
        meta: {
            songsScanned: pcoSongs.length,
            usedTitleCount: usedNormToOriginals.size,
            computedAt,
            totals,
        },
    };
}

/**
 * Whichever of two results was computed later, by `meta.computedAt`: the
 * candidate if it is strictly later, otherwise `current`. A missing candidate,
 * a tie and an unparseable timestamp all keep `current`.
 */
export function newerResult(
    current: UnusedHymnsResult,
    candidate: UnusedHymnsResult | null
): UnusedHymnsResult {
    if (
        candidate !== null &&
        Date.parse(candidate.meta.computedAt) > Date.parse(current.meta.computedAt)
    ) {
        return candidate;
    }
    return current;
}
