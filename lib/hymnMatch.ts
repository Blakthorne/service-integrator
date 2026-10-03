import type { HymnData } from "./domain";
import type { RawHymn } from "./unusedHymns";

/**
 * Group a hymnbook catalog by lowercased song title so every tune variant of a
 * hymn (one catalog record each) ends up under the same key, in catalog order.
 * Pure: the catalog is passed in, so this module never imports hymns.json.
 */
export function buildHymnIndex(catalog: RawHymn[]): Map<string, RawHymn[]> {
    // Group hymns by song title to handle multiple versions (case-insensitive)
    const hymnsBySongTitle = new Map<string, RawHymn[]>();
    catalog.forEach((hymn) => {
        const lowerCaseTitle = hymn.song_title.toLowerCase();
        const existingHymns = hymnsBySongTitle.get(lowerCaseTitle) || [];
        hymnsBySongTitle.set(lowerCaseTitle, [...existingHymns, hymn]);
    });
    return hymnsBySongTitle;
}

/**
 * Look up hymnbook numbers for requested song titles. Each title is matched
 * against `index` by its lowercased text (exact otherwise: no trimming and no
 * punctuation or quote normalization). The result echoes the *requested* title
 * as `song_title`, lists one version per catalog record in catalog order, and
 * omits titles with no match. `selected` is true only when a title has exactly
 * one version. A non-array `titles` yields `[]`; a non-string entry throws.
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
            const matchingHymns = index.get(title.toLowerCase()) || [];
            return {
                song_title: title,
                versions: matchingHymns.map((hymn: RawHymn, i: number) => ({
                    id: `${hymn.song_title}-${i}`, // Generate a unique ID
                    tune_name: hymn.tune_name,
                    rejoice_hymns_number: hymn.rejoice_hymns.toString(),
                    great_hymns_number: hymn.great_hymns_of_the_faith.toString(),
                    selected: matchingHymns.length === 1, // Auto-select if only one version exists
                })),
            };
        })
        .filter((result) => result.versions.length > 0);

    return processedHymns;
}
