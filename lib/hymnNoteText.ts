import {
    hymnNoteState,
    type HymnNoteChange,
    type HymnNoteDiff,
    type HymnNoteKeep,
    type HymnNoteRemovalReason,
    type HymnNoteState,
} from "./hymnNotes";
// Types only: the sync's results, as the plan's action returns them.
import type { HymnNoteSyncCounts, HymnNoteSyncItem } from "./queries/hymnNotes";

/**
 * The words of a plan's hymnal notes on its pages: what the "Sync hymn
 * notes" dialog previews and then reports, song item by song item, and the
 * note status on each Schedule-tab card. Pure and safe on both sides: the
 * components render what these return.
 */

/** What happens, or happened, to one note, as a line of the dialog. */
export type HymnNoteLineKind =
    /** A note to create, or created. */
    | "add"
    /** A note whose words change, or changed. */
    | "change"
    /** A note the app wrote, to delete or deleted. */
    | "remove"
    /** A note that says what it should. */
    | "in-sync"
    /** A note the app did not write, which it leaves alone. */
    | "left-alone"
    /** No note, and nothing to say: the song has no numbers. */
    | "no-note"
    /** A write that failed (results only). */
    | "failed";

/** One line of a song item's row in the dialog. */
export interface HymnNoteLine {
    kind: HymnNoteLineKind;
    /** Its tag, words that do not rely on colour: "Add", "Changed", "Left alone". */
    label: string;
    /** The note's words (what it will say, or says); for "no-note" and "failed", what to know. */
    text: string;
    /** For a change, what the note said before; else null. */
    from: string | null;
    /** Why, when the line needs it: "an extra note", "not written by the app". */
    why: string | null;
}

/** A song item's row in the dialog: its title in the plan, and what happens to its notes. */
export interface HymnNoteRow {
    itemId: string;
    title: string;
    lines: HymnNoteLine[];
}

/** Whether a line says what will happen (the preview) or what happened (the results). */
type Tense = "preview" | "result";

const LABELS: Readonly<Record<HymnNoteChange["kind"], Record<Tense, string>>> = {
    create: { preview: "Add", result: "Added" },
    update: { preview: "Change", result: "Changed" },
    delete: { preview: "Remove", result: "Removed" },
};

/** Why a note would go: its song has no numbers, or it is an extra one. */
function removalWhy(reason: HymnNoteRemovalReason): string {
    return reason === "duplicate" ? "an extra note" : "the song has no numbers";
}

function line(
    kind: HymnNoteLineKind,
    label: string,
    text: string,
    { from = null, why = null }: { from?: string | null; why?: string | null } = {}
): HymnNoteLine {
    return { kind, label, text, from, why };
}

function changeLine(change: HymnNoteChange, tense: Tense): HymnNoteLine {
    const label = LABELS[change.kind][tense];
    switch (change.kind) {
        case "create":
            return line("add", label, change.content);
        case "update":
            return line("change", label, change.content, { from: change.from });
        case "delete":
            return line("remove", label, change.content, { why: removalWhy(change.reason) });
    }
}

/** A note left alone: "Left alone", not written by the app (an extra one, or one the song no longer needs). */
function keepLine(keep: HymnNoteKeep): HymnNoteLine {
    return line("left-alone", hymnNoteStateTag("kept"), keep.content, {
        why:
            keep.reason === "duplicate"
                ? "an extra note, not written by the app"
                : "not written by the app",
    });
}

/** The line of a song item with no note and nothing to say. */
const NO_NOTE_LINE = line("no-note", "No note", "No numbers, so no note.");

/**
 * What a sync would do to a song item's notes, line by line: the note in
 * sync, when it is; then each write, in order (add, change, remove); then
 * the notes left alone, which the app did not write. An item with none of
 * these has no note and no numbers.
 */
export function previewLines(diff: HymnNoteDiff): HymnNoteLine[] {
    const lines: HymnNoteLine[] = [];
    if ((diff.action === "unchanged" || diff.action === "dedupe") && diff.content !== null) {
        lines.push(line("in-sync", hymnNoteStateTag("in-sync"), diff.content));
    }
    lines.push(...diff.changes.map((change) => changeLine(change, "preview")));
    lines.push(...diff.keep.map(keepLine));
    return lines.length > 0 ? lines : [NO_NOTE_LINE];
}

/** The preview's rows: every song item, in sequence order (as `diffHymnNotes` gives them). */
export function previewRows(diffs: readonly HymnNoteDiff[]): HymnNoteRow[] {
    return diffs.map((diff) => ({
        itemId: diff.itemId,
        title: diff.title,
        lines: previewLines(diff),
    }));
}

/** How many writes a sync of `diffs` would make: what its Confirm says. */
export function writesToMake(diffs: readonly HymnNoteDiff[]): number {
    return diffs.reduce((count, diff) => count + diff.changes.length, 0);
}

