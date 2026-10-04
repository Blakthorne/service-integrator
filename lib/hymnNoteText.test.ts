import { describe, expect, test } from "vitest";
import type { ItemNote } from "./domain";
import {
    CHANGED_SINCE_PREVIEW_TEXT,
    HYMN_NOTE_STATE_WORDS,
    MISSING_CATEGORY_HELP,
    NOT_ATTEMPTED_TEXT,
    SYNC_DIALOG_DESCRIPTION,
    cardNoteBadge,
    confirmLabel,
    hymnNoteBadgeLabel,
    hymnNoteStateTag,
    previewLines,
    previewRows,
    previewSummary,
    resultLines,
    resultRows,
    resultSummary,
    writesToMake,
    type HymnNoteLine,
} from "./hymnNoteText";
import {
    diffHymnNotes,
    type HymnNoteAction,
    type HymnNoteDiff,
    type HymnNoteItem,
    type HymnNoteMatch,
} from "./hymnNotes";
import type { HymnNoteSyncCounts, HymnNoteSyncItem } from "./queries/hymnNotes";
import { DEFAULT_SETTINGS } from "./settings";

/** St. Anne's song at R-396 and G-317. */
const ST_ANNE: HymnNoteMatch = {
    tuneName: "ST. ANNE",
    entries: [
        { label: "R-396", variantNote: null },
        { label: "G-317", variantNote: null },
    ],
};

/** The hymnal notes' category, in which `note` puts its notes. */
const HYMNAL = { id: "501", name: "Hymnal" };

let noteIds = 7000;

function note(content: string): ItemNote {
    noteIds += 1;
    return { id: String(noteIds), categoryId: "501", categoryName: "Hymnal", content };
}

function songItem(
    id: string,
    match: HymnNoteMatch | null,
    notes: ItemNote[] = []
): HymnNoteItem {
    return { id, title: `Song ${id}`, itemType: "song", sequence: Number(id), match, notes };
}

/** The diff of one item, with `owned` the notes the app wrote. */
function diffOf(item: HymnNoteItem, owned: readonly ItemNote[] = []): HymnNoteDiff {
    const [diff] = diffHymnNotes(
        [item],
        HYMNAL,
        DEFAULT_SETTINGS,
        new Set(owned.map(({ id }) => id))
    );
    return diff;
}

/** A line as "<label>: <text>", with what it was and why when it says them. */
function said(line: HymnNoteLine): string {
    return [
        `${line.label}: ${line.from !== null ? `${line.from} -> ` : ""}${line.text}`,
        line.why !== null ? ` (${line.why})` : "",
    ].join("");
}

describe("previewLines", () => {
    test("a note to create", () => {
        expect(previewLines(diffOf(songItem("1", ST_ANNE))).map(said)).toEqual([
            "Add: R-396 / G-317",
        ]);
    });

    test("a note to change, old to new", () => {
        const lines = previewLines(diffOf(songItem("1", ST_ANNE, [note("R-396")])));
        expect(lines.map(said)).toEqual(["Change: R-396 -> R-396 / G-317"]);
        expect(lines[0]).toMatchObject({ kind: "change", from: "R-396" });
    });

    test("a note in sync", () => {
        expect(previewLines(diffOf(songItem("1", ST_ANNE, [note("R-396 / G-317")]))).map(said)).toEqual([
            "In sync: R-396 / G-317",
        ]);
    });

    test("a note the app wrote, for a song with no numbers now, is removed", () => {
        const old = note("R-12");
        expect(previewLines(diffOf(songItem("1", null, [old]), [old])).map(said)).toEqual([
            "Remove: R-12 (the song has no numbers)",
        ]);
    });

    test("a note the app did not write is left alone", () => {
        expect(previewLines(diffOf(songItem("1", null, [note("Key of D")]))).map(said)).toEqual([
            "Left alone: Key of D (not written by the app)",
        ]);
    });

    test("extra notes: the app's are removed, the others left alone, beside the one in sync", () => {
        const mine = note("R-396 / G-317");
        const extra = note("R-396 / G-317");
        const typed = note("old number");
        const lines = previewLines(
            diffOf(songItem("1", ST_ANNE, [mine, extra, typed]), [mine, extra])
        );
        expect(lines.map(said)).toEqual([
            "In sync: R-396 / G-317",
            "Remove: R-396 / G-317 (an extra note)",
            "Left alone: old number (an extra note, not written by the app)",
        ]);
        expect(lines.map((l) => l.kind)).toEqual(["in-sync", "remove", "left-alone"]);
    });

    test("a change comes with the extras it removes", () => {
        const mine = note("R-1");
        const extra = note("R-2");
        expect(
            previewLines(diffOf(songItem("1", ST_ANNE, [mine, extra]), [mine, extra])).map(said)
        ).toEqual(["Change: R-1 -> R-396 / G-317", "Remove: R-2 (an extra note)"]);
    });

    test("no note and nothing to say", () => {
        expect(previewLines(diffOf(songItem("1", null))).map(said)).toEqual([
            "No note: No numbers, so no note.",
        ]);
    });
});

