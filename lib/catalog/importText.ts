import type {
    ImportCounts,
    ImportRunKind,
    ImportRunStatus,
    ImportRunSummary,
    SeedMerge,
    SeedSkippedEntry,
    SeedSongWithoutTune,
    SeedSplitPair,
} from "@/lib/domain";
import { countOf, formatCount } from "./counts";
import { ENTRY_NUMBER_MAX } from "./validation";

/**
 * The words the import pages use, as pure helpers shared by their server and
 * client components. Each record is typed by the union it spells out, so a
 * new kind, status or reason does not compile until it has its words.
 */

/**
 * What a run of each kind is called, as in "Seed import 3" or "CSV import
 * 4". The page title comes from `KIND_NAMES` in `lib/db/importRuns.ts`;
 * keep the two in step.
 */
const KIND_LABELS: Record<ImportRunKind, string> = {
    "hymns-json": "Seed import",
    csv: "CSV import",
};

/** "Seed import 3", "CSV import 4". */
export function importRunLabel(run: Pick<ImportRunSummary, "id" | "kind">): string {
    return `${KIND_LABELS[run.kind]} ${run.id}`;
}

export const STATUS_LABELS: Record<ImportRunStatus, string> = {
    preview: "Preview",
    applied: "Applied",
    discarded: "Discarded",
};

/** How a run's list row says what the run adds: it will, it did, or it would have. */
export const PLANNED_VERBS: Record<ImportRunStatus, string> = {
    preview: "Adds",
    applied: "Added",
    discarded: "Would have added",
};

/** How the review words a song's missing tune. */
export const NO_TUNE_REASONS: Record<SeedSongWithoutTune["reason"], string> = {
    "no-tune": "The file gives no tune",
    "ambiguous-split-pair": "Several candidate tunes",
    "split-pair-conflict": "The one song it could join already has an entry in this book",
    "variant-without-tune": "A variant whose hymn has no single tune",
};

/** What the review calls each outcome of a split pair. */
export const SPLIT_PAIR_LABELS: Record<SeedSplitPair["outcome"], string> = {
    merged: "Merged",
    ambiguous: "Ambiguous",
    conflict: "Conflict",
};

/**
 * A split pair's tunes, worded for its outcome: the one it joined, the
 * several it could have joined, or the one it would have joined but for the
 * entry its song already has in that book.
 */
export function describeSplitPairTunes(
    pair: Pick<SeedSplitPair, "outcome" | "tunes">
): string {
    const tunes = pair.tunes.join(" · ");
    switch (pair.outcome) {
        case "merged":
            return `Joined ${tunes}`;
        case "ambiguous":
            return `Candidates: ${tunes}`;
        case "conflict":
            return `Would have joined ${tunes}`;
    }
}

/** What each kind of fix on the seed's merge list does. */
export const MERGE_KINDS: Record<SeedMerge["kind"], string> = {
    "tune-alias": "Tune alias",
    "hymn-alias": "Hymn alias",
    "title-fix": "Title fix",
};

/** Why an entry was left out. */
export const SKIP_REASONS: Record<SeedSkippedEntry["reason"], string> = {
    "number-taken": "Another record has this number",
    "song-already-in-book": "The song already has an entry in this book with the same note",
};

/** "a", "a and b", "a, b and c". */
function joinWithAnd(items: string[]): string {
    if (items.length < 2) {
        return items.join("");
    }
    return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * What applying a run adds, for its confirmation: "2 books, 895 hymns, 768
 * tunes, 921 songs and 1,247 entries". A kind that the run adds none of is
 * left out ("3 hymns, 2 tunes, 3 songs and 12 entries" for a book's file,
 * which adds no book), and entries are always named.
 */
export function describePlanned(counts: ImportCounts): string {
    return joinWithAnd([
        ...(counts.books > 0 ? [countOf(counts.books, "book")] : []),
        ...(counts.hymns > 0 ? [countOf(counts.hymns, "hymn")] : []),
        ...(counts.tunes > 0 ? [countOf(counts.tunes, "tune")] : []),
        ...(counts.songs > 0 ? [countOf(counts.songs, "song")] : []),
        countOf(counts.entries, "entry", "entries"),
    ]);
}

// ---------------------------------------------------------------------------
// Importing a book from a CSV file
// ---------------------------------------------------------------------------

/** One column of a book's CSV file, as the Import page explains it. */
export interface CsvColumnHelp {
    name: string;
    text: string;
}

/** The columns of a book's CSV file: what each holds, and which are optional. */
export const CSV_COLUMN_HELP: readonly CsvColumnHelp[] = [
    {
        name: "number",
        text: `For a numbered book: the song's number, a whole number from 1 to ${formatCount(ENTRY_NUMBER_MAX)}, each used once.`,
    },
    {
        name: "position",
        text: `For a book without numbers, in place of number: the song's place in the list, a whole number from 1 to ${formatCount(ENTRY_NUMBER_MAX)}. The rows go after the book's entries, in the order of their positions.`,
    },
    {
        name: "title",
        text: "The hymn's title. A hymn the catalog has, under that title or another one, is used as it is; a title it does not have adds a hymn.",
    },
    {
        name: "tune",
        text: "Optional. The tune's name, matched the same way. With none, a row goes with its hymn's only song, whatever its tune (a new hymn gets a song with no tune); a hymn with several songs needs the tune named.",
    },
    {
        name: "variant",
        text: "Optional. A note the book prints beside the entry, such as Descant - last stanza only.",
    },
];

/** The rules of the file as a whole, under the columns. */
export const CSV_FILE_RULES =
    "The first row names the columns, in any order, and tune and variant may be left out. Put a title with a comma in it in double quotes. Save the file as CSV UTF-8; it can be at most 1 MB.";

/** A small file for a numbered book, to show the shape. */
export const CSV_SAMPLE_NUMBERED = `number,title,tune,variant
12,Amazing Grace,NEW BRITAIN,
13,"Holy, Holy, Holy",NICAEA,
14,Great Is Thy Faithfulness,,Descant - last stanza only`;

/** A small file for a book without numbers. */
export const CSV_SAMPLE_UNNUMBERED = `position,title,tune,variant
1,"Shine, Jesus, Shine",,
2,Open the Eyes of My Heart,,`;

/** What the form says above its button when a field needs fixing. */
export const CSV_FIX_FIELDS_MESSAGE =
    "The file was not previewed. Fix the fields that have an error message, then try again.";

/** What the form says when the file could not be sent at all (a lost connection, a file over what the server takes). */
export const CSV_COULD_NOT_SEND_MESSAGE =
    "The file could not be sent. Check that it is a CSV file under 1 MB, then try again.";

/** What the form says when its action cannot be called (no session): the page needs reloading. */
export const CSV_NOT_SIGNED_IN_MESSAGE = "The file could not be previewed. Reload the page and try again.";

/** The columns a book's file needs, for the hint under the file field once a book is chosen. */
export function describeBookColumns(book: { name: string; numbered: boolean }): string {
    return book.numbered
        ? `${book.name} numbers its songs, so its file's columns are number, title, tune and variant.`
        : `${book.name} has no numbers, so its file's columns are position, title, tune and variant.`;
}

/** A book as the form's list offers it: its name, code, and what its file needs. */
export function describeBookOption(book: {
    name: string;
    code: string;
    numbered: boolean;
    active: boolean;
}): string {
    return `${book.name} (${book.code}) · ${book.numbered ? "numbered" : "not numbered"}${book.active ? "" : " · not in use"}`;
}
