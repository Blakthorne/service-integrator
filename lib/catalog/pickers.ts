import type { CatalogSongOption, UnlinkedPcoSong } from "@/lib/domain";
import { foldForSearch } from "./filter";

/**
 * Searching the pickers that choose a catalog song, hymn or tune (Reconcile's
 * "Choose another song", the new-song form's hymn and tune), and Reconcile's
 * list of Planning Center songs not in the catalog. Pure and safe on both
 * sides: a page sends its options once, and the browser searches them as
 * the person types, folding text as the songs list does (`foldForSearch`).
 */

/** A hymn as the new-song form's picker lists it. */
export interface HymnOption {
    id: number;
    title: string;
    /** Its other titles, which search also matches. */
    aliases: string[];
    /** The tunes it is sung to in the catalog, by name; null for a song with no tune. */
    tunes: (string | null)[];
}

/** A tune as the new-song form's picker lists it. */
export interface TuneOption {
    id: number;
    name: string;
    /** Its other names, which search also matches. */
    aliases: string[];
    meter: string | null;
}

/** How many matches a picker shows at once. */
export const PICKER_LIMIT = 8;

/** A song option's line under its title: its tune ("no tune" when unknown) and its entries' labels. */
export function describeSongOption(song: CatalogSongOption): string {
    return [song.tuneName ?? "no tune", song.labels.join(", ")].filter(Boolean).join(" · ");
}

/** A hymn option's line under its title: the tunes it is sung to ("no tune" for a song without one). */
export function describeHymnOption(hymn: HymnOption): string {
    return hymn.tunes.length === 0
        ? "No song yet"
        : `Sung to ${hymn.tunes.map((tune) => tune ?? "no tune").join(", ")}`;
}

/** A tune option's line under its name: its meter and its other names, or "" when it has neither. */
export function describeTuneOption(tune: TuneOption): string {
    return [tune.meter, tune.aliases.length > 0 ? `also ${tune.aliases.join(", ")}` : null]
        .filter(Boolean)
        .join(" · ");
}

/**
 * What a picker says about its matches, for the line under its search
 * field (read out as it changes): a prompt before anything is typed, then
 * how many match, and that typing more narrows a long list.
 */
export function describePickerMatches(
    query: string,
    { matches, total }: PickerMatches<unknown>
): string {
    if (foldForSearch(query) === "") {
        return "Type to search.";
    }
    if (total === 0) {
        return "Nothing matches.";
    }
    if (matches.length < total) {
        return `Showing ${matches.length} of ${total} matches: type more to narrow them.`;
    }
    return total === 1 ? "1 match." : `${total} matches.`;
}

/** What a picker shows for a search: the best matches, and how many there are in all. */
export interface PickerMatches<T> {
    /** The best matches, at most the limit, best first. */
    matches: T[];
    /** How many options match. */
    total: number;
}

/** What an option is searched by, folded once. */
interface SearchData {
    /** Its main name (a title, a tune's name). */
    name: string;
    /** Its other names (other titles, a tune's name or other names). */
    otherNames: string[];
    /** Every name and anything else it is found by, one per line. */
    text: string;
    /** Its entry labels without punctuation or spaces ("r396", "gfrontcover"). */
    labels: Set<string>;
    /** The numbers in its entry labels ("396"). */
    numbers: Set<string>;
}

/** A search, prepared once for every option it is tested against. */
interface Search {
    /** It, folded. */
    folded: string;
    /** Its words, each to be found in an option's text. */
    words: string[];
    /** It as a label ("r396"). */
    label: string;
}

function prepareSearch(query: string): Search | null {
    const folded = foldForSearch(query);
    return folded === ""
        ? null
        : { folded, words: folded.split(" "), label: folded.replace(/ /g, "") };
}

function searchData(
    name: string,
    otherNames: readonly string[],
    extra: readonly string[] = [],
    labels: readonly string[] = []
): SearchData {
    const folded = foldForSearch(name);
    const others = otherNames.map(foldForSearch);
    return {
        name: folded,
        otherNames: others,
        text: [folded, ...others, ...extra.map(foldForSearch)].join("\n"),
        labels: new Set(labels.map((label) => foldForSearch(label).replace(/ /g, ""))),
        numbers: new Set(labels.flatMap((label) => label.match(/[0-9]+/g) ?? [])),
    };
}

/**
 * How well an option matches, best first, or null when it does not: its
 * label or number (0), its name exactly (0), the start of its name (1), the
 * start of another of its names (2), or every word somewhere in it (3).
 */
function rank(data: SearchData, search: Search): number | null {
    if (
        data.labels.has(search.label) ||
        data.numbers.has(search.folded) ||
        data.name === search.folded
    ) {
        return 0;
    }
    if (data.name.startsWith(search.folded)) {
        return 1;
    }
    if (data.otherNames.some((name) => name.startsWith(search.folded))) {
        return 2;
    }
    return search.words.every((word) => data.text.includes(word)) ? 3 : null;
}

/**
 * Make a search over options of one kind, whose search data is worked out
 * once per option (the options come from the server once and stay the same
 * objects while the person types; a weak map lets gone ones be collected).
 */
function searcher<T extends object>(dataOf: (option: T) => SearchData) {
    const cache = new WeakMap<T, SearchData>();
    const cached = (option: T) => {
        let data = cache.get(option);
        if (!data) {
            data = dataOf(option);
            cache.set(option, data);
        }
        return data;
    };
    return (options: readonly T[], query: string, limit = PICKER_LIMIT): PickerMatches<T> => {
        const search = prepareSearch(query);
        if (search === null) {
            return { matches: [], total: 0 };
        }
        const ranked: { option: T; rank: number }[] = [];
        for (const option of options) {
            const found = rank(cached(option), search);
            if (found !== null) {
                ranked.push({ option, rank: found });
            }
        }
        // Array.prototype.sort is stable, so each rank keeps the options' order.
        ranked.sort((a, b) => a.rank - b.rank);
        return {
            matches: ranked.slice(0, limit).map(({ option }) => option),
            total: ranked.length,
        };
    };
}

/**
 * The catalog songs a search finds, best first, at most `limit`: by an
 * entry's label or number ("R-396", "396"), by title, or by words of the
 * title and tune name. A search with no letters or digits finds nothing.
 */
export const searchSongOptions = searcher<CatalogSongOption>((song) =>
    searchData(song.title, song.tuneName === null ? [] : [song.tuneName], [], song.labels)
);

/** The hymns a search finds, best first: by title or other title, or by words of them and their tunes' names. */
export const searchHymnOptions = searcher<HymnOption>((hymn) =>
    searchData(
        hymn.title,
        hymn.aliases,
        hymn.tunes.flatMap((tune) => (tune === null ? [] : [tune]))
    )
);

/** The tunes a search finds, best first: by name or other name, or by words of them. */
export const searchTuneOptions = searcher<TuneOption>((tune) =>
    searchData(tune.name, tune.aliases)
);

/**
 * The Planning Center songs on Reconcile's list whose title or author has
 * every word of `query`, in any order, as the songs list searches
 * (`foldForSearch`). A search with no letters or digits keeps every row.
 * Keeps the rows' order.
 */
export function filterUnlinkedPcoSongs(
    rows: readonly UnlinkedPcoSong[],
    query: string
): UnlinkedPcoSong[] {
    const search = prepareSearch(query);
    if (search === null) {
        return [...rows];
    }
    return rows.filter(({ pcoSong }) => {
        const text = `${foldForSearch(pcoSong.title)}\n${foldForSearch(pcoSong.author ?? "")}`;
        return search.words.every((word) => text.includes(word));
    });
}