describe("previewRows and writesToMake", () => {
    const mine = note("R-1");
    const diffs = diffHymnNotes(
        [
            songItem("2", ST_ANNE),
            songItem("3", ST_ANNE, [mine, note("R-2")]),
            songItem("4", null),
        ],
        HYMNAL,
        DEFAULT_SETTINGS,
        new Set([mine.id])
    );

    test("a row per song item, in sequence order, with its title", () => {
        expect(previewRows(diffs).map(({ itemId, title }) => [itemId, title])).toEqual([
            ["2", "Song 2"],
            ["3", "Song 3"],
            ["4", "Song 4"],
        ]);
    });

    test("counts every write, extras included", () => {
        expect(writesToMake(diffs)).toBe(2);
        expect(writesToMake([])).toBe(0);
    });
});

/** A diff with only the fields the summary reads. */
function summaryDiff(
    action: HymnNoteAction,
    changes: HymnNoteDiff["changes"] = [],
    keep: HymnNoteDiff["keep"] = []
): HymnNoteDiff {
    return {
        itemId: "1",
        title: "Song",
        sequence: 1,
        content: null,
        current: null,
        action,
        changes,
        keep,
    };
}

const KEEP = { kind: "keep", noteId: "9", content: "x", reason: "nothing-to-say" } as const;

describe("previewSummary", () => {
    test("says the writes a sync would make, with the noun on the first", () => {
        expect(
            previewSummary([
                summaryDiff("create", [{ kind: "create", content: "R-1" }]),
                summaryDiff("create", [{ kind: "create", content: "R-2" }]),
                summaryDiff("update", [{ kind: "update", noteId: "1", from: "a", content: "b" }]),
                summaryDiff("delete", [
                    { kind: "delete", noteId: "2", content: "c", reason: "nothing-to-say" },
                ]),
            ])
        ).toBe("Will add 2 notes, change 1 and remove 1.");
        expect(
            previewSummary([
                summaryDiff("update", [{ kind: "update", noteId: "1", from: "a", content: "b" }]),
            ])
        ).toBe("Will change 1 note.");
    });

    test("says how many notes are in sync and left alone", () => {
        expect(
            previewSummary([
                summaryDiff("unchanged"),
                summaryDiff("dedupe", [
                    { kind: "delete", noteId: "2", content: "c", reason: "duplicate" },
                ]),
                summaryDiff("keep", [], [KEEP, KEEP]),
                summaryDiff("none"),
            ])
        ).toBe(
            "Will remove 1 note. 2 notes already in sync. 2 notes left alone: not written by the app."
        );
    });

    test("says when there is nothing to write", () => {
        expect(previewSummary([summaryDiff("unchanged")])).toBe(
            "Nothing to write. 1 note already in sync."
        );
        expect(previewSummary([summaryDiff("none")])).toBe("Nothing to write.");
        expect(previewSummary([])).toBe("This plan has no songs, so there is nothing to write.");
    });
});

function syncItem(overrides: Partial<HymnNoteSyncItem> & { itemId: string }): HymnNoteSyncItem {
    return {
        title: `Song ${overrides.itemId}`,
        sequence: Number(overrides.itemId),
        action: "create",
        outcome: "done",
        made: [],
        keep: [],
        error: null,
        ...overrides,
    };
}

