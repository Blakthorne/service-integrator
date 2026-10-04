import { foldForSearch } from "@/lib/catalog/filter";
import { formatEntryLabel } from "@/lib/catalog/labels";
import { normalizeTuneName } from "@/lib/catalog/normalize";
import type {
    SeedImportReport,
    SeedMerge,
    SeedPossibleDuplicate,
    SeedSkippedEntry,
    SeedSongWithoutTune,
    SeedSplitPair,
    SeedVariant,
} from "@/lib/domain";
import { levenshtein } from "@/lib/fuzzy";
import { normalizeTitle } from "@/lib/normalizeTitle";
import type {
    PlannedAlias,
    PlannedBook,
    PlannedCatalogRows,
    PlannedEntry,
    PlannedHymn,
    PlannedSong,
    PlannedTune,
} from "./rows";

/**
 * The seed import: `hymns.json` (one record per hymn and tune, with its
 * number in each of two books) turned into the catalog's books, hymns, tunes,
 * songs and entries, with a report for review. Pure: it plans rows keyed by
 * normalized strings, and applying a stored run inserts them.
 *
 * - A hymn is a record's title by `normalizeTitle`, a tune its tune name by
 *   `normalizeTuneName`, each after the merge list; a song is a hymn and a
 *   tune. Records of one song become one song with several entries, and the
 *   first record's spelling (in file order) is the canonical one.
 * - A record has an entry in each book whose number is not -1. A 0 is a
 *   location: the front cover (the Doxology in G).
 * - A title ending in "(Descant …)" or "(A Round)" is a variant: an entry of
 *   the base title's hymn with the parenthetical as its variant note, to the
 *   record's tune or, when it has none, the hymn's only other tune.
 * - A Great Hymns record with no tune, whose hymn has Rejoice records with
 *   tunes, is one half of a split pair: with one such tune it joins that
 *   song, and with several it stays a tune-less song, flagged. It also stays
 *   one when that song already has an entry in Great Hymns, since a song has
 *   one plain entry per book: nothing is dropped.
 */

/**
 * One record of `hymns.json`: a hymn sung to one tune, with its number in
 * each of the two books (-1 when it is not in the book, 0 for a location
 * without a number, the front cover) and "" when it has no tune.
 */
export interface RawHymn {
    song_title: string;
    tune_name: string;
    great_hymns_of_the_faith: number;
    rejoice_hymns: number;
}

/** A book the seed creates, and the field of a record that holds its numbers. */
interface SeedBook extends PlannedBook {
    field: "rejoice_hymns" | "great_hymns_of_the_faith";
}

/** The seed's books, in book order. */
export const SEED_BOOKS: readonly SeedBook[] = [
    {
        code: "R",
        name: "Rejoice Hymns",
        shortName: "Rejoice",
        numbered: true,
        labelFormat: "R-{n}",
        sortOrder: 1,
        field: "rejoice_hymns",
    },
    {
        code: "G",
        name: "Great Hymns of the Faith",
        shortName: "Great Hymns",
        numbered: true,
        labelFormat: "G-{n}",
        sortOrder: 2,
        field: "great_hymns_of_the_faith",
    },
];

const [REJOICE, GREAT] = SEED_BOOKS;

/** The fixes the seed applies by name, each listed in the report. */
export const SEED_MERGES: readonly Omit<SeedMerge, "records">[] = [
    { kind: "tune-alias", from: "DARWAL", to: "DARWALL" },
    {
        kind: "hymn-alias",
        from: "Rejoice \u2013 the Lord Is King",
        to: "Rejoice, the Lord Is King",
    },
    {
        kind: "hymn-alias",
        from: "Hallelujah, What a Savior!",
        to: "Hallelujah! What a Savior",
    },
    {
        kind: "title-fix",
        from: "Is Your All on the Alter?",
        to: "Is Your All on the Altar?",
    },
    {
        kind: "title-fix",
        from: "Hark! Ten Thousands Harps and Voices",
        to: "Hark! Ten Thousand Harps and Voices",
    },
];

/** What a record gives as the number of a book it is not in. */
const NOT_IN_BOOK = -1;

/** What a record gives as the number of the front cover. */
const FRONT_COVER = 0;

/** The location of an entry numbered 0. */
export const FRONT_COVER_LOCATION = "front cover";

