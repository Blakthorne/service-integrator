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

/**
 * The words the import pages use, as pure helpers shared by their server and
 * client components. Each record is typed by the union it spells out, so a
 * new kind, status or reason does not compile until it has its words.
 */

/**
 * What a run of each kind is called, as in "Seed import 3". The page title
 * comes from `KIND_NAMES` in `lib/db/importRuns.ts`; keep the two in step.
 */
const KIND_LABELS: Record<ImportRunKind, string> = { "hymns-json": "Seed import" };

/** "Seed import 3". */
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

/** 1247 → "1,247": the same text on the server and in every browser. */
export function formatCount(count: number): string {
    return count.toLocaleString("en-US");
}

/** "1 book", "921 songs", "1,247 entries" (pass the plural when it is not "-s"). */
export function countOf(
    count: number,
    singular: string,
    plural: string = `${singular}s`
): string {
    return `${formatCount(count)} ${count === 1 ? singular : plural}`;
}

/** "a", "a and b", "a, b and c". */
function joinWithAnd(items: string[]): string {
    if (items.length < 2) {
        return items.join("");
    }
    return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** What applying a run adds, for its confirmation: "2 books, 895 hymns, 768 tunes, 921 songs and 1,247 entries". */
export function describePlanned(counts: ImportCounts): string {
    return joinWithAnd([
        countOf(counts.books, "book"),
        countOf(counts.hymns, "hymn"),
        countOf(counts.tunes, "tune"),
        countOf(counts.songs, "song"),
        countOf(counts.entries, "entry", "entries"),
    ]);
}