describe("resultLines", () => {
    test("the writes made, in the past tense", () => {
        expect(
            resultLines(
                syncItem({
                    itemId: "1",
                    action: "update",
                    made: [
                        { kind: "update", noteId: "1", from: "R-1", content: "R-396" },
                        { kind: "delete", noteId: "2", content: "R-2", reason: "duplicate" },
                    ],
                })
            ).map(said)
        ).toEqual(["Changed: R-1 -> R-396", "Removed: R-2 (an extra note)"]);
        expect(
            resultLines(
                syncItem({ itemId: "1", made: [{ kind: "create", content: "R-396" }] })
            ).map(said)
        ).toEqual(["Added: R-396"]);
    });

    test("a failure comes first, with Planning Center's reason, then what was made before it", () => {
        expect(
            resultLines(
                syncItem({
                    itemId: "1",
                    action: "update",
                    outcome: "failed",
                    made: [{ kind: "update", noteId: "1", from: "R-1", content: "R-396" }],
                    error: "content: is too long",
                })
            ).map(said)
        ).toEqual(["Failed: content: is too long", "Changed: R-1 -> R-396"]);
        expect(
            resultLines(syncItem({ itemId: "1", outcome: "failed", error: "  " })).map(said)
        ).toEqual(["Failed: No reason was given."]);
    });

    test("an item that changed since the preview says it was not written", () => {
        expect(
            resultLines(syncItem({ itemId: "1", action: "update", outcome: "changed" })).map(said)
        ).toEqual([`Not written: ${CHANGED_SINCE_PREVIEW_TEXT}`]);
        expect(CHANGED_SINCE_PREVIEW_TEXT).toBe(
            "Changed since the preview, so nothing was written. Preview again to see what a sync would do now."
        );
    });

    test("an item the rate limit stopped the sync before says it was not tried", () => {
        expect(
            resultLines(syncItem({ itemId: "1", action: "create", outcome: "not-attempted" })).map(said)
        ).toEqual([`Not written: ${NOT_ATTEMPTED_TEXT}`]);
    });

    test("a note that needed nothing, the notes left alone, and a song with no note", () => {
        expect(
            resultLines(syncItem({ itemId: "1", action: "unchanged", outcome: "nothing-to-do" })).map(
                said
            )
        ).toEqual(["In sync: No change needed."]);
        expect(
            resultLines(
                syncItem({ itemId: "1", action: "keep", outcome: "nothing-to-do", keep: [KEEP] })
            ).map(said)
        ).toEqual(["Left alone: x (not written by the app)"]);
        expect(
            resultLines(syncItem({ itemId: "1", action: "none", outcome: "nothing-to-do" })).map(said)
        ).toEqual(["No note: No numbers, so no note."]);
    });
});

describe("resultRows", () => {
    test("puts the failures first, then the rest, each in sequence order", () => {
        const rows = resultRows([
            syncItem({ itemId: "1" }),
            syncItem({ itemId: "4", outcome: "failed", error: "boom" }),
            syncItem({ itemId: "2", outcome: "failed", error: "boom" }),
            syncItem({ itemId: "3", action: "none", outcome: "nothing-to-do" }),
        ]);
        expect(rows.map((row) => row.itemId)).toEqual(["2", "4", "1", "3"]);
        expect(rows[0]).toMatchObject({ title: "Song 2" });
    });

    test("puts the items not written, changed or not tried, with the failures", () => {
        const rows = resultRows([
            syncItem({ itemId: "1" }),
            syncItem({ itemId: "4", outcome: "not-attempted" }),
            syncItem({ itemId: "3", outcome: "changed" }),
            syncItem({ itemId: "2", outcome: "failed", error: "boom" }),
        ]);
        expect(rows.map((row) => row.itemId)).toEqual(["2", "3", "4", "1"]);
    });
});

function counts(overrides: Partial<HymnNoteSyncCounts>): HymnNoteSyncCounts {
    return {
        created: 0,
        updated: 0,
        deleted: 0,
        unchanged: 0,
        kept: 0,
        failed: 0,
        changed: 0,
        notAttempted: 0,
        ...overrides,
    };
}

