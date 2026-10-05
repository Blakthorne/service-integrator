import type { SongMark, SongMarkKind } from "@/lib/domain";
import { normalizeTitle } from "@/lib/normalizeTitle";
import { normalizeTuneName } from "./normalize";

/**
 * Merging one hymn into another, or one tune into another: what moves, what
 * merges, and what refuses the merge, planned from a snapshot of the two
 * and their songs. Pure and safe on both sides: lib/db/catalogMerge.ts reads
 * the snapshot, shows the plan as a preview, and applies it, planning again
 * inside the transaction that writes it.
 *
 * Merging hymn A into hymn B (the target):
 *
 * - **A song of A moves** to B when B has no song to its tune: it becomes
 *   B's song to that tune, with its entries, link and marks.
 * - **A song of A merges** into B's song to the same tune (no tune counts as
 *   a tune: B's tune-less song takes A's), since a hymn has one song per
 *   tune. Its entries and marks move to B's song, its notes are added to
 *   B's, and B's song keeps its own fields and link; it takes A's song's
 *   link when it has none. A's song is then deleted.
 * - **A's title and other titles become other titles of B** (but one B
 *   already has, or B's own title), B takes A's first line when it has
 *   none and A's notes after its own, and A is deleted.
 *
 * Merging tunes is the same, keyed by hymn: a song of the source tune
 * merges into the target tune's song of the same hymn.
 *
 * **Refused**, writing nothing, when the target is the source; when two
 * songs that would merge are linked to different Planning Center songs (one
 * catalog song links to one Planning Center song: unlink one first); or
 * when the merged song would have two entries in one book with the same
 * variant note, or none (a song is in a book once per variant note: delete
 * one, or give it a variant note, first).
 */

/** An entry as a merge sees it. */
export interface MergeEntry {
    id: number;
    bookId: number;
    /** Its book's name, for the preview: "Rejoice Hymns". */
    bookName: string;
    /** "R-108", "G-Front Cover", an unnumbered book's short name. */
    label: string;
    variantNote: string | null;
}

/** A catalog song as a merge sees it. */
export interface MergeSong {
    id: number;
    hymnId: number;
    /** Its hymn's title. */
    title: string;
    tuneId: number | null;
    tuneName: string | null;
    /** The Planning Center song it is linked to, or null. */
    pcoSongId: string | null;
    /** That song's title, as the mirror has it; null when not linked or the mirror lacks it. */
    pcoTitle: string | null;
    notes: string | null;
    entries: MergeEntry[];
    marks: SongMark[];
}

/** A hymn as a merge sees it. */
export interface MergeHymn {
    id: number;
    title: string;
    firstLine: string | null;
    notes: string | null;
    /** Its other titles, as written. */
    aliases: string[];
    songs: MergeSong[];
}

/** A tune as a merge sees it. */
export interface MergeTune {
    id: number;
    name: string;
    meter: string | null;
    notes: string | null;
    /** Its other names, as written. */
    aliases: string[];
    songs: MergeSong[];
}

/** What is merged: two hymns or two tunes. */
export type MergeKind = "hymn" | "tune";

/** A song of the source that moves to the target as it is. */
export interface SongMove {
    songId: number;
    /** Its label before the merge, and after: "Rejoice - the Lord Is King (DARWALL)". */
    from: string;
    to: string;
    /** Its entries' labels. */
    entries: string[];
}

/** A song of the source merged into the target's song of the same tune (or hymn). */
export interface SongMergeStep {
    /** The source's song, which is deleted. */
    sourceSongId: number;
    /** The target's song, which takes what the source's had. */
    targetSongId: number;
    /** The source song's label, and the target song's. */
    source: string;
    target: string;
    /** The labels of the entries that move to the target's song. */
    entries: string[];
    /** The marks that move: those the target's song lacks. */
    marks: SongMarkKind[];
    /** Whether the source song's notes are added to the target's. */
    notes: boolean;
    /** The Planning Center link that moves to the target's song, which has none; null when none moves. */
    link: { pcoSongId: string; title: string | null } | null;
}

