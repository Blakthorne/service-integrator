import type { HymnData } from "./domain";
import { normalizeTitle } from "./normalizeTitle";
import type { RawHymn } from "./unusedHymns";

/**
 * Group a hymnbook catalog by normalized song title (see normalizeTitle) so
 * every tune variant of a hymn (one catalog record each) ends up under the
 * same key, in catalog order. Titles that differ only by case, curly quotes,
 * spacing or trailing punctuation share a key, so "Jesus Saves" and
 * "Jesus Saves!" are grouped together. Pure: the catalog is passed in, so
 * this module never imports hymns.json.
 */
export function buildHymnIndex(catalog: RawHymn[]): Map<string, RawHymn[]> {
    const hymnsBySongTitle = new Map<string, RawHymn[]>();
    catalog.forEach((hymn) => {
        const key = normalizeTitle(hymn.song_title);
        const existingHymns = hymnsBySongTitle.get(key) || [];
        hymnsBySongTitle.set(key, [...existingHymns, hymn]);
    });
    return hymnsBySongTitle;
}

/**
 * Look up hymnbook numbers for requested song titles. Each title is matched
 * against `index` by its normalized form, so case, curly quotes, spacing and
 * trailing punctuation don't matter. A match lists one version per catalog
 * record: first the records whose title equals the request ignoring case (the
 * only ones the lookup found before titles were normalized, so a title that
 * already matched keeps its default version), then the records found only
 * through normalization, each group in catalog order. The result echoes the
 * *requested* title as `song_title` and omits titles with no match. A
 * non-array `titles` yields `[]`; a non-string entry throws.
 */
export function matchHymns(
    index: Map<string, RawHymn[]>,
    titles: unknown
): HymnData[] {
    if (!Array.isArray(titles)) {
        return [];
    }

    const processedHymns: HymnData[] = titles
        .map((title: string) => {
            const candidates = index.get(normalizeTitle(title)) || [];
            const requested = title.toLowerCase();
            const isExact = (hymn: RawHymn) =>
                hymn.song_title.toLowerCase() === requested;
            const matchingHymns = [
                ...candidates.filter(isExact),
                ...candidates.filter((hymn) => !isExact(hymn)),
            ];
            return {
                song_title: title,
                versions: matchingHymns.map((hymn: RawHymn, i: number) => ({
                    id: `${hymn.song_title}-${i}`, // Generate a unique ID
                    tune_name: hymn.tune_name,
                    rejoice_hymns_number: hymn.rejoice_hymns.toString(),
                    great_hymns_number: hymn.great_hymns_of_the_faith.toString(),
                })),
            };
        })
        .filter((result) => result.versions.length > 0);

    return processedHymns;
}