/** A title ending in "(Descant …)" or "(A Round)": the base title, then the parenthetical's text. */
const VARIANT_TITLE = /^(.+?)\s*\(((?:Descant\b[^)]*)|(?:A Round))\)$/i;

/**
 * Two hymns are possible duplicates when their titles, folded for search,
 * differ by at most this many single-character edits…
 */
const DUPLICATE_MAX_EDITS = 3;

/** …and the edits are fewer than a fifth of the longer title's characters. */
const DUPLICATE_MAX_SHARE = 1 / 5;

/** What the seed plans, and its report. */
export interface HymnsJsonImport {
    report: SeedImportReport;
    rows: PlannedCatalogRows;
}

/** Where a record puts its hymn in a book. */
interface Place {
    book: SeedBook;
    number: number | null;
    locationLabel: string | null;
}

/** A record, read. */
interface SeedRecord {
    /** The title as the file has it, trimmed. */
    title: string;
    /** The title without a variant's parenthetical. */
    baseTitle: string;
    variantNote: string | null;
    /** Its title's key, before the merge list. */
    titleKey: string;
    /** Its hymn's key, after the merge list. */
    hymnKey: string;
    /** Its tune name as the file has it, trimmed, or null when empty. */
    tuneName: string | null;
    /** Its tune name's key, before the merge list. */
    tuneNameKey: string | null;
    /** Its tune's key: its own after the merge list, or the one it was given. */
    tuneKey: string | null;
    places: Place[];
}

/** Where a record without a tune got one, or why it has none. */
type TuneOutcome =
    | { tuneKey: string; from: "record" | "base" | "split-pair" }
    | { tuneKey: null; reason: SeedSongWithoutTune["reason"] };

function placesOf(record: RawHymn, index: number): Place[] {
    return SEED_BOOKS.flatMap((book): Place[] => {
        const value = record[book.field];
        if (value === NOT_IN_BOOK) {
            return [];
        }
        if (value === FRONT_COVER) {
            return [{ book, number: null, locationLabel: FRONT_COVER_LOCATION }];
        }
        if (Number.isSafeInteger(value) && value > 0) {
            return [{ book, number: value, locationLabel: null }];
        }
        throw new Error(
            `Record ${index + 1} (${JSON.stringify(record.song_title)}) has ${book.field} ${JSON.stringify(value)}; expected -1, 0 or a whole number above 0`
        );
    });
}

function labelOf(place: Place): string {
    return formatEntryLabel(place.book, place);
}

/** Labels in book order, then the front cover first, then by number. */
function sortedLabels(places: Place[]): string[] {
    return [...places]
        .sort(
            (a, b) =>
                a.book.sortOrder - b.book.sortOrder ||
                (a.number ?? 0) - (b.number ?? 0)
        )
        .map(labelOf);
}

/** The key of a song: its hymn's and its tune's keys. */
function songKeyOf(hymnKey: string, tuneKey: string | null): string {
    return JSON.stringify([hymnKey, tuneKey]);
}

function distinct<T>(values: T[]): T[] {
    return [...new Set(values)];
}

/** Append a value to the list a map holds under a key. */
function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
    const list = map.get(key);
    if (list) {
        list.push(value);
    } else {
        map.set(key, [value]);
    }
}

/** A song being planned, with what the report needs to know of it. */
interface SongPlan extends PlannedSong {
    /** Where its entries are. */
    places: Place[];
    /** Whether it has an entry without a variant note. */
    plain: boolean;
    /** Why it has no tune, from its first record; null when it has one. */
    reason: SeedSongWithoutTune["reason"] | null;
}

function toPlannedBook(book: SeedBook): PlannedBook {
    return {
        code: book.code,
        name: book.name,
        shortName: book.shortName,
        numbered: book.numbered,
        labelFormat: book.labelFormat,
        sortOrder: book.sortOrder,
    };
}

/**
 * Plan the seed import from the records of `hymns.json`. Throws when a
 * record's number is neither -1, 0 nor a whole number above 0.
 */