/** "1 note", "2 notes". */
function count(n: number, noun: string): string {
    return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** "a", "a and b", "a, b and c". */
function listed(parts: readonly string[]): string {
    return parts.length <= 1
        ? parts.join("")
        : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * The verbs of a set of writes, with "note" after the first number:
 * "add 2 notes, change 1 and remove 1". Empty when there are none.
 */
function writes(verbs: readonly [string, number][], capitalize: boolean): string {
    const parts: string[] = [];
    for (const [verb, n] of verbs) {
        if (n > 0) {
            parts.push(`${verb} ${parts.length === 0 ? count(n, "note") : n}`);
        }
    }
    const text = listed(parts);
    return capitalize && text !== "" ? text[0].toUpperCase() + text.slice(1) : text;
}

/**
 * What the preview says above its rows: the writes a sync would make
 * ("Will add 2 notes, change 1 and remove 1."), or that there is nothing to
 * write; then how many notes are in sync already, and how many are left
 * alone because the app did not write them.
 */
export function previewSummary(diffs: readonly HymnNoteDiff[]): string {
    let creates = 0;
    let updates = 0;
    let deletes = 0;
    let inSync = 0;
    let leftAlone = 0;
    for (const diff of diffs) {
        for (const change of diff.changes) {
            if (change.kind === "create") {
                creates += 1;
            } else if (change.kind === "update") {
                updates += 1;
            } else {
                deletes += 1;
            }
        }
        if (diff.action === "unchanged" || diff.action === "dedupe") {
            inSync += 1;
        }
        leftAlone += diff.keep.length;
    }
    if (diffs.length === 0) {
        return "This plan has no songs, so there is nothing to write.";
    }
    const sentences = [
        creates + updates + deletes > 0
            ? `Will ${writes(
                  [
                      ["add", creates],
                      ["change", updates],
                      ["remove", deletes],
                  ],
                  false
              )}.`
            : "Nothing to write.",
    ];
    if (inSync > 0) {
        sentences.push(`${count(inSync, "note")} already in sync.`);
    }
    if (leftAlone > 0) {
        sentences.push(`${count(leftAlone, "note")} left alone: not written by the app.`);
    }
    return sentences.join(" ");
}

/** What a result says of an item not written because it changed since the preview. */
export const CHANGED_SINCE_PREVIEW_TEXT =
    "Changed since the preview, so nothing was written. Preview again to see what a sync would do now.";

/** What a result says of an item not tried because Planning Center's rate limit stopped the sync. */
export const NOT_ATTEMPTED_TEXT =
    "Not tried: Planning Center asked the app to slow down, so the sync stopped before this song. Preview again in a minute.";

/**
 * What became of a song item's notes in a sync, line by line: the failure
 * first, with Planning Center's reason, or that it changed since the
 * preview and was not written; then each write made, in order; then, for an
 * item that needed nothing, that its note is in sync; then the notes left
 * alone. An item with none of these has no note and no numbers.
 */
export function resultLines(item: HymnNoteSyncItem): HymnNoteLine[] {
    const lines: HymnNoteLine[] = [];
    if (item.outcome === "changed") {
        lines.push(line("failed", "Not written", CHANGED_SINCE_PREVIEW_TEXT));
    }
    if (item.outcome === "not-attempted") {
        lines.push(line("failed", "Not written", NOT_ATTEMPTED_TEXT));
    }
    if (item.outcome === "failed") {
        const reason = item.error?.trim() ?? "";
        lines.push(line("failed", "Failed", reason === "" ? "No reason was given." : reason));
    }
    lines.push(...item.made.map((change) => changeLine(change, "result")));
    if (item.outcome === "nothing-to-do" && item.action === "unchanged") {
        lines.push(line("in-sync", hymnNoteStateTag("in-sync"), "No change needed."));
    }
    lines.push(...item.keep.map(keepLine));
    return lines.length > 0 ? lines : [NO_NOTE_LINE];
}

/** Whether a result needs the person's attention: its writes failed, or were not made. */
function needsAttention(item: HymnNoteSyncItem): boolean {
    return (
        item.outcome === "failed" ||
        item.outcome === "changed" ||
        item.outcome === "not-attempted"
    );
}

/**
 * The results' rows: the song items whose writes failed, or were not made
 * (they changed since the preview, or the rate limit stopped the sync),
 * first, so they are seen; then the rest; each group in sequence order.
 */
export function resultRows(items: readonly HymnNoteSyncItem[]): HymnNoteRow[] {
    return [...items]
        .sort(
            (a, b) =>
                Number(!needsAttention(a)) - Number(!needsAttention(b)) ||
                a.sequence - b.sequence
        )
        .map((item) => ({ itemId: item.itemId, title: item.title, lines: resultLines(item) }));
}

/**
 * What the results say above their rows: the writes made ("Added 2 notes,
 * changed 1 and removed 1."), or that nothing needed writing; how many
 * songs' notes could not be written; how many changed since the preview and
 * were not written; how many were not tried because Planning Center's rate
 * limit stopped the sync; how many songs needed nothing; and how many notes
 * were left alone.
 */
export function resultSummary(counts: HymnNoteSyncCounts): string {
    const made = counts.created + counts.updated + counts.deleted;
    const changed = counts.changed ?? 0;
    const notAttempted = counts.notAttempted ?? 0;
    const sentences: string[] = [];
    if (made > 0) {
        sentences.push(
            `${writes(
                [
                    ["added", counts.created],
                    ["changed", counts.updated],
                    ["removed", counts.deleted],
                ],
                true
            )}.`
        );
    }
    if (counts.failed > 0) {
        sentences.push(
            counts.failed === 1
                ? "1 song's note could not be written."
                : `${counts.failed} songs' notes could not be written.`
        );
    }
    if (changed > 0) {
        sentences.push(
            changed === 1
                ? "1 song changed since the preview, so it was not written: preview again."
                : `${changed} songs changed since the preview, so they were not written: preview again.`
        );
    }
    if (notAttempted > 0) {
        sentences.push(
            notAttempted === 1
                ? "Planning Center asked the app to slow down, so 1 song was not tried: preview again in a minute."
                : `Planning Center asked the app to slow down, so ${notAttempted} songs were not tried: preview again in a minute.`
        );
    }
    if (made === 0 && counts.failed === 0 && changed === 0 && notAttempted === 0) {
        sentences.push("Nothing needed writing.");
    }
    if (counts.unchanged > 0) {
        sentences.push(
            counts.unchanged === 1 ? "1 song needed nothing." : `${counts.unchanged} songs needed nothing.`
        );
    }
    if (counts.kept > 0) {
        sentences.push(`${count(counts.kept, "note")} left alone: not written by the app.`);
    }
    return sentences.join(" ");
}

/** What the confirm button says: "Write 1 change", "Write 3 changes". */
export function confirmLabel(changes: number): string {
    return `Write ${count(changes, "change")}`;
}

/**
 * What the dialog says it does, under its title. A sync rewrites a song's
 * hymnal note to its numbers whoever wrote the note, but removes only notes
 * the app wrote (`diffHymnNotes`): a note it would remove and did not write
 * is left alone.
 */
export const SYNC_DIALOG_DESCRIPTION =
    "Each song's hymnal note is rewritten to its numbers, whoever wrote it; only notes the app wrote are ever removed. Notes in other categories are never touched.";

/** What the dialog adds under a missing category's message: how to fix it. */
export const MISSING_CATEGORY_HELP =
    "Planning Center's API can't create one, so add it in Planning Center's web app, then sync again. The category's name is a setting.";

/**
 * A hymnal note's state as the pages show it: `hymnNoteState`'s three (in
 * sync, differs, missing), and "kept": a note the app did not write, on a
 * song with nothing to say, which a sync leaves alone.
 */
export type HymnNoteShownState = HymnNoteState | "kept";

/**
 * The words for a hymnal note's state, one wording wherever it shows: the
 * dashboard's song rows and the Schedule tab's cards put "Note" before them
 * (`hymnNoteBadgeLabel`), and the sync dialog tags its notes with them
 * (`hymnNoteStateTag`). "Needs sync" covers a note that says something else
 * and a note of the app's to remove; "left alone", a note the app did not
 * write, which it would otherwise remove.
 */
export const HYMN_NOTE_STATE_WORDS: Readonly<Record<HymnNoteShownState, string>> = {
    "in-sync": "in sync",
    differs: "needs sync",
    missing: "missing",
    kept: "left alone",
};

/** A badge's words for a note's state: "Note in sync", "Note needs sync". */
export function hymnNoteBadgeLabel(state: HymnNoteShownState): string {
    return `Note ${HYMN_NOTE_STATE_WORDS[state]}`;
}

/** A dialog tag's words for a note's state: "In sync", "Left alone". */
export function hymnNoteStateTag(state: HymnNoteShownState): string {
    const words = HYMN_NOTE_STATE_WORDS[state];
    return `${words[0].toUpperCase()}${words.slice(1)}`;
}

/** Why a note is left alone, beside its badge on a card. */
const LEFT_ALONE_DETAIL = "not written by the app";

/** A song card's hymnal note status, in words that do not rely on colour. */
export interface CardNoteBadge {
    state: HymnNoteShownState;
    /** The badge: "Note in sync", as the dashboard's. */
    label: string;
    /** Said beside the badge, when it needs saying why: a note left alone was not written by the app. */
    detail: string | null;
}

/**
 * What a song card says of its hymnal note, from its diff (`hymnNoteDiffFor`),
 * in the words of `HYMN_NOTE_STATE_WORDS`: in sync; needs sync (it says
 * something else, or there are notes of the app's to remove); missing (it
 * should exist and does not); or left alone (the song has nothing to say,
 * and its notes are not the app's, so they stay). Null when there is no
 * diff (the notes cannot be compared) or nothing to say: no note, and no
 * numbers.
 */
export function cardNoteBadge(diff: Pick<HymnNoteDiff, "action"> | null): CardNoteBadge | null {
    if (diff === null) {
        return null;
    }
    const state: HymnNoteShownState | null = diff.action === "keep" ? "kept" : hymnNoteState(diff);
    return state === null
        ? null
        : {
              state,
              label: hymnNoteBadgeLabel(state),
              detail: state === "kept" ? LEFT_ALONE_DETAIL : null,
          };
}
