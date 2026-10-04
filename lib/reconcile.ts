import { normalizeTuneName } from "./catalog/normalize";
import type {
    CatalogMatch,
    CatalogSongSummary,
    LinkReason,
    LinkSuggestion,
    MirroredPcoSong,
    PcoLibrarySong,
} from "./domain";
import { NEAR_MATCH_MAX_DISTANCE, isNearMatch } from "./fuzzy";
import { normalizeTitle } from "./normalizeTitle";

/**
 * Linking Planning Center songs to catalog songs by what their titles say:
 * the suggestions a person chooses from, and the links a sync makes on its
 * own. Pure and safe on both sides: the catalog comes in as an index
 * (`buildCatalogIndex`), the Planning Center songs as values, and
 * lib/db/links.ts makes the links.
 *
 * A Planning Center song is one hymn to one tune. Its title names the hymn,
 * by title or alias, and sometimes the tune in a trailing parenthetical:
 * "Abba, Father (PRITCHARD)". Hymn titles and aliases are compared by
 * `normalizeTitle`, tune names and aliases by `normalizeTuneName`.
 */

/** How many suggestions a page shows for one Planning Center song. */
export const TOP_SUGGESTIONS = 3;

/** What the index needs of a catalog song: a row of the songs list has it all. */
export type IndexableSong = Pick<
    CatalogSongSummary,
    | "id"
    | "hymnId"
    | "title"
    | "aliases"
    | "tuneId"
    | "tuneName"
    | "tuneAliases"
    | "pcoSongId"
    | "entries"
>;

/** The catalog arranged for matching titles. Build it once with `buildCatalogIndex`. */
export interface CatalogIndex {
    /** Every song, by id. */
    songs: ReadonlyMap<number, IndexableSong>;
    /** Song ids by the normalized title of their hymn. */
    titles: ReadonlyMap<string, readonly number[]>;
    /** Song ids by a normalized alias of their hymn. */
    aliases: ReadonlyMap<string, readonly number[]>;
    /** Tune ids by a normalized tune name or alias. */
    tunes: ReadonlyMap<string, ReadonlySet<number>>;
    /** The catalog song each linked Planning Center song is linked to, by Planning Center id. */
    linked: ReadonlyMap<string, number>;
    /** Every key of `titles` and `aliases`, by length, so near matches are looked for only among keys of about the right length. */
    keysByLength: ReadonlyMap<number, readonly string[]>;
}

/** Add `value` to the list under `key`, once. An empty key is not a title, so it is skipped. */
function addTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
    if (key === "") {
        return;
    }
    const values = map.get(key);
    if (!values) {
        map.set(key, [value]);
    } else if (!values.includes(value)) {
        values.push(value);
    }
}

/** Index the catalog's songs by their hymns' titles and aliases and their tunes' names and aliases. */
export function buildCatalogIndex(songs: readonly IndexableSong[]): CatalogIndex {
    const byId = new Map<number, IndexableSong>();
    const titles = new Map<string, number[]>();
    const aliases = new Map<string, number[]>();
    const tunes = new Map<string, Set<number>>();
    const linked = new Map<string, number>();
    for (const song of songs) {
        byId.set(song.id, song);
        addTo(titles, normalizeTitle(song.title), song.id);
        for (const alias of song.aliases) {
            addTo(aliases, normalizeTitle(alias), song.id);
        }
        if (song.tuneId !== null) {
            for (const name of [song.tuneName ?? "", ...song.tuneAliases]) {
                const key = normalizeTuneName(name);
                if (key !== "") {
                    const ids = tunes.get(key) ?? new Set<number>();
                    ids.add(song.tuneId);
                    tunes.set(key, ids);
                }
            }
        }
        if (song.pcoSongId !== null) {
            linked.set(song.pcoSongId, song.id);
        }
    }
    const keysByLength = new Map<number, string[]>();
    for (const key of new Set([...titles.keys(), ...aliases.keys()])) {
        addTo(keysByLength, key.length, key);
    }
    return { songs: byId, titles, aliases, tunes, linked, keysByLength };
}

/**
 * A trailing parenthetical, from its first "(" to the end, as lib/unusedHymns.ts
 * stripped it: " (PRITCHARD)" in "Abba, Father (PRITCHARD)".
 */
const TRAILING_PARENTHETICAL = /\s*\(.*\)\s*$/;

/** The last parenthetical group at the end of a title, with no parentheses inside it. */
const LAST_PARENTHETICAL = /\(([^()]*)\)\s*$/;

/** A title's trailing parenthetical, split off: what may name the song's tune. */
export interface TuneHint {
    /** The title before the parenthetical, as written: "Abba, Father". */
    base: string;
    /**
     * What may name the tune, as written: all of the parenthetical, and its
     * last group when that differs ("GLORIA PATRI (MEINEKE)" and "MEINEKE").
     */
    names: string[];
}