export function planHymnsJsonImport(records: readonly RawHymn[]): HymnsJsonImport {
    const merges: SeedMerge[] = SEED_MERGES.map((merge) => ({ ...merge, records: 0 }));
    const mergeByHymnKey = new Map<string, SeedMerge>();
    const mergeByTuneKey = new Map<string, SeedMerge>();
    for (const merge of merges) {
        if (merge.kind === "tune-alias") {
            mergeByTuneKey.set(normalizeTuneName(merge.from), merge);
        } else {
            mergeByHymnKey.set(normalizeTitle(merge.from), merge);
        }
    }

    // Read every record: its hymn, its own tune and its places.
    const read: SeedRecord[] = records.map((record, index) => {
        const title = record.song_title.trim();
        const variant = VARIANT_TITLE.exec(title);
        const baseTitle = variant ? variant[1].trim() : title;
        const titleKey = normalizeTitle(baseTitle);
        const hymnMerge = mergeByHymnKey.get(titleKey);
        const tuneName = record.tune_name.trim() || null;
        const tuneNameKey = tuneName === null ? null : normalizeTuneName(tuneName);
        const tuneMerge = tuneNameKey === null ? undefined : mergeByTuneKey.get(tuneNameKey);
        for (const merge of [hymnMerge, tuneMerge]) {
            if (merge) {
                merge.records += 1;
            }
        }
        return {
            title,
            baseTitle,
            variantNote: variant ? variant[2].trim() : null,
            titleKey,
            hymnKey: hymnMerge ? normalizeTitle(hymnMerge.to) : titleKey,
            tuneName,
            tuneNameKey,
            tuneKey: tuneMerge ? normalizeTuneName(tuneMerge.to) : tuneNameKey,
            places: placesOf(record, index),
        };
    });

    // Give records without a tune their variant's or split pair's tune.
    const byHymn = new Map<string, SeedRecord[]>();
    for (const record of read) {
        pushTo(byHymn, record.hymnKey, record);
    }
    const inBook = (record: SeedRecord, book: SeedBook) =>
        record.places.some((place) => place.book === book);
    const splitPairs: {
        record: SeedRecord;
        candidates: string[];
        outcome: SeedSplitPair["outcome"];
    }[] = [];
    const outcomes = new Map<SeedRecord, TuneOutcome>();
    // The books each song has an entry without a variant note in, from the
    // records with their own tune and then from each split pair merged, so a
    // merge never gives a song a second such entry in a book.
    const plainBooks = new Map<string, Set<string>>();
    const addPlainBooks = (record: SeedRecord, tuneKey: string) => {
        const key = songKeyOf(record.hymnKey, tuneKey);
        const books = plainBooks.get(key) ?? new Set<string>();
        plainBooks.set(key, books);
        for (const place of record.places) {
            books.add(place.book.code);
        }
    };
    for (const record of read) {
        if (record.tuneKey !== null && record.variantNote === null) {
            addPlainBooks(record, record.tuneKey);
        }
    }
    for (const record of read) {
        const plainTunes = (only: (other: SeedRecord) => boolean) =>
            distinct(
                (byHymn.get(record.hymnKey) ?? []).flatMap((other) =>
                    other.variantNote === null && other.tuneKey !== null && only(other)
                        ? [other.tuneKey]
                        : []
                )
            );
        let outcome: TuneOutcome;
        if (record.tuneKey !== null) {
            outcome = { tuneKey: record.tuneKey, from: "record" };
        } else if (record.variantNote !== null) {
            const tunes = plainTunes(() => true);
            outcome =
                tunes.length === 1
                    ? { tuneKey: tunes[0], from: "base" }
                    : { tuneKey: null, reason: "variant-without-tune" };
        } else if (inBook(record, GREAT) && !inBook(record, REJOICE)) {
            const tunes = plainTunes((other) => inBook(other, REJOICE));
            const taken = (tuneKey: string) =>
                record.places.some((place) =>
                    plainBooks
                        .get(songKeyOf(record.hymnKey, tuneKey))
                        ?.has(place.book.code)
                );
            if (tunes.length === 0) {
                outcome = { tuneKey: null, reason: "no-tune" };
            } else if (tunes.length > 1) {
                splitPairs.push({ record, candidates: tunes, outcome: "ambiguous" });
                outcome = { tuneKey: null, reason: "ambiguous-split-pair" };
            } else if (taken(tunes[0])) {
                splitPairs.push({ record, candidates: tunes, outcome: "conflict" });
                outcome = { tuneKey: null, reason: "split-pair-conflict" };
            } else {
                splitPairs.push({ record, candidates: tunes, outcome: "merged" });
                addPlainBooks(record, tunes[0]);
                outcome = { tuneKey: tunes[0], from: "split-pair" };
            }
        } else {
            outcome = { tuneKey: null, reason: "no-tune" };
        }
        outcomes.set(record, outcome);
    }

    // Hymns and tunes, in the order the file first names them, with the
    // first spelling of each as its title or name and the others as aliases.
    const hymns = new Map<string, { title: string | null; aliases: Map<string, string> }>();
    const tunes = new Map<string, { name: string | null; aliases: Map<string, string> }>();
    for (const record of read) {
        const hymn = hymns.get(record.hymnKey) ?? { title: null, aliases: new Map() };
        hymns.set(record.hymnKey, hymn);
        if (record.titleKey === record.hymnKey) {
            hymn.title ??= record.baseTitle;
        } else if (!hymn.aliases.has(record.titleKey)) {
            hymn.aliases.set(record.titleKey, record.baseTitle);
        }
        if (record.tuneKey !== null && record.tuneNameKey !== null && record.tuneName !== null) {
            const tune = tunes.get(record.tuneKey) ?? { name: null, aliases: new Map() };
            tunes.set(record.tuneKey, tune);
            if (record.tuneNameKey === record.tuneKey) {
                tune.name ??= record.tuneName;
            } else if (!tune.aliases.has(record.tuneNameKey)) {
                tune.aliases.set(record.tuneNameKey, record.tuneName);
            }
        }
    }
    /** The merge list's spelling of a key no record spells, as a title fix's. */
    const mergeTarget = (key: string, normalize: (text: string) => string) =>
        merges.find((merge) => normalize(merge.to) === key)?.to ?? key;
    const toAliases = (aliases: Map<string, string>): PlannedAlias[] =>
        [...aliases].map(([normalized, alias]) => ({ alias, normalized }));
    const plannedHymns: PlannedHymn[] = [...hymns].map(([key, hymn]) => ({
        key,
        title: hymn.title ?? mergeTarget(key, normalizeTitle),
        aliases: toAliases(hymn.aliases),
    }));
    const plannedTunes: PlannedTune[] = [...tunes].map(([key, tune]) => ({
        key,
        name: tune.name ?? mergeTarget(key, normalizeTuneName),
        aliases: toAliases(tune.aliases),
    }));
    const hymnTitle = new Map(plannedHymns.map(({ key, title }) => [key, title]));
    const tuneName = new Map(plannedTunes.map(({ key, name }) => [key, name]));

    // Songs and entries, record by record; an entry the catalog's rules
    // forbid is left out and reported.
    const songs = new Map<string, SongPlan>();
    const entries: PlannedEntry[] = [];
    const skippedEntries: SeedSkippedEntry[] = [];
    const takenNumbers = new Set<string>();
    const takenPlaces = new Set<string>();
    const placesByHymn = new Map<string, Place[]>();
    for (const record of read) {
        const outcome = outcomes.get(record)!;
        const songKey = songKeyOf(record.hymnKey, outcome.tuneKey);
        const song = songs.get(songKey) ?? {
            hymnKey: record.hymnKey,
            tuneKey: outcome.tuneKey,
            places: [],
            plain: false,
            reason: outcome.tuneKey === null ? outcome.reason : null,
        };
        songs.set(songKey, song);
        for (const place of record.places) {
            const number = JSON.stringify([place.book.code, place.number]);
            const where = JSON.stringify([place.book.code, songKey, record.variantNote]);
            const skip = (reason: SeedSkippedEntry["reason"]) =>
                skippedEntries.push({ record: record.title, label: labelOf(place), reason });
            if (place.number !== null && takenNumbers.has(number)) {
                skip("number-taken");
                continue;
            }
            if (takenPlaces.has(where)) {
                skip("song-already-in-book");
                continue;
            }
            takenNumbers.add(number);
            takenPlaces.add(where);
            song.places.push(place);
            song.plain ||= record.variantNote === null;
            pushTo(placesByHymn, record.hymnKey, place);
            entries.push({
                bookCode: place.book.code,
                hymnKey: record.hymnKey,
                tuneKey: outcome.tuneKey,
                number: place.number,
                position: null,
                locationLabel: place.locationLabel,
                variantNote: record.variantNote,
            });
        }
    }

    const rows: PlannedCatalogRows = {
        books: SEED_BOOKS.map(toPlannedBook),
        hymns: plannedHymns,
        tunes: plannedTunes,
        songs: [...songs.values()].map(({ hymnKey, tuneKey }) => ({ hymnKey, tuneKey })),
        entries,
    };

    /** A tune's name by its key. */
    const display = (key: string | null) =>
        key === null ? null : (tuneName.get(key) ?? key);
    /** How many of `values` are in each book, by book code. */
    const countByBook = <T>(values: T[], isIn: (value: T, book: SeedBook) => boolean) =>
        Object.fromEntries(
            SEED_BOOKS.map((book) => [
                book.code,
                values.filter((value) => isIn(value, book)).length,
            ])
        );

    const report: SeedImportReport = {
        input: {
            records: records.length,
            recordsWithoutTune: read.filter((record) => record.tuneName === null).length,
            recordsByBook: countByBook(read, inBook),
        },
        planned: {
            books: rows.books.length,
            hymns: rows.hymns.length,
            hymnAliases: rows.hymns.reduce((sum, hymn) => sum + hymn.aliases.length, 0),
            tunes: rows.tunes.length,
            tuneAliases: rows.tunes.reduce((sum, tune) => sum + tune.aliases.length, 0),
            songs: rows.songs.length,
            songsWithoutTune: rows.songs.filter((song) => song.tuneKey === null).length,
            entries: rows.entries.length,
        },
        entriesByBook: countByBook(rows.entries, (entry, book) => entry.bookCode === book.code),
        splitPairs: splitPairs.map(({ record, candidates, outcome }): SeedSplitPair => ({
            title: hymnTitle.get(record.hymnKey)!,
            label: labelOf(record.places.find((place) => place.book === GREAT)!),
            outcome,
            tunes: candidates.map((key) => display(key)!),
        })),
        variants: read
            .filter((record) => record.variantNote !== null)
            .map((record): SeedVariant => {
                const outcome = outcomes.get(record)!;
                return {
                    record: record.title,
                    title: hymnTitle.get(record.hymnKey)!,
                    variantNote: record.variantNote!,
                    tune: display(outcome.tuneKey),
                    tuneFromBase: outcome.tuneKey !== null && outcome.from === "base",
                    sharesSong: songs.get(songKeyOf(record.hymnKey, outcome.tuneKey))!.plain,
                    labels: sortedLabels(record.places),
                };
            }),
        merges,
        songsWithoutTune: [...songs.values()]
            .filter((song) => song.tuneKey === null)
            .map(
                (song): SeedSongWithoutTune => ({
                    title: hymnTitle.get(song.hymnKey)!,
                    labels: sortedLabels(song.places),
                    reason: song.reason!,
                })
            ),
        possibleDuplicates: possibleDuplicates(plannedHymns, placesByHymn),
        skippedEntries,
    };
    return { report, rows };
}

/**
 * Pairs of hymns whose titles are nearly the same (see `DUPLICATE_MAX_EDITS`)
 * but were not merged, in the order of the first hymn of each pair.
 */
function possibleDuplicates(
    hymns: PlannedHymn[],
    placesByHymn: Map<string, Place[]>
): SeedPossibleDuplicate[] {
    const folded = hymns.map(({ title }) => foldForSearch(title));
    const pairs: SeedPossibleDuplicate[] = [];
    for (let i = 0; i < hymns.length; i++) {
        for (let j = i + 1; j < hymns.length; j++) {
            const [a, b] = [folded[i], folded[j]];
            if (Math.abs(a.length - b.length) > DUPLICATE_MAX_EDITS) {
                continue;
            }
            const edits = levenshtein(a, b);
            if (
                edits <= DUPLICATE_MAX_EDITS &&
                edits < DUPLICATE_MAX_SHARE * Math.max(a.length, b.length)
            ) {
                pairs.push({
                    titles: [hymns[i].title, hymns[j].title],
                    labels: [
                        sortedLabels(placesByHymn.get(hymns[i].key) ?? []),
                        sortedLabels(placesByHymn.get(hymns[j].key) ?? []),
                    ],
                });
            }
        }
    }
    return pairs;
}
