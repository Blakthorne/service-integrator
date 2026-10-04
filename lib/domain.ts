/**
 * The app's domain types: the one place where the shapes of service types,
 * plans, plan items, songs, the Schedule tab's selections and the song
 * catalog are declared. Pure types, safe to import from client and server
 * code alike.
 *
 * Raw Planning Center (JSON:API) shapes live in lib/pco/resources.ts, and
 * lib/pco/mappers.ts turns them into these.
 */

/** A Planning Center service type, such as "Sunday Morning". */
export interface ServiceType {
    id: string;
    name: string;
    frequency: string;
    sequence: number;
    archived: boolean;
}

/** One plan (a service on a given date) of a service type. */
export interface Plan {
    id: string;
    serviceTypeId: string;
    title: string | null;
    /** Human-readable date(s), e.g. "October 4, 2026". */
    dates: string;
    shortDates: string;
    /**
     * PCO's sort timestamp, e.g. "2026-10-04T08:00:00Z". It is org-local time
     * labelled as UTC, so its `YYYY-MM-DD` part is the plan's calendar date.
     */
    sortDate: string;
    itemsCount: number;
    /** The plan's page in the Planning Center web app. */
    planningCenterUrl: string;
    createdAt: string;
    updatedAt: string;
}

/** A plan in the all-plans list, carrying the name of its service type. */
export type PlanSummary = Plan & {
    serviceType: Pick<ServiceType, "id" | "name">;
};

/**
 * A song from the Planning Center library. Fields that PCO may leave empty are
 * `null`. There is no URL field: web links are built from the ID.
 */
export interface Song {
    id: string;
    title: string;
    author: string | null;
    admin: string | null;
    ccliNumber: number | null;
    copyright: string | null;
    notes: string | null;
    themes: string | null;
}

/** One item of a plan: a song, header, media or other element. */
export interface PlanItem {
    id: string;
    title: string;
    /** PCO's item type, e.g. "song", "header", "media" or "item". */
    itemType: string;
    sequence: number;
    servicePosition: string;
    keyName: string | null;
    length: number;
    description: string | null;
    createdAt: string;
    updatedAt: string;
    /** The PCO song this item schedules, or null when it has none. */
    songId: string | null;
}

/** A plan item joined to its song (null when no song was found for it). */
export type PlanItemWithSong = PlanItem & { song: Song | null };

/**
 * The choices made for one song on the Schedule tab. This is UI state, not
 * PCO data, so it is kept apart from PlanItem and combined with it only where
 * a view needs both (`PlanItem & ScheduleSelection`).
 */
export interface ScheduleSelection {
    selectedOption?: "Leave blank" | "Custom";
    customText?: string;
    selectedVersionIndex?: number;
}

// ---------------------------------------------------------------------------
// Catalog
//
// The app's own hymnal index, kept in the database (lib/db/catalog.ts) and
// read through lib/queries/catalog.ts. A hymn is the words and a tune the
// melody; a song is one hymn to one tune, the unit a Planning Center song
// links to; an entry places a song in a book. Catalog IDs are SQLite
// integers (parseCatalogId in lib/catalog/ids.ts checks them in URLs), and a
// book is also found by its code. Timestamps are ISO 8601 UTC.
// ---------------------------------------------------------------------------

/** A hymnal, such as Rejoice Hymns, or a book with no numbers, such as a chorus book. */
export interface Book {
    id: number;
    /** "R", "G", "CB": unique without regard to case, and the book's URL segment. */
    code: string;
    name: string;
    shortName: string;
    /** False for a book whose entries have a position, not a number. */
    numbered: boolean;
    /** How its entries are labelled: "R-{n}", or an unnumbered book's short name. */
    labelFormat: string;
    /** Books are listed, and a song's entries ordered, by this. */
    sortOrder: number;
    active: boolean;
}

/** A text (the words), shared by every tune it is sung to. */
export interface Hymn {
    id: number;
    title: string;
    firstLine: string | null;
    notes: string | null;
}

/** A hymn with its other titles. */
export interface HymnWithAliases extends Hymn {
    aliases: string[];
}

/** A melody, such as ST. ANNE, shared by every hymn sung to it. */
export interface Tune {
    id: number;
    name: string;
    meter: string | null;
    notes: string | null;
}

/** A tune with its other names (DARWAL for DARWALL). */
export interface TuneWithAliases extends Tune {
    aliases: string[];
}