/**
 * Split off a title's trailing parenthetical, from its first "(" to the end
 * ("Abba, Father (PRITCHARD)" gives "Abba, Father" and "PRITCHARD"), or null
 * when the title has none. The parenthetical names a tune when all of it does
 * ("(GLORIA PATRI (MEINEKE))") or its last group does ("(Descant)
 * (PRITCHARD)"); which tune, if any, is for the caller to look up.
 */
export function readTuneHint(title: string): TuneHint | null {
    const match = TRAILING_PARENTHETICAL.exec(title);
    if (!match) {
        return null;
    }
    const whole = match[0].trim().slice(1, -1);
    const last = LAST_PARENTHETICAL.exec(title)?.[1] ?? whole;
    return { base: title.slice(0, match.index), names: [...new Set([whole, last])] };
}

/** The tunes of the index that a tune hint names, by name or alias. */
export function tunesNamedBy(hint: TuneHint | null, index: CatalogIndex): Set<number> {
    const tuneIds = new Set<number>();
    for (const name of hint?.names ?? []) {
        for (const tuneId of index.tunes.get(normalizeTuneName(name)) ?? []) {
            tuneIds.add(tuneId);
        }
    }
    return tuneIds;
}

/** What a Planning Center title says, worked out once. */
interface TitleClues {
    /** The whole title, normalized. */
    key: string;
    /** The title without its trailing parenthetical, normalized; "" when it has none. */
    baseKey: string;
    /** The tunes its trailing parenthetical names. */
    tuneIds: ReadonlySet<number>;
}

/** Read a title's clues (see `readTuneHint` for the parenthetical). */
function readClues(title: string, index: CatalogIndex): TitleClues {
    const hint = readTuneHint(title);
    return {
        key: normalizeTitle(title),
        baseKey: hint === null ? "" : normalizeTitle(hint.base),
        tuneIds: tunesNamedBy(hint, index),
    };
}

/** The reasons, strongest first. */
const REASONS: readonly LinkReason[] = ["exact", "alias", "tune-hint", "near"];

/** The keys of the index that are a near match of `key` (see `isNearMatch`). */
function nearKeys(key: string, index: CatalogIndex): string[] {
    const found: string[] = [];
    for (
        let length = key.length - NEAR_MATCH_MAX_DISTANCE;
        length <= key.length + NEAR_MATCH_MAX_DISTANCE;
        length++
    ) {
        for (const candidate of index.keysByLength.get(length) ?? []) {
            if (isNearMatch(key, candidate)) {
                found.push(candidate);
            }
        }
    }
    return found;
}

/**
 * The catalog songs a title may be, each with its strongest reason. Without
 * `near`, only the strong reasons are looked for.
 */
function findCandidates(
    clues: TitleClues,
    index: CatalogIndex,
    { near }: { near: boolean }
): Map<number, LinkReason> {
    const found = new Map<number, LinkReason>();
    const add = (songIds: readonly number[] | undefined, reason: LinkReason) => {
        for (const songId of songIds ?? []) {
            const current = found.get(songId);
            if (current === undefined || REASONS.indexOf(reason) < REASONS.indexOf(current)) {
                found.set(songId, reason);
            }
        }
    };
    /** The songs whose hymn has `key` as its title or as an alias. */
    const songsTitled = (key: string) => [
        ...(index.titles.get(key) ?? []),
        ...(index.aliases.get(key) ?? []),
    ];

    if (clues.key === "") {
        return found;
    }
    add(index.titles.get(clues.key), "exact");
    add(index.aliases.get(clues.key), "alias");
    if (clues.baseKey !== "") {
        const baseSongs = songsTitled(clues.baseKey);
        add(
            baseSongs.filter((songId) => {
                const tuneId = index.songs.get(songId)?.tuneId ?? null;
                return tuneId !== null && clues.tuneIds.has(tuneId);
            }),
            "tune-hint"
        );
        if (near) {
            add(baseSongs, "near");
        }
    }
    if (near) {
        for (const key of [clues.key, clues.baseKey]) {
            if (key !== "") {
                for (const nearKey of nearKeys(key, index)) {
                    add(songsTitled(nearKey), "near");
                }
            }
        }
    }
    return found;
}

/** Compare two strings without regard to case, then as written. */
function compareText(a: string, b: string): number {
    const [first, second] = [a.toLowerCase(), b.toLowerCase()];
    return first < second ? -1 : first > second ? 1 : a < b ? -1 : a > b ? 1 : 0;
}

/** A catalog song as a plan page shows it. */
export function toCatalogMatch(song: IndexableSong): CatalogMatch {
    return {
        songId: song.id,
        title: song.title,
        tuneName: song.tuneName,
        entries: song.entries,
    };
}