describe("resultSummary", () => {
    test("says what was written, and what failed", () => {
        expect(resultSummary(counts({ created: 2, updated: 1, deleted: 1 }))).toBe(
            "Added 2 notes, changed 1 and removed 1."
        );
        expect(resultSummary(counts({ updated: 1, failed: 1 }))).toBe(
            "Changed 1 note. 1 song's note could not be written."
        );
        expect(resultSummary(counts({ failed: 2 }))).toBe("2 songs' notes could not be written.");
    });

    test("says how many songs changed since the preview, and were not written", () => {
        expect(resultSummary(counts({ created: 1, changed: 1 }))).toBe(
            "Added 1 note. 1 song changed since the preview, so it was not written: preview again."
        );
        expect(resultSummary(counts({ changed: 2, unchanged: 1 }))).toBe(
            "2 songs changed since the preview, so they were not written: preview again. 1 song needed nothing."
        );
    });

    test("says how many songs the rate limit kept the sync from trying", () => {
        expect(resultSummary(counts({ created: 1, failed: 1, notAttempted: 2 }))).toBe(
            "Added 1 note. 1 song's note could not be written. Planning Center asked the app to slow down, so 2 songs were not tried: preview again in a minute."
        );
        expect(resultSummary(counts({ failed: 1, notAttempted: 1 }))).toBe(
            "1 song's note could not be written. Planning Center asked the app to slow down, so 1 song was not tried: preview again in a minute."
        );
    });

    test("reads counts made before they counted changed songs as none", () => {
        const older: HymnNoteSyncCounts = {
            created: 0,
            updated: 0,
            deleted: 0,
            unchanged: 1,
            kept: 0,
            failed: 0,
        };
        expect(resultSummary(older)).toBe("Nothing needed writing. 1 song needed nothing.");
    });

    test("says what needed nothing, and what was left alone", () => {
        expect(resultSummary(counts({ unchanged: 3, kept: 1 }))).toBe(
            "Nothing needed writing. 3 songs needed nothing. 1 note left alone: not written by the app."
        );
        expect(resultSummary(counts({ created: 1, unchanged: 1 }))).toBe(
            "Added 1 note. 1 song needed nothing."
        );
    });
});

describe("confirmLabel and MISSING_CATEGORY_HELP", () => {
    test("say what Confirm writes, and how to fix a missing category", () => {
        expect(confirmLabel(1)).toBe("Write 1 change");
        expect(confirmLabel(3)).toBe("Write 3 changes");
        expect(MISSING_CATEGORY_HELP).toContain("web app");
    });
});

describe("SYNC_DIALOG_DESCRIPTION", () => {
    test("says a note is rewritten whoever wrote it, and only the app's are removed", () => {
        expect(SYNC_DIALOG_DESCRIPTION).toContain("rewritten to its numbers, whoever wrote it");
        expect(SYNC_DIALOG_DESCRIPTION).toContain("only notes the app wrote are ever removed");
    });

    test("is what the diff does: a hand-typed note is changed, and left alone only when it would go", () => {
        const typed = note("R-1");
        expect(previewLines(diffOf(songItem("1", ST_ANNE, [typed]))).map((l) => l.kind)).toEqual([
            "change",
        ]);
        expect(previewLines(diffOf(songItem("1", null, [typed]))).map((l) => l.kind)).toEqual([
            "left-alone",
        ]);
    });
});

describe("HYMN_NOTE_STATE_WORDS", () => {
    test("one wording for each state: badges put Note before it, the dialog's tags start with a capital", () => {
        expect(HYMN_NOTE_STATE_WORDS).toEqual({
            "in-sync": "in sync",
            differs: "needs sync",
            missing: "missing",
            kept: "left alone",
        });
        expect(["in-sync", "differs", "missing", "kept"].map((s) => hymnNoteBadgeLabel(s as "kept"))).toEqual([
            "Note in sync",
            "Note needs sync",
            "Note missing",
            "Note left alone",
        ]);
        expect(hymnNoteStateTag("in-sync")).toBe("In sync");
        expect(hymnNoteStateTag("kept")).toBe("Left alone");
    });

    test("the dialog tags a note in sync, and one left alone, with the same words", () => {
        const inSync = previewLines(diffOf(songItem("1", ST_ANNE, [note("R-396 / G-317")])));
        const leftAlone = previewLines(diffOf(songItem("2", null, [note("Key of A")])));
        expect(inSync[0].label).toBe(hymnNoteStateTag("in-sync"));
        expect(leftAlone[0].label).toBe(hymnNoteStateTag("kept"));
    });
});

describe("cardNoteBadge", () => {
    test.each([
        ["unchanged", "in-sync", "Note in sync", null],
        ["create", "missing", "Note missing", null],
        ["update", "differs", "Note needs sync", null],
        ["dedupe", "differs", "Note needs sync", null],
        ["delete", "differs", "Note needs sync", null],
        ["keep", "kept", "Note left alone", "not written by the app"],
    ] as const)("%s is %s", (action, state, label, detail) => {
        expect(cardNoteBadge({ action })).toEqual({ state, label, detail });
    });

    test("is null with nothing to say, or no diff to read", () => {
        expect(cardNoteBadge({ action: "none" })).toBeNull();
        expect(cardNoteBadge(null)).toBeNull();
    });
});
