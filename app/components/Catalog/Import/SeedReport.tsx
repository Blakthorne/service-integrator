import type {
    SeedImportReport,
    SeedMerge,
    SeedPossibleDuplicate,
    SeedSkippedEntry,
    SeedSongWithoutTune,
    SeedSplitPair,
    SeedVariant,
} from "@/lib/domain";
import { countOf, formatCount } from "@/lib/catalog/counts";
import {
    describeSplitPairTunes,
    MERGE_KINDS,
    NO_TUNE_REASONS,
    SKIP_REASONS,
    SPLIT_PAIR_LABELS,
} from "@/lib/catalog/importText";
import { Pill, ReportTable, Section, Stat, type Column } from "./ReportParts";

interface SeedReportProps {
    report: SeedImportReport;
    /** What the run read, such as "hymns.json". */
    sourceName: string;
}

/** A muted dash for a value the report does not have. */
const NONE = <span className="text-gray-400 dark:text-gray-500">—</span>;

/** "R 708 · G 539": a count per book code. */
function byBook(counts: Record<string, number>): string {
    return Object.entries(counts)
        .map(([code, count]) => `${code} ${formatCount(count)}`)
        .join(" · ");
}

/** What the run read and what applying it adds. */
function Summary({ report, sourceName }: SeedReportProps) {
    const { input, planned, entriesByBook } = report;
    return (
        <section
            aria-labelledby="report-summary"
            className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4 sm:p-6"
        >
            <h2
                id="report-summary"
                className="text-base font-semibold text-gray-900 dark:text-gray-100"
            >
                What it reads and adds
            </h2>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                Reads {countOf(input.records, "record")} from {sourceName};{" "}
                {formatCount(input.recordsWithoutTune)} have no tune. Records with a
                number in each book: {byBook(input.recordsByBook)}.
            </p>
            <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-5">
                <Stat
                    label="Books"
                    value={planned.books}
                    note={Object.keys(entriesByBook).join(", ")}
                />
                <Stat
                    label="Hymns"
                    value={planned.hymns}
                    note={
                        planned.hymnAliases > 0
                            ? `and ${countOf(planned.hymnAliases, "alias", "aliases")}`
                            : undefined
                    }
                />
                <Stat
                    label="Tunes"
                    value={planned.tunes}
                    note={
                        planned.tuneAliases > 0
                            ? `and ${countOf(planned.tuneAliases, "alias", "aliases")}`
                            : undefined
                    }
                />
                <Stat
                    label="Songs"
                    value={planned.songs}
                    note={`${formatCount(planned.songsWithoutTune)} without a tune`}
                />
                <Stat
                    label="Entries"
                    value={planned.entries}
                    note={byBook(entriesByBook)}
                />
            </dl>
        </section>
    );
}

const SPLIT_PAIR_COLUMNS: Column<SeedSplitPair>[] = [
    { header: "Hymn", cell: (pair) => pair.title },
    { header: "Entry", cell: (pair) => pair.label },
    {
        header: "Outcome",
        cell: (pair) => (
            // Only a merge needs no decision: the others stay songs without a tune.
            <Pill tone={pair.outcome === "merged" ? "green" : "amber"}>
                {SPLIT_PAIR_LABELS[pair.outcome]}
            </Pill>
        ),
    },
    { header: "Rejoice tunes", cell: describeSplitPairTunes },
];

const VARIANT_COLUMNS: Column<SeedVariant>[] = [
    { header: "Hymn", cell: (variant) => variant.title },
    { header: "Note", cell: (variant) => variant.variantNote },
    {
        header: "Tune",
        cell: (variant) =>
            variant.tune === null ? (
                NONE
            ) : (
                <>
                    {variant.tune}
                    {variant.tuneFromBase && (
                        <span className="text-gray-500 dark:text-gray-400">
                            {" "}
                            (the hymn&apos;s)
                        </span>
                    )}
                </>
            ),
    },
    {
        header: "Song",
        cell: (variant) =>
            variant.sharesSong ? "Shares the hymn's usual song" : "A song of its own",
    },
    { header: "Entries", cell: (variant) => variant.labels.join(", ") },
];