/** How a catalog song got its Planning Center link. */
export type SongLinkSource = "auto" | "manual" | "import";

/**
 * A catalog song: one hymn to one tune, and at most one Planning Center song.
 * Not to be confused with `Song`, a song of the Planning Center library.
 */
export interface CatalogSong {
    id: number;
    hymnId: number;
    /** Null when the tune is unknown. */
    tuneId: number | null;
    /** The linked Planning Center song's id, or null. */
    pcoSongId: string | null;
    linkedAt: string | null;
    linkedBy: SongLinkSource | null;
    notes: string | null;
}

/** Where a song appears in a book. */
export interface Entry {
    id: number;
    bookId: number;
    songId: number;
    /** Its number in a numbered book; null in an unnumbered book or at a location. */
    number: number | null;
    /** Its order inside an unnumbered book. */
    position: number | null;
    /** A place without a number, such as "front cover" (the Doxology in G). */
    locationLabel: string | null;
    /** What the book prints here, such as "Descant - last stanza only". Shown beside the label, never in it. */
    variantNote: string | null;
}

/** An entry with its book's code and its label, ready to show. */
export interface LabelledEntry extends Entry {
    bookCode: string;
    /** "R-396", "G-Front Cover", or an unnumbered book's short name (see `formatEntryLabel`). */
    label: string;
}

/** A row of the songs list (`/catalog`): what it shows, filters and sorts by. */
export interface CatalogSongSummary {
    /** The song's id. */
    id: number;
    hymnId: number;
    /** The hymn's title. */
    title: string;
    /** The hymn's other titles, which search also matches. */
    aliases: string[];
    tuneId: number | null;
    /** Null when the tune is unknown. */
    tuneName: string | null;
    /** The tune's other names, which search also matches. */
    tuneAliases: string[];
    /** The Planning Center song it is linked to, or null when it is not linked. */
    pcoSongId: string | null;
    /** How its link was made; null when it is not linked (or a newer build made it). */
    linkedBy: SongLinkSource | null;
    /**
     * When its Planning Center song was last scheduled, as Planning Center
     * gives it (counting upcoming plans): null when it is not linked, the
     * mirror lacks the song, or the song was never scheduled. A song is used
     * when this is set.
     */
    lastScheduledAt: string | null;
    /** Its entries in book order, then by number or position. */
    entries: LabelledEntry[];
}

/** A song with what its page shows: its hymn, its tune, its entries and its relatives. */
export interface CatalogSongDetail extends CatalogSong {
    hymn: HymnWithAliases;
    /** Null when the tune is unknown. */
    tune: TuneWithAliases | null;
    /** Its entries in book order, then by number or position. */
    entries: LabelledEntry[];
    /** The hymn's other songs: the other tunes it is sung to (and a tune-less song), by tune name. */
    otherTunes: CatalogSongSummary[];
    /** The tune's other songs: the other hymns sung to it, by title. Empty when the tune is unknown. */
    otherHymns: CatalogSongSummary[];
}

/** A row of the tunes list. */
export interface TuneSummary extends TuneWithAliases {
    /** How many songs use it, which is how many hymns are sung to it. */
    songCount: number;
}

/** A tune with what its page shows. */
export interface TuneDetail extends TuneWithAliases {
    /** Its songs, one per hymn sung to it, by title. */
    songs: CatalogSongSummary[];
}

/** A row of the books list. */
export interface BookSummary extends Book {
    entryCount: number;
}

/** A line of a book's page: an entry with its song's hymn and tune. */
export interface BookEntry extends LabelledEntry {
    hymnId: number;
    /** The hymn's title. */
    title: string;
    tuneId: number | null;
    tuneName: string | null;
    pcoSongId: string | null;
}

/** A book with what its page shows. */
export interface BookDetail extends Book {
    /**
     * Its entries in browse order: those at a location (the front cover)
     * first, then by number, or by position in an unnumbered book.
     */
    entries: BookEntry[];
}

/** How much the catalog holds; all zero before the seed import. */
export interface CatalogCounts {
    books: number;
    hymns: number;
    tunes: number;
    songs: number;
    entries: number;
}

/** What an import reads: the seed file (more kinds join with later imports). */
export type ImportRunKind = "hymns-json";

/** A run is previewed, then applied or discarded, once. */
export type ImportRunStatus = "preview" | "applied" | "discarded";