/** Why a merge is refused. */
export type MergeRefusalReason =
    /** The target is the source. */
    | "same"
    /** Two songs that would merge are linked to different Planning Center songs. */
    | "linked-apart"
    /** The merged song would have two entries in one book with the same variant note, or none. */
    | "entry-collision";

/** One reason a merge is refused, with a message fit to show. */
export interface MergeRefusal {
    reason: MergeRefusalReason;
    message: string;
    /** The songs it is about (the source's, then the target's); empty for "same". */
    songIds: number[];
}

/** What a merge does, or would do: the preview, and the result once it is applied. */
export interface MergePreview {
    kind: MergeKind;
    /** The hymn (or tune) merged and deleted, by its title (or name). */
    source: { id: number; name: string };
    /** The hymn (or tune) that takes everything. */
    target: { id: number; name: string };
    /** The source's songs that move to the target as they are. */
    moves: SongMove[];
    /** The source's songs merged into the target's songs. */
    merges: SongMergeStep[];
    /** The names that become the target's other names: the source's name and its other names, but those the target has. */
    aliasesAdded: string[];
    /** The source's first line (a hymn) or meter (a tune), which the target takes because it has none; null when it takes none. */
    detailTaken: string | null;
    /** Whether the source's notes are added to the target's. */
    notesAdded: boolean;
    /** Why the merge is refused; empty when it may go ahead. */
    refusals: MergeRefusal[];
}

/** "Amazing Grace (NEW BRITAIN)", or the title alone when the tune is unknown. */
function songLabel(title: string, tuneName: string | null): string {
    return tuneName === null ? title : `${title} (${tuneName})`;
}

/** A song's label with its hymn's title and its tune's name. */
function labelOf(song: Pick<MergeSong, "title" | "tuneName">): string {
    return songLabel(song.title, song.tuneName);
}

/** A side of the merge, whichever kind it is. */
interface Side {
    id: number;
    name: string;
    detail: string | null;
    notes: string | null;
    aliases: string[];
    songs: MergeSong[];
}

/** How a kind of merge matches songs and names, and labels a moved song. */
interface Rules {
    kind: MergeKind;
    /** What two songs that would merge share: their tune (a hymn merge) or their hymn (a tune merge). */
    collisionKey: (song: MergeSong) => number | null;
    normalize: (name: string) => string;
    /** A source song's label once it is the target's. */
    movedLabel: (song: MergeSong, target: Side) => string;
}

const HYMN_RULES: Rules = {
    kind: "hymn",
    collisionKey: (song) => song.tuneId,
    normalize: normalizeTitle,
    movedLabel: (song, target) => songLabel(target.name, song.tuneName),
};

const TUNE_RULES: Rules = {
    kind: "tune",
    collisionKey: (song) => song.hymnId,
    normalize: normalizeTuneName,
    movedLabel: (song, target) => songLabel(song.title, target.name),
};

/** A Planning Center song, for a message: its title in quotes, or its id. */
function describePcoSong(song: MergeSong): string {
    return song.pcoTitle === null ? `Planning Center song ${song.pcoSongId}` : `"${song.pcoTitle}"`;
}

/** The refusals of merging `source` into `target`, songs that share a tune (or hymn). */
function pairRefusals(source: MergeSong, target: MergeSong): MergeRefusal[] {
    const refusals: MergeRefusal[] = [];
    const songIds = [source.id, target.id];
    if (source.pcoSongId !== null && target.pcoSongId !== null && source.pcoSongId !== target.pcoSongId) {
        refusals.push({
            reason: "linked-apart",
            message: `"${labelOf(source)}" and "${labelOf(target)}" are linked to different Planning Center songs, ${describePcoSong(source)} and ${describePcoSong(target)}. Unlink one of them first.`,
            songIds,
        });
    }
    for (const entry of source.entries) {
        const twin = target.entries.find(
            (other) => other.bookId === entry.bookId && other.variantNote === entry.variantNote
        );
        if (twin) {
            const variant =
                entry.variantNote === null ? "" : ` with the variant note "${entry.variantNote}"`;
            refusals.push({
                reason: "entry-collision",
                message: `"${labelOf(target)}" would be in ${entry.bookName} twice${variant}: ${twin.label} and ${entry.label}. Delete one of the entries, or give one a variant note, first.`,
                songIds,
            });
        }
    }
    return refusals;
}