const MERGE_COLUMNS: Column<SeedMerge>[] = [
    { header: "Fix", cell: (merge) => MERGE_KINDS[merge.kind] },
    { header: "Other spelling", cell: (merge) => merge.from },
    { header: "Kept as", cell: (merge) => merge.to },
    {
        header: "Records",
        cell: (merge) =>
            merge.records === 0 ? (
                <span className="text-amber-700 dark:text-amber-300">
                    0: matched nothing, so the list is out of date
                </span>
            ) : (
                formatCount(merge.records)
            ),
    },
];

const WITHOUT_TUNE_COLUMNS: Column<SeedSongWithoutTune>[] = [
    { header: "Hymn", cell: (song) => song.title },
    { header: "Entries", cell: (song) => song.labels.join(", ") },
    { header: "Why", cell: (song) => NO_TUNE_REASONS[song.reason] },
];

const DUPLICATE_COLUMNS: Column<SeedPossibleDuplicate>[] = [
    { header: "Hymn", cell: (pair) => pair.titles[0] },
    { header: "Its entries", cell: (pair) => pair.labels[0].join(", ") },
    { header: "Close to", cell: (pair) => pair.titles[1] },
    { header: "Its entries", cell: (pair) => pair.labels[1].join(", ") },
];

const SKIPPED_COLUMNS: Column<SeedSkippedEntry>[] = [
    { header: "Record", cell: (entry) => entry.record },
    { header: "Entry", cell: (entry) => entry.label },
    { header: "Why", cell: (entry) => SKIP_REASONS[entry.reason] },
];

/**
 * The review of a seed import: what it read and adds, then each thing in it
 * that needs a look, section by section. Sections start open, except the long
 * list of songs without a tune. A server component: nothing here is
 * interactive beyond the browser's own disclosure widgets.
 */
export default function SeedReport({ report, sourceName }: SeedReportProps) {
    return (
        <div className="space-y-6">
            <Summary report={report} sourceName={sourceName} />
            <Section
                title="Split pairs"
                count={report.splitPairs.length}
                description="A Great Hymns record with no tune whose hymn has tunes in Rejoice Hymns. With one tune the entry joins that song (merged). It stays a song without a tune, for you to settle, when there are several tunes (ambiguous) or when the one song already has an entry in Great Hymns (conflict)."
            >
                <ReportTable
                    caption="Split pairs"
                    rows={report.splitPairs}
                    columns={SPLIT_PAIR_COLUMNS}
                    empty="None: no Great Hymns record was split from a Rejoice one."
                />
            </Section>
            <Section
                title="Variants"
                count={report.variants.length}
                description="Descants and rounds are not hymns of their own: each becomes a note on its hymn's entry."
            >
                <ReportTable
                    caption="Variants"
                    rows={report.variants}
                    columns={VARIANT_COLUMNS}
                    empty="None: no record is a descant or a round."
                />
            </Section>
            <Section
                title="Merges applied"
                count={report.merges.length}
                description="The seed's explicit merge list. The other spelling is kept as an alias, or as the old title."
            >
                <ReportTable
                    caption="Merges applied"
                    rows={report.merges}
                    columns={MERGE_COLUMNS}
                    empty="None: no spelling was merged."
                />
            </Section>
            <Section
                title="Songs without a tune"
                count={report.songsWithoutTune.length}
                description="The first reconcile work list: songs whose tune the seed does not know."
                open={false}
            >
                <ReportTable
                    caption="Songs without a tune"
                    rows={report.songsWithoutTune}
                    columns={WITHOUT_TUNE_COLUMNS}
                    empty="None: every song has a tune."
                />
            </Section>
            <Section
                title="Possible duplicates"
                count={report.possibleDuplicates.length}
                description="Hymns with nearly the same title that the seed did not merge. Check whether each pair is really one hymn."
            >
                <ReportTable
                    caption="Possible duplicates"
                    rows={report.possibleDuplicates}
                    columns={DUPLICATE_COLUMNS}
                    empty="None: no two hymns have nearly the same title."
                />
            </Section>
            <Section
                title="Entries left out"
                count={report.skippedEntries.length}
                description="Entries the seed did not add because the catalog's rules forbid them."
            >
                <ReportTable
                    caption="Entries left out"
                    rows={report.skippedEntries}
                    columns={SKIPPED_COLUMNS}
                    empty="None: every entry in the file is added."
                />
            </Section>
        </div>
    );
}