/**
 * The catalog songs a Planning Center song may be, best first. A candidate's
 * reason is the strongest that finds it (see `LinkReason`):
 *
 * - "exact": the normalized title is a hymn's title, so every song of that
 *   hymn (one per tune) is a candidate;
 * - "alias": it is a hymn's alias;
 * - "tune-hint": without its trailing parenthetical it is a hymn's title or
 *   alias, and the parenthetical names the song's tune or a tune alias;
 * - "near": it, or the title without its parenthetical, is nearly a hymn's
 *   title or alias (`isNearMatch`), or the title without its parenthetical
 *   is one exactly while the parenthetical names none of that hymn's tunes
 *   ("America the Beautiful (Descant)").
 *
 * Candidates come by reason, then those whose tune the title names, then
 * those not yet linked to another Planning Center song, then by title and
 * tune name (an unknown tune last). Each carries the Planning Center song it
 * is already linked to, if any. Empty when nothing matches.
 */
export function suggestLinks(
    pcoSong: Pick<PcoLibrarySong, "title">,
    index: CatalogIndex
): LinkSuggestion[] {
    const clues = readClues(pcoSong.title, index);
    const namesTune = (song: IndexableSong) =>
        song.tuneId !== null && clues.tuneIds.has(song.tuneId);
    return [...findCandidates(clues, index, { near: true })]
        .map(([songId, reason]) => ({ song: index.songs.get(songId)!, reason }))
        .sort(
            (a, b) =>
                REASONS.indexOf(a.reason) - REASONS.indexOf(b.reason) ||
                Number(namesTune(b.song)) - Number(namesTune(a.song)) ||
                Number(a.song.pcoSongId !== null) - Number(b.song.pcoSongId !== null) ||
                compareText(a.song.title, b.song.title) ||
                Number(a.song.tuneName === null) - Number(b.song.tuneName === null) ||
                compareText(a.song.tuneName ?? "", b.song.tuneName ?? "") ||
                a.song.id - b.song.id
        )
        .map(({ song, reason }) => ({
            ...toCatalogMatch(song),
            reason,
            pcoSongId: song.pcoSongId,
        }));
}

/** What `chooseAutoLinks` needs of a song of the Planning Center mirror. */
export type AutoLinkablePcoSong = Pick<
    MirroredPcoSong,
    "id" | "title" | "removedAt" | "ignoredAt" | "autoLinkBlockedAt"
>;

/** A link for a sync to make: this Planning Center song to this catalog song. */
export interface AutoLinkChoice {
    pcoSongId: string;
    songId: number;
}

/**
 * The links a sync makes without asking. A Planning Center song is linked to
 * a catalog song only when:
 *
 * - it is not linked yet, is still in Planning Center, and is neither
 *   ignored nor blocked (an auto-link of it was undone);
 * - exactly one catalog song is a candidate for it with a strong reason
 *   (exact, alias or tune-hint), so a hymn sung to several tunes is never
 *   linked from its bare title, nor a title two hymns share;
 * - that catalog song is not linked yet;
 * - and no other Planning Center song still in Planning Center has that same
 *   single strong candidate, whatever its own state (linked elsewhere,
 *   ignored or blocked): two Planning Center songs never claim one catalog
 *   song, and a title the library holds twice is left for a person.
 *
 * Near matches never link. Each Planning Center song and each catalog song
 * appears in at most one choice; the order follows `pcoSongs`.
 */
export function chooseAutoLinks(
    pcoSongs: readonly AutoLinkablePcoSong[],
    index: CatalogIndex
): AutoLinkChoice[] {
    /** Each Planning Center song's one strong candidate, if it has exactly one. */
    const soleCandidate = new Map<string, number>();
    /** How many Planning Center songs have each catalog song as their one strong candidate. */
    const claims = new Map<number, number>();
    for (const pcoSong of pcoSongs) {
        if (pcoSong.removedAt !== null) {
            continue;
        }
        const strong = [
            ...findCandidates(readClues(pcoSong.title, index), index, { near: false }).keys(),
        ];
        if (strong.length === 1) {
            soleCandidate.set(pcoSong.id, strong[0]);
            claims.set(strong[0], (claims.get(strong[0]) ?? 0) + 1);
        }
    }

    const choices: AutoLinkChoice[] = [];
    for (const pcoSong of pcoSongs) {
        const songId = soleCandidate.get(pcoSong.id);
        if (
            songId !== undefined &&
            pcoSong.ignoredAt === null &&
            pcoSong.autoLinkBlockedAt === null &&
            !index.linked.has(pcoSong.id) &&
            index.songs.get(songId)?.pcoSongId === null &&
            claims.get(songId) === 1
        ) {
            choices.push({ pcoSongId: pcoSong.id, songId });
        }
    }
    return choices;
}