/** The source's names that become the target's other names: none the target has, each once. */
function aliasesAdded(source: Side, target: Side, normalize: (name: string) => string): string[] {
    const taken = new Set([target.name, ...target.aliases].map(normalize));
    const added: string[] = [];
    for (const name of [source.name, ...source.aliases]) {
        const key = normalize(name);
        if (key !== "" && !taken.has(key)) {
            taken.add(key);
            added.push(name);
        }
    }
    return added;
}

function plan(rules: Rules, source: Side, target: Side): MergePreview {
    const preview: MergePreview = {
        kind: rules.kind,
        source: { id: source.id, name: source.name },
        target: { id: target.id, name: target.name },
        moves: [],
        merges: [],
        aliasesAdded: [],
        detailTaken: null,
        notesAdded: false,
        refusals: [],
    };
    if (source.id === target.id) {
        preview.refusals.push({
            reason: "same",
            message: `A ${rules.kind} cannot be merged into itself. Choose another ${rules.kind}.`,
            songIds: [],
        });
        return preview;
    }
    for (const song of source.songs) {
        const key = rules.collisionKey(song);
        const twin = target.songs.find((other) => rules.collisionKey(other) === key);
        if (!twin) {
            preview.moves.push({
                songId: song.id,
                from: labelOf(song),
                to: rules.movedLabel(song, target),
                entries: song.entries.map(({ label }) => label),
            });
            continue;
        }
        preview.refusals.push(...pairRefusals(song, twin));
        const twinMarks = new Set(twin.marks.map(({ mark }) => mark));
        preview.merges.push({
            sourceSongId: song.id,
            targetSongId: twin.id,
            source: labelOf(song),
            target: labelOf(twin),
            entries: song.entries.map(({ label }) => label),
            marks: song.marks.map(({ mark }) => mark).filter((mark) => !twinMarks.has(mark)),
            notes: song.notes !== null,
            link:
                song.pcoSongId !== null && twin.pcoSongId === null
                    ? { pcoSongId: song.pcoSongId, title: song.pcoTitle }
                    : null,
        });
    }
    preview.aliasesAdded = aliasesAdded(source, target, rules.normalize);
    preview.detailTaken = target.detail === null ? source.detail : null;
    preview.notesAdded = source.notes !== null;
    return preview;
}

function hymnSide(hymn: MergeHymn): Side {
    return { ...hymn, name: hymn.title, detail: hymn.firstLine };
}

function tuneSide(tune: MergeTune): Side {
    return { ...tune, detail: tune.meter };
}

/**
 * Plan merging hymn `source` into hymn `target` (see the module's comment):
 * the songs that move and merge, the other titles and fields the target
 * takes, and why the merge is refused, if it is.
 */
export function planHymnMerge(source: MergeHymn, target: MergeHymn): MergePreview {
    return plan(HYMN_RULES, hymnSide(source), hymnSide(target));
}

/**
 * Plan merging tune `source` into tune `target`: as `planHymnMerge`, with
 * songs matched by hymn rather than by tune, other names by
 * `normalizeTuneName`, and the meter in place of the first line.
 */
export function planTuneMerge(source: MergeTune, target: MergeTune): MergePreview {
    return plan(TUNE_RULES, tuneSide(source), tuneSide(target));
}

/**
 * Notes after notes: `added` after `kept` with a blank line between them,
 * or whichever there is. What a merge does with two hymns', tunes' or
 * songs' notes.
 */
export function joinNotes(kept: string | null, added: string | null): string | null {
    if (kept === null || added === null) {
        return kept ?? added;
    }
    return `${kept}\n\n${added}`;
}