/** A row of the import runs list. */
export interface ImportRunSummary {
    id: number;
    /** When it was previewed. */
    at: string;
    kind: ImportRunKind;
    status: ImportRunStatus;
    /** What it read, such as "hymns.json". */
    sourceName: string;
    /** The book it imports into, or null for the seed, which creates its books. */
    bookId: number | null;
    /** How many rows of each kind it adds (applying it adds exactly these). */
    planned: ImportCounts;
}

/** An import run with its report, for its review page. */
export interface ImportRunDetail extends ImportRunSummary {
    report: SeedImportReport;
}

/** How many rows of each kind an import adds, or added. */
export interface ImportCounts {
    books: number;
    hymns: number;
    hymnAliases: number;
    tunes: number;
    tuneAliases: number;
    songs: number;
    /** Of the songs, how many have no known tune. */
    songsWithoutTune: number;
    entries: number;
}

/**
 * A Great Hymns record with no tune whose hymn has tunes in Rejoice Hymns:
 * one hymn split over two rows.
 */
export interface SeedSplitPair {
    /** The hymn's title. */
    title: string;
    /** Its Great Hymns entry, such as "G-369". */
    label: string;
    /**
     * "merged": the hymn has one Rejoice tune, so the entry joined that song;
     * "ambiguous": it has several, so the entry is a tune-less song of its own;
     * "conflict": it has one, but that song already has an entry in Great
     * Hymns, so the entry is a tune-less song of its own rather than a
     * second one there.
     */
    outcome: "merged" | "ambiguous" | "conflict";
    /** The hymn's Rejoice tunes: the one it joined (or would have), or the candidates. */
    tunes: string[];
}

/** A descant or round, imported as a variant note on its hymn's entry. */
export interface SeedVariant {
    /** The title as the file has it, such as "America the Beautiful (Descant - last stanza only)". */
    record: string;
    /** The hymn it belongs to. */
    title: string;
    /** The parenthetical, such as "Descant - last stanza only" or "A Round". */
    variantNote: string;
    /** Its tune; null when the record had none and the hymn had no single other tune. */
    tune: string | null;
    /** True when the record had no tune and took the hymn's only one. */
    tuneFromBase: boolean;
    /** True when its song also has entries without a variant note (a descant to the usual tune). */
    sharesSong: boolean;
    /** Its entries' labels. */
    labels: string[];
}

/** A fix from the seed's explicit merge list. */
export interface SeedMerge {
    /** A tune spelled two ways, a hymn titled two ways, or a misspelt title. */
    kind: "tune-alias" | "hymn-alias" | "title-fix";
    /** The spelling that becomes an alias. */
    from: string;
    /** The spelling kept as the name or title. */
    to: string;
    /** How many records it changed; 0 means the list has gone out of date. */
    records: number;
}

/** A song with no known tune: the first reconcile work list. */
export interface SeedSongWithoutTune {
    title: string;
    labels: string[];
    /**
     * Why: the file gave none ("no-tune"), its split pair had several
     * candidates ("ambiguous-split-pair") or one whose song already has an
     * entry in that book ("split-pair-conflict"), or it is a variant whose
     * hymn had no single tune ("variant-without-tune").
     */
    reason:
        | "no-tune"
        | "ambiguous-split-pair"
        | "split-pair-conflict"
        | "variant-without-tune";
}

/** Two hymns with nearly the same title that the seed did not merge, for a human to judge. */
export interface SeedPossibleDuplicate {
    titles: [string, string];
    /** Each hymn's entry labels. */
    labels: [string[], string[]];
}

/** An entry the seed left out because the catalog's rules forbid it. */
export interface SeedSkippedEntry {
    /** The record's title, as the file has it. */
    record: string;
    label: string;
    /** Another record has the number, or the song already has an entry there with the same variant note. */
    reason: "number-taken" | "song-already-in-book";
}

/** The review of the seed import from hymns.json: what it read, what it adds, and what needs a look. */
export interface SeedImportReport {
    input: {
        records: number;
        /** Records whose tune is empty. */
        recordsWithoutTune: number;
        /** Records with a number in each book (the front cover counts), by book code. */
        recordsByBook: Record<string, number>;
    };
    /** The rows applying it adds. */
    planned: ImportCounts;
    /** The entries it adds to each book, by book code. */
    entriesByBook: Record<string, number>;
    splitPairs: SeedSplitPair[];
    variants: SeedVariant[];
    merges: SeedMerge[];
    songsWithoutTune: SeedSongWithoutTune[];
    possibleDuplicates: SeedPossibleDuplicate[];
    skippedEntries: SeedSkippedEntry[];
}

