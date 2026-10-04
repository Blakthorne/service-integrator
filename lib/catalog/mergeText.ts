import { countOf } from "./counts";
import { SONG_MARK_LABELS } from "./marks";
import type { MergeKind, MergePreview, SongMergeStep, SongMove } from "./merge";

/**
 * The words of "Merge this hymn into…" (the song page) and "Merge this tune
 * into…" (a tune's page): the preview of what a merge does, the question
 * that confirms it, what is said once it is done, and which song's page
 * the person lands on. Pure and safe on both sides: the forms are client
 * components, and the actions use `mergeDestinationSong`.
 *
 * A hymn's title is quoted, as the merge's own refusals quote it; a tune's
 * name is not, since tune names are written in capitals (DARWALL), as the
 * rest of the catalog writes them.
 */

/** The words each kind of merge uses. */
const KIND_WORDS: Readonly<
    Record<MergeKind, { noun: string; otherName: string; otherNames: string; detail: string }>
> = {
    hymn: { noun: "hymn", otherName: "another title", otherNames: "other titles", detail: "first line" },
    tune: { noun: "tune", otherName: "another name", otherNames: "other names", detail: "meter" },
};

/** "a", "a and b", "a, b and c". */
export function joinWords(words: readonly string[]): string {
    if (words.length <= 1) {
        return words[0] ?? "";
    }
    return `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

/** A hymn's title in quotes, or a tune's name as it is written. */
function nameOf(kind: MergeKind, name: string): string {
    return kind === "hymn" ? `"${name}"` : name;
}

/** A song's label, quoted: "Rejoice, the Lord Is King (DARWALL)". */
function quoted(label: string): string {
    return `"${label}"`;
}

/** What a merge does, under one heading of the preview. */
export interface MergeSection {
    heading: string;
    /** One sentence each. */
    items: string[];
}

/** '"A (GOPSAL)" becomes "B (GOPSAL)", with G-144.' */
function describeMove(move: SongMove): string {
    const entries = move.entries.length > 0 ? `, with ${joinWords(move.entries)}` : "";
    return `${quoted(move.from)} becomes ${quoted(move.to)}${entries}.`;
}

/** '"A (DARWALL)" merges into "B (DARWALL)", which takes G-143, its To learn mark and its notes.' */
function describeSongMerge(step: SongMergeStep): string {
    const taken = [
        ...step.entries,
        ...step.marks.map((mark) => `its ${SONG_MARK_LABELS[mark]} mark`),
        ...(step.notes ? ["its notes"] : []),
        ...(step.link === null
            ? []
            : [
                  step.link.title === null
                      ? `its link to Planning Center song ${step.link.pcoSongId}`
                      : `its link to "${step.link.title}" in Planning Center`,
              ]),
    ];
    const takes = taken.length > 0 ? `, which takes ${joinWords(taken)}` : "";
    return `${quoted(step.source)} merges into ${quoted(step.target)}${takes}.`;
}

/**
 * What else a merge changes: the names the target takes as its other
 * names, the first line (or meter) it takes when it has none, the notes it
 * takes, and that the source is deleted.
 */
function otherChanges(preview: MergePreview): string[] {
    const { kind, source, target } = preview;
    const words = KIND_WORDS[kind];
    const sourceName = nameOf(kind, source.name);
    const targetName = nameOf(kind, target.name);
    const items: string[] = [];
    const aliases = preview.aliasesAdded.map((alias) => nameOf(kind, alias));
    if (aliases.length === 1) {
        items.push(`${targetName} takes ${aliases[0]} as ${words.otherName}.`);
    } else if (aliases.length > 1) {
        items.push(`${targetName} takes ${joinWords(aliases)} as ${words.otherNames}.`);
    }
    if (preview.detailTaken !== null) {
        const detail = kind === "hymn" ? `"${preview.detailTaken}"` : preview.detailTaken;
        items.push(`${targetName} takes the ${words.detail} ${detail}.`);
    }
    if (preview.notesAdded) {
        items.push(`The notes of ${sourceName} are added to those of ${targetName}.`);
    }
    items.push(`The ${words.noun} ${sourceName} is deleted.`);
    return items;
}

/**
 * What a merge does, in sections: the songs that move to the target as they
 * are, the songs that merge into the target's song of the same tune (or
 * hymn), and everything else (names, fields, the source deleted). Sections
 * with nothing in them are left out. The refusals are not here: see
 * `mergeRefusalLines`.
 */
export function mergeSections(preview: MergePreview): MergeSection[] {
    const sameWhat = preview.kind === "hymn" ? "tune" : "hymn";
    const sections: MergeSection[] = [];
    if (preview.moves.length > 0) {
        sections.push({ heading: "Songs that move", items: preview.moves.map(describeMove) });
    }
    if (preview.merges.length > 0) {
        sections.push({
            heading: `Songs that merge into one to the same ${sameWhat}`,
            items: preview.merges.map(describeSongMerge),
        });
    }
    sections.push({ heading: "Also", items: otherChanges(preview) });
    return sections;
}

/** Why the merge is refused, a sentence each; empty when it may go ahead. */
export function mergeRefusalLines(preview: MergePreview): string[] {
    return preview.refusals.map(({ message }) => message);
}

/** Whether the merge may go ahead: nothing refuses it. */
export function canMerge(preview: MergePreview): boolean {
    return preview.refusals.length === 0;
}

/** The preview's heading: 'Merge "A" into "B"', 'Merge DARWAL into DARWALL'. */
export function mergeHeading(preview: Pick<MergePreview, "kind" | "source" | "target">): string {
    const { kind, source, target } = preview;
    return `Merge ${nameOf(kind, source.name)} into ${nameOf(kind, target.name)}`;
}

/** The confirmation's question: 'Merge "A" into "B"?'. */
export function mergeQuestion(preview: Pick<MergePreview, "kind" | "source" | "target">): string {
    return `${mergeHeading(preview)}?`;
}

/** What the confirmation says under its question, before what the merge does. */
export function mergeWarning(kind: MergeKind): string {
    return `This cannot be undone: the ${KIND_WORDS[kind].noun} merged is deleted. Everything below happens at once.`;
}

/**
 * What the page says once a merge is done, where the person lands:
 * 'Merged "A" into "B": 1 song moved and 1 merged.'
 */
export function describeMergeDone(preview: MergePreview): string {
    const { kind, source, target, moves, merges } = preview;
    const parts: string[] = [];
    if (moves.length > 0) {
        parts.push(`${countOf(moves.length, "song")} moved`);
    }
    if (merges.length > 0) {
        parts.push(
            moves.length > 0 ? `${merges.length} merged` : `${countOf(merges.length, "song")} merged`
        );
    }
    const done = `Merged ${nameOf(kind, source.name)} into ${nameOf(kind, target.name)}`;
    return parts.length > 0 ? `${done}: ${parts.join(" and ")}.` : `${done}.`;
}

/**
 * The song a song of the merged hymn (or tune) is once the merge is done,
 * where the song page's merge lands: `songId` itself when it moved, or the
 * target's song it merged into. When `songId` was not one of the source's
 * songs (the page was out of date), the first song the merge gave the
 * target; null when the source had no songs.
 */
export function mergeDestinationSong(
    preview: Pick<MergePreview, "moves" | "merges">,
    songId: number
): number | null {
    if (preview.moves.some((move) => move.songId === songId)) {
        return songId;
    }
    const merged = preview.merges.find((step) => step.sourceSongId === songId);
    if (merged) {
        return merged.targetSongId;
    }
    return preview.moves[0]?.songId ?? preview.merges[0]?.targetSongId ?? null;
}

/**
 * What the confirmation says when the merge is refused as it is written:
 * the catalog changed after the preview (a song was linked, say), and the
 * merge planned afresh is refused. Nothing was merged; the reasons follow.
 */
export const MERGE_REFUSED_NOW_MESSAGE =
    "Nothing was merged: the catalog changed after the preview, and the merge is refused now, for the reasons below.";