// ---------------------------------------------------------------------------
// Planning Center links
//
// A catalog song links to at most one Planning Center song, and a Planning
// Center song to at most one catalog song (`songs.pco_song_id`). The app
// mirrors the Planning Center song library in the database (`pco_songs`,
// refreshed by the `pco-songs` sync), so a link never points at nothing and
// Reconcile can list the songs that have no catalog song yet. Rows of the
// mirror are never deleted: a song gone from Planning Center is marked
// removed.
// ---------------------------------------------------------------------------

/**
 * A song of the Planning Center library with every field the mirror keeps.
 * Unlike `Song`, which a plan item carries, it has Planning Center's dates and
 * hidden flag, and no notes. A field Planning Center leaves empty is null.
 */
export interface PcoLibrarySong {
    id: string;
    title: string;
    author: string | null;
    copyright: string | null;
    ccliNumber: number | null;
    admin: string | null;
    themes: string | null;
    /** Hidden from the library in Planning Center. */
    hidden: boolean;
    /**
     * When it was last scheduled, as Planning Center gives it: org-local time
     * labelled UTC ("Z"), counting upcoming plans too. Null when it never was.
     */
    lastScheduledAt: string | null;
    /** When it was created in Planning Center. */
    createdAt: string | null;
    /** When it last changed in Planning Center. */
    updatedAt: string | null;
}

/** A row of the mirror: a library song, and what the app has noted about it. */
export interface MirroredPcoSong extends PcoLibrarySong {
    /** When a sync, or a link made from a page, last read it from Planning Center. */
    syncedAt: string;
    /** When a sync found it gone from Planning Center; null while it is there. */
    removedAt: string | null;
    /** When Reconcile's Ignore set it aside as not hymnal material; null otherwise. */
    ignoredAt: string | null;
    /**
     * When an auto-link of it was undone, so that no sync links it again
     * (a manual link still can); null otherwise.
     */
    autoLinkBlockedAt: string | null;
}

/**
 * Why a catalog song is suggested for a Planning Center song, strongest
 * first. The Planning Center title is the hymn's title ("exact") or one of
 * its aliases ("alias"); or it is the hymn's title or alias with the song's
 * tune named in a trailing parenthetical ("tune-hint", as in "Abba, Father
 * (PRITCHARD)"); or it is nearly the hymn's title or an alias, or is one with
 * a parenthetical that names no tune of that song ("near"). The first three
 * are strong: a sync may link on one of them without asking.
 */
export type LinkReason = "exact" | "alias" | "tune-hint" | "near";

/** A catalog song as a plan page shows it for an item whose Planning Center song links to it. */
export interface CatalogMatch {
    /** The catalog song's id. */
    songId: number;
    /** Its hymn's title. */
    title: string;
    /** Its tune's name; null when the tune is unknown. */
    tuneName: string | null;
    /** Its entries, labelled, in book order, then by number or position. */
    entries: LabelledEntry[];
}

/** A catalog song suggested as the link for a Planning Center song. */
export interface LinkSuggestion extends CatalogMatch {
    reason: LinkReason;
    /**
     * The Planning Center song this catalog song is already linked to, or
     * null. Linking it to another one is refused until that link is undone.
     */
    pcoSongId: string | null;
}

/** A Planning Center song with no catalog song yet, with the catalog songs it may be. */
export interface UnlinkedPcoSong {
    pcoSong: MirroredPcoSong;
    /** The best few suggestions, best first (see `suggestLinks` in lib/reconcile.ts). */
    suggestions: LinkSuggestion[];
}

/** A link a sync made on its own, as Reconcile lists it for review, with Undo. */
export interface AutoLinkedSong extends CatalogMatch {
    pcoSongId: string;
    /** The Planning Center song's title; null when the mirror lacks it. */
    pcoTitle: string | null;
    linkedAt: string;
}

/** A catalog song as a picker lists it: enough to find it, label it and link it. */
export interface CatalogSongOption {
    songId: number;
    /** Its hymn's title. */
    title: string;
    /** Its tune's name; null when the tune is unknown. */
    tuneName: string | null;
    /** Its entries' labels, in book order. */
    labels: string[];
    /** The Planning Center song it is linked to, or null. */
    pcoSongId: string | null;
}
