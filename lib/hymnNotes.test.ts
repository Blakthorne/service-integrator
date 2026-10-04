import { describe, expect, test } from "vitest";
import type { ItemNote, ItemNoteCategory } from "./domain";
import {
    HYMN_NOTE_TUNE_SEPARATOR,
    ambiguousCategoryMessage,
    countHymnNoteActions,
    diffHymnNotes,
    formatHymnNote,
    hymnNoteDiffFor,
    hymnNoteItems,
    hymnNoteState,
    hymnNotesToSync,
    matchHymnNoteCategory,
    missingCategoryMessage,
    planHymnNoteStatus,
    sameCategoryName,
    songItemNoteIds,
    type HymnNoteAction,
    type HymnNoteItem,
    type HymnNoteMatch,
    type PlanHymnNoteInput,
} from "./hymnNotes";
import { DEFAULT_SETTINGS, type HymnNoteSettings } from "./settings";

const SETTINGS: HymnNoteSettings = DEFAULT_SETTINGS;
const WITH_TUNE: HymnNoteSettings = { ...DEFAULT_SETTINGS, hymnNoteIncludesTune: true };

/** St. Anne's song at R-396 and G-317. */
const ST_ANNE: HymnNoteMatch = {
    tuneName: "ST. ANNE",
    entries: [
        { label: "R-396", variantNote: null },
        { label: "G-317", variantNote: null },
    ],
};

/** A song linked to a catalog song in no book. */
const NO_BOOK: HymnNoteMatch = { tuneName: "NEW BRITAIN", entries: [] };

/** The hymnal notes' category in the tests below: the one `note` puts notes in by default. */
const HYMNAL: ItemNoteCategory = { id: "501", name: "Hymnal" };

let noteIds = 9000;

function note(content: string, categoryName = "Hymnal", categoryId: string | null = "501"): ItemNote {
    noteIds += 1;
    return { id: String(noteIds), categoryId, categoryName, content };
}

function songItem(
    id: string,
    match: HymnNoteMatch | null,
    notes: ItemNote[] = [],
    sequence = Number(id)
): HymnNoteItem {
    return { id, title: `Song ${id}`, itemType: "song", sequence, match, notes };
}

/** The ids of these notes: notes the app wrote, as the write log says. */
function written(...notes: ItemNote[]): Set<string> {
    return new Set(notes.map(({ id }) => id));
}

/**
 * The one item's diff, with `owned` the notes the app wrote (none by
 * default, as when the write log has no record of them).
 */
function diffOf(
    item: HymnNoteItem,
    {
        owned = new Set<string>(),
        settings = SETTINGS,
        category = HYMNAL,
    }: { owned?: ReadonlySet<string>; settings?: HymnNoteSettings; category?: ItemNoteCategory } = {}
) {
    const [diff] = diffHymnNotes([item], category, settings, owned);
    return diff;
}

describe("formatHymnNote", () => {
    test("is the song's numbers, joined as the schedule text joins them", () => {
        expect(formatHymnNote(ST_ANNE, SETTINGS)).toBe("R-396 / G-317");
        expect(formatHymnNote(ST_ANNE, { ...SETTINGS, numberSeparator: ", " })).toBe("R-396, G-317");
    });

    test("names the tune after the numbers when the setting is on", () => {
        // A middle dot (U+00B7) between spaces.
        expect([...HYMN_NOTE_TUNE_SEPARATOR].map((c) => c.codePointAt(0))).toEqual([0x20, 0xb7, 0x20]);
        expect(formatHymnNote(ST_ANNE, WITH_TUNE)).toBe("R-396 / G-317 · ST. ANNE");
        expect(formatHymnNote({ ...ST_ANNE, tuneName: null }, WITH_TUNE)).toBe("R-396 / G-317");
        expect(formatHymnNote({ ...ST_ANNE, tuneName: "  " }, WITH_TUNE)).toBe("R-396 / G-317");
    });

    test("is null when there is nothing to say: no link, or no book, even with a tune", () => {
        expect(formatHymnNote(null, SETTINGS)).toBeNull();
        expect(formatHymnNote(undefined, SETTINGS)).toBeNull();
        expect(formatHymnNote(NO_BOOK, WITH_TUNE)).toBeNull();
    });

    test("leaves out a descant printed beside the hymn's own number, as the schedule text does", () => {
        const match: HymnNoteMatch = {
            tuneName: "O STORE GUD",
            entries: [
                { label: "R-28", variantNote: null },
                { label: "R-29", variantNote: "Descant - Last Chorus only" },
            ],
        };
        expect(formatHymnNote(match, SETTINGS)).toBe("R-28");
    });
});

describe("sameCategoryName and matchHymnNoteCategory", () => {
    test("names match without regard to case or whitespace", () => {
        expect(sameCategoryName("Hymnal", "hymnal")).toBe(true);
        expect(sameCategoryName("  Hymnal ", "HYMNAL")).toBe(true);
        expect(sameCategoryName("Hymn  Numbers", " hymn numbers")).toBe(true);
        expect(sameCategoryName("Hymnal", "Hymnals")).toBe(false);
        expect(sameCategoryName("Hymn Numbers", "HymnNumbers")).toBe(false);
    });

    const categories: ItemNoteCategory[] = [
        { id: "501", name: "Audio/Visual" },
        { id: "502", name: "Band" },
        { id: "503", name: "Hymnal" },
    ];

    test("finds the one category with the name", () => {
        expect(matchHymnNoteCategory(categories, " hymnal")).toEqual({
            status: "found",
            category: { id: "503", name: "Hymnal" },
        });
        expect(matchHymnNoteCategory(categories, "audio/visual")).toEqual({
            status: "found",
            category: { id: "501", name: "Audio/Visual" },
        });
    });

    test("says when the service type has none", () => {
        expect(matchHymnNoteCategory(categories, "Vocals")).toEqual({ status: "missing" });
        expect(matchHymnNoteCategory([], "Hymnal")).toEqual({ status: "missing" });
    });

    test("says when several have the name, whatever their case, and gives them all", () => {
        const twins = [...categories, { id: "777", name: " hymnal" }];
        expect(matchHymnNoteCategory(twins, "Hymnal")).toEqual({
            status: "ambiguous",
            categories: [
                { id: "503", name: "Hymnal" },
                { id: "777", name: " hymnal" },
            ],
        });
    });

    test("ambiguousCategoryMessage names the service type, the categories and the fix", () => {
        expect(
            ambiguousCategoryMessage("Hymnal", "Sunday Morning", [{ name: "Hymnal" }, { name: "hymnal" }])
        ).toBe(
            'Sunday Morning has 2 item note categories named "Hymnal" ("Hymnal" and "hymnal"), so the hymnal notes have no one place to go. Rename or delete all but one in Planning Center.'
        );
        expect(
            ambiguousCategoryMessage("Hymnal", "Sunday Evening", [{ name: "A" }, { name: "B" }, { name: "C" }])
        ).toContain('3 item note categories named "Hymnal" ("A", "B" and "C")');
    });
});

describe("diffHymnNotes", () => {
    test("create: a song with numbers and no hymnal note", () => {
        expect(diffOf(songItem("1", ST_ANNE))).toEqual({
            itemId: "1",
            title: "Song 1",
            sequence: 1,
            content: "R-396 / G-317",
            current: null,
            action: "create",
            changes: [{ kind: "create", content: "R-396 / G-317" }],
            keep: [],
        });
    });

    test("update: any hymnal note that says something else, the app's or not", () => {
        for (const owned of [true, false]) {
            const stale = note("R-12");
            expect(diffOf(songItem("1", ST_ANNE, [stale]), { owned: owned ? written(stale) : undefined })).toMatchObject({
                current: "R-12",
                action: "update",
                changes: [{ kind: "update", noteId: stale.id, from: "R-12", content: "R-396 / G-317" }],
                keep: [],
            });
        }
    });

    test("unchanged: a hymnal note that says what it should, spaces around it aside", () => {
        for (const content of ["R-396 / G-317", "  R-396 / G-317\n"]) {
            expect(diffOf(songItem("1", ST_ANNE, [note(content)]))).toMatchObject({
                action: "unchanged",
                changes: [],
                keep: [],
            });
        }
    });

    describe("a hymnal note on a song with nothing to say (not linked, or in no book)", () => {
        test("delete: the app's note goes", () => {
            for (const match of [null, NO_BOOK]) {
                const old = note("R-396");
                expect(diffOf(songItem("1", match, [old]), { owned: written(old) })).toEqual({
                    itemId: "1",
                    title: "Song 1",
                    sequence: 1,
                    content: null,
                    current: "R-396",
                    action: "delete",
                    changes: [{ kind: "delete", noteId: old.id, content: "R-396", reason: "nothing-to-say" }],
                    keep: [],
                });
            }
        });

        test("keep: a note the app did not write is left alone", () => {
            for (const match of [null, NO_BOOK]) {
                const typed = note("R-396 (verse 3 only)");
                expect(diffOf(songItem("1", match, [typed]))).toEqual({
                    itemId: "1",
                    title: "Song 1",
                    sequence: 1,
                    content: null,
                    current: "R-396 (verse 3 only)",
                    action: "keep",
                    changes: [],
                    keep: [
                        {
                            kind: "keep",
                            noteId: typed.id,
                            content: "R-396 (verse 3 only)",
                            reason: "nothing-to-say",
                        },
                    ],
                });
            }
        });

        test("of several, the app's go and the others stay", () => {
            const [typed, ours, more] = [note("R-1"), note("R-2"), note("R-3")];
            expect(diffOf(songItem("1", null, [typed, ours, more]), { owned: written(ours, more) })).toMatchObject({
                action: "delete",
                changes: [
                    { kind: "delete", noteId: ours.id, content: "R-2", reason: "nothing-to-say" },
                    { kind: "delete", noteId: more.id, content: "R-3", reason: "nothing-to-say" },
                ],
                keep: [{ kind: "keep", noteId: typed.id, content: "R-1", reason: "nothing-to-say" }],
            });
        });
    });

    describe("extra hymnal notes on one item", () => {
        test("dedupe: the app's extras go", () => {
            const [kept, extra, another] = [note("R-396 / G-317"), note("R-12"), note("R-396 / G-317")];
            expect(
                diffOf(songItem("1", ST_ANNE, [kept, extra, another]), { owned: written(kept, extra, another) })
            ).toMatchObject({
                current: "R-396 / G-317",
                action: "dedupe",
                changes: [
                    { kind: "delete", noteId: extra.id, content: "R-12", reason: "duplicate" },
                    { kind: "delete", noteId: another.id, content: "R-396 / G-317", reason: "duplicate" },
                ],
                keep: [],
            });
        });

        test("an extra the app did not write is left alone, so the item is unchanged", () => {
            const [ours, typed] = [note("R-396 / G-317"), note("Organ: intro only")];
            expect(diffOf(songItem("1", ST_ANNE, [ours, typed]), { owned: written(ours) })).toMatchObject({
                action: "unchanged",
                changes: [],
                keep: [{ kind: "keep", noteId: typed.id, content: "Organ: intro only", reason: "duplicate" }],
            });
        });

        test("update and dedupe: the note is updated, then the app's extras deleted and the others kept", () => {
            const [first, ours, typed] = [note("R-12"), note("R-13"), note("R-14")];
            expect(diffOf(songItem("1", ST_ANNE, [first, ours, typed]), { owned: written(first, ours) })).toMatchObject({
                action: "update",
                changes: [
                    { kind: "update", noteId: first.id, from: "R-12", content: "R-396 / G-317" },
                    { kind: "delete", noteId: ours.id, reason: "duplicate" },
                ],
                keep: [{ kind: "keep", noteId: typed.id, reason: "duplicate" }],
            });
        });
    });

    describe("the note brought in step", () => {
        test("is the first that already says what it should, so nothing is rewritten", () => {
            const [stale, right] = [note("R-1"), note("R-396 / G-317")];
            expect(diffOf(songItem("1", ST_ANNE, [stale, right]), { owned: written(stale) })).toMatchObject({
                current: "R-396 / G-317",
                action: "dedupe",
                changes: [{ kind: "delete", noteId: stale.id, content: "R-1", reason: "duplicate" }],
                keep: [],
            });
        });

        test("else the app's own, so a note typed by hand is not rewritten", () => {
            const [typed, ours] = [note("R-5 (verse 3 only)"), note("R-1")];
            expect(diffOf(songItem("1", ST_ANNE, [typed, ours]), { owned: written(ours) })).toMatchObject({
                current: "R-1",
                action: "update",
                changes: [{ kind: "update", noteId: ours.id, from: "R-1", content: "R-396 / G-317" }],
                keep: [{ kind: "keep", noteId: typed.id, reason: "duplicate" }],
            });
        });

        test("else the first, which the app takes over", () => {
            const [first, second] = [note("R-5"), note("R-6")];
            expect(diffOf(songItem("1", ST_ANNE, [first, second]))).toMatchObject({
                current: "R-5",
                action: "update",
                changes: [{ kind: "update", noteId: first.id, from: "R-5", content: "R-396 / G-317" }],
                keep: [{ kind: "keep", noteId: second.id, reason: "duplicate" }],
            });
        });
    });

    test("a write log that has lost track of the app's notes keeps them all, never deletes one", () => {
        // As after restoring an older database: the notes are the app's, but
        // the log does not say so.
        const items = [
            songItem("1", null, [note("R-1")]),
            songItem("2", ST_ANNE, [note("R-396 / G-317"), note("R-396 / G-317")]),
        ];
        const diffs = diffHymnNotes(items, HYMNAL, SETTINGS, new Set());
        expect(diffs.flatMap(({ changes }) => changes)).toEqual([]);
        expect(diffs.map(({ action, keep }) => [action, keep.length])).toEqual([
            ["keep", 1],
            ["unchanged", 1],
        ]);
    });

    test("none: nothing to say and no hymnal note", () => {
        for (const match of [null, NO_BOOK]) {
            expect(diffOf(songItem("1", match))).toMatchObject({
                content: null,
                current: null,
                action: "none",
                changes: [],
                keep: [],
            });
        }
    });

    test("never touches notes in other categories, even ones the app wrote", () => {
        const vocals = note("Women on verse 2", "Vocals", "502");
        const band = note("R-396 / G-317", "Band", "503");
        const owned = written(vocals, band);
        // The Band note says the numbers, but it is not a hymnal note.
        expect(diffOf(songItem("1", ST_ANNE, [vocals, band]), { owned })).toMatchObject({
            current: null,
            action: "create",
            changes: [{ kind: "create", content: "R-396 / G-317" }],
            keep: [],
        });
        expect(diffOf(songItem("2", null, [vocals]), { owned })).toMatchObject({
            action: "none",
            changes: [],
            keep: [],
        });
        const hymnal = note("R-12");
        const diff = diffOf(songItem("3", null, [vocals, hymnal, band]), { owned: written(vocals, hymnal, band) });
        expect(diff.changes.map((change) => change.kind === "delete" && change.noteId)).toEqual([hymnal.id]);
        expect(diff.keep).toEqual([]);
    });

    test("takes a note to be in the category by its category's id, whatever its name says", () => {
        const renamed = note("R-396 / G-317", "Hymnal (old name)", HYMNAL.id);
        expect(diffOf(songItem("1", ST_ANNE, [renamed])).action).toBe("unchanged");
    });

    test("never touches a note of another category with the same name, such as a deleted one", () => {
        // A deleted "Hymnal" category's notes keep its name; another category
        // spelled "hymnal" has its own id. Neither is the category's.
        const deleted = note("R-1", "Hymnal", "999");
        const twin = note("R-2", "hymnal", "777");
        const diff = diffOf(songItem("1", ST_ANNE, [deleted, twin]), { owned: written(deleted, twin) });
        expect(diff).toMatchObject({
            current: null,
            action: "create",
            changes: [{ kind: "create", content: "R-396 / G-317" }],
            keep: [],
        });
        expect(diffOf(songItem("2", null, [deleted, twin]), { owned: written(deleted, twin) })).toMatchObject({
            action: "none",
            changes: [],
            keep: [],
        });
    });

    test("matches by name, without regard to case or whitespace, only a note sent without a category id", () => {
        const odd = note("R-396 / G-317", "  hymnal ", null);
        expect(diffOf(songItem("1", ST_ANNE, [odd])).action).toBe("unchanged");
        expect(diffOf(songItem("1", ST_ANNE, [odd]), { category: { id: "501", name: " HYMNAL" } }).action).toBe(
            "unchanged"
        );
        expect(
            diffOf(songItem("1", ST_ANNE, [odd]), { category: { id: "601", name: "Hymn Numbers" } }).action
        ).toBe("create");
    });

    test("follows the settings: the tune turned on updates a note of numbers only", () => {
        const numbersOnly = note("R-396 / G-317");
        expect(diffOf(songItem("1", ST_ANNE, [numbersOnly]), { settings: WITH_TUNE })).toMatchObject({
            content: "R-396 / G-317 · ST. ANNE",
            action: "update",
        });
    });

    test("covers song items only, in sequence order", () => {
        const items: HymnNoteItem[] = [
            songItem("3", ST_ANNE, [], 3),
            { ...songItem("2", null, [note("R-1")], 2), itemType: "header" },
            songItem("1", null, [], 1),
        ];
        expect(diffHymnNotes(items, HYMNAL, SETTINGS, new Set()).map(({ itemId }) => itemId)).toEqual([
            "1",
            "3",
        ]);
    });

    test("does not change the items it is given", () => {
        const notes = [note("R-12"), note("R-13")];
        const items = [songItem("1", ST_ANNE, notes)];
        const before = JSON.stringify(items);
        diffHymnNotes(items, HYMNAL, SETTINGS, written(...notes));
        expect(JSON.stringify(items)).toBe(before);
    });
});

describe("songItemNoteIds", () => {
    test("lists the notes of song items, every category, each once", () => {
        const [a, b, c] = [note("R-1"), note("Solo", "Vocals"), note("R-2")];
        const items = [
            { itemType: "song", notes: [a, b] },
            { itemType: "header", notes: [c] },
            { itemType: "song", notes: [a] },
            { itemType: "song", notes: [] },
        ];
        expect(songItemNoteIds(items)).toEqual([a.id, b.id]);
    });
});

describe("hymnNoteItems", () => {
    test("gives each item the catalog song its Planning Center song is linked to, never by title", () => {
        const items = [
            { id: "1", title: "Song 1", itemType: "song", sequence: 1, songId: "77", notes: [] },
            { id: "2", title: "O God, Our Help", itemType: "song", sequence: 2, songId: "88", notes: [] },
            { id: "3", title: "Welcome", itemType: "header", sequence: 3, songId: null, notes: [] },
        ];
        expect(hymnNoteItems(items, { "77": ST_ANNE }).map(({ id, match }) => [id, match])).toEqual([
            ["1", ST_ANNE],
            ["2", null],
            ["3", null],
        ]);
    });
});

describe("summaries", () => {
    const ours = note("R-1");
    const extra = note("R-1");
    const typed = note("R-5 (verse 3 only)");
    const diffs = diffHymnNotes(
        [
            songItem("1", ST_ANNE),
            songItem("2", ST_ANNE, [note("R-1")]),
            songItem("3", ST_ANNE, [note("R-396 / G-317")]),
            songItem("4", null, [ours]),
            songItem("5", ST_ANNE, [note("R-396 / G-317"), extra]),
            songItem("6", null),
            songItem("7", ST_ANNE, [note("R-396 / G-317")]),
            songItem("8", null, [typed]),
        ],
        HYMNAL,
        SETTINGS,
        written(ours, extra)
    );

    test("countHymnNoteActions counts each action", () => {
        expect(countHymnNoteActions(diffs)).toEqual({
            create: 1,
            update: 1,
            unchanged: 2,
            delete: 1,
            dedupe: 1,
            keep: 1,
            none: 1,
        });
        expect(countHymnNoteActions([])).toEqual({
            create: 0,
            update: 0,
            unchanged: 0,
            delete: 0,
            dedupe: 0,
            keep: 0,
            none: 0,
        });
    });

    test("hymnNotesToSync keeps the items that need a write", () => {
        expect(hymnNotesToSync(diffs).map(({ itemId }) => itemId)).toEqual(["1", "2", "4", "5"]);
    });

    test("hymnNoteState says what a song card shows", () => {
        const states: Record<HymnNoteAction, string | null> = {
            create: "missing",
            update: "differs",
            unchanged: "in-sync",
            delete: "differs",
            dedupe: "differs",
            keep: null,
            none: null,
        };
        for (const [action, state] of Object.entries(states)) {
            expect([action, hymnNoteState({ action: action as HymnNoteAction })]).toEqual([action, state]);
        }
    });
});

describe("planHymnNoteStatus", () => {
    const hymnal: ItemNoteCategory = { id: "503", name: "Hymnal" };
    const input: PlanHymnNoteInput = {
        serviceTypeName: "Sunday Morning",
        items: [
            { id: "1", title: "O God, Our Help", itemType: "song", sequence: 1, songId: "77", notes: [] },
            { id: "2", title: "Welcome", itemType: "header", sequence: 2, songId: null, notes: [] },
        ],
        catalog: { "77": ST_ANNE },
        catalogError: null,
        categories: { ok: true, categories: [{ id: "501", name: "Band" }, hymnal] },
        settings: DEFAULT_SETTINGS,
        settingsError: null,
        ownedNoteIds: new Set(),
    };

    test("ready: the category, found by name, and each song item's diff", () => {
        expect(planHymnNoteStatus(input)).toEqual({
            kind: "ready",
            category: hymnal,
            items: [
                {
                    itemId: "1",
                    title: "O God, Our Help",
                    sequence: 1,
                    content: "R-396 / G-317",
                    current: null,
                    action: "create",
                    changes: [{ kind: "create", content: "R-396 / G-317" }],
                    keep: [],
                },
            ],
        });
    });

    test("deletes only the notes the app wrote", () => {
        const typed = note("R-1", "Hymnal", hymnal.id);
        const ours = note("R-2", "Hymnal", hymnal.id);
        const items = [
            { id: "3", title: "Not Linked", itemType: "song", sequence: 3, songId: "99", notes: [typed] },
            { id: "4", title: "Not Linked Either", itemType: "song", sequence: 4, songId: null, notes: [ours] },
        ];
        const status = planHymnNoteStatus({ ...input, items, ownedNoteIds: written(ours) });
        expect(status.kind === "ready" && status.items.map(({ action }) => action)).toEqual(["keep", "delete"]);
    });

    test("finds the category the settings name, without regard to case", () => {
        const status = planHymnNoteStatus({
            ...input,
            categories: { ok: true, categories: [{ id: "601", name: "hymn numbers" }] },
            settings: { ...DEFAULT_SETTINGS, hymnNoteCategoryName: "Hymn Numbers" },
        });
        expect(status).toMatchObject({ kind: "ready", category: { id: "601" } });
    });

    test("matches the notes to the category found by its id", () => {
        // Band's id is 501, the id `note` gives by default: a "Hymnal"-named
        // note there is Band's, not the Hymnal category's (503).
        const misfiled = note("R-1", "Hymnal", "501");
        const items = [
            { id: "1", title: "O God, Our Help", itemType: "song", sequence: 1, songId: "77", notes: [misfiled] },
        ];
        const status = planHymnNoteStatus({ ...input, items, ownedNoteIds: written(misfiled) });
        expect(status.kind === "ready" && status.items[0]).toMatchObject({
            action: "create",
            changes: [{ kind: "create", content: "R-396 / G-317" }],
        });
    });

    test("refuses, as unavailable, a service type with several categories of the name", () => {
        const twin = { id: "777", name: "hymnal" };
        expect(
            planHymnNoteStatus({
                ...input,
                categories: { ok: true, categories: [{ id: "501", name: "Band" }, hymnal, twin] },
            })
        ).toEqual({
            kind: "unavailable",
            reason: "ambiguous-category",
            message:
                'Sunday Morning has 2 item note categories named "Hymnal" ("Hymnal" and "hymnal"), so the hymnal notes have no one place to go. Rename or delete all but one in Planning Center.',
            categoryName: "Hymnal",
            categories: [hymnal, twin],
        });
    });

    test("no-category: asks for the category to be created in the service type", () => {
        expect(
            planHymnNoteStatus({ ...input, categories: { ok: true, categories: [{ id: "501", name: "Band" }] } })
        ).toEqual({
            kind: "no-category",
            categoryName: "Hymnal",
            message: 'Create an item note category named "Hymnal" in Planning Center for Sunday Morning.',
        });
        expect(missingCategoryMessage("Hymn Numbers", "Sunday Evening")).toBe(
            'Create an item note category named "Hymn Numbers" in Planning Center for Sunday Evening.'
        );
    });

    test("unavailable, before anything else, when the settings cannot be read", () => {
        // The defaults would look for "Hymnal" and leave the tune out, which
        // may not be what the church chose.
        const message =
            "The settings could not be read: Could not open the database. Hymnal notes can't be compared without them, since the category and what a note says are settings.";
        expect(planHymnNoteStatus({ ...input, settingsError: "Could not open the database" })).toEqual({
            kind: "unavailable",
            reason: "settings",
            message,
        });
        expect(
            planHymnNoteStatus({
                ...input,
                settingsError: "Could not open the database.",
                categories: { ok: true, categories: [] },
                catalogError: "Could not open the database.",
            })
        ).toEqual({ kind: "unavailable", reason: "settings", message });
    });

    test("unavailable when the categories cannot be read", () => {
        expect(
            planHymnNoteStatus({ ...input, categories: { ok: false, error: "Planning Center did not respond" } })
        ).toEqual({
            kind: "unavailable",
            reason: "categories",
            message:
                "Planning Center's item note categories could not be read: Planning Center did not respond. Hymnal notes can't be compared.",
        });
        expect(planHymnNoteStatus({ ...input, categories: { ok: false, error: " " } })).toMatchObject({
            message: "Planning Center's item note categories could not be read. Hymnal notes can't be compared.",
        });
    });

    test("unavailable when the catalog cannot be read, unless the category is missing", () => {
        const broken = { ...input, catalog: {}, catalogError: "Could not open the database." };
        expect(planHymnNoteStatus(broken)).toEqual({
            kind: "unavailable",
            reason: "catalog",
            message: "The catalog is unavailable: Could not open the database. Hymnal notes can't be compared.",
        });
        expect(
            planHymnNoteStatus({ ...broken, categories: { ok: true, categories: [] } })
        ).toMatchObject({ kind: "no-category" });
    });

    test("hymnNoteDiffFor finds an item's diff when the status is ready", () => {
        const status = planHymnNoteStatus(input);
        expect(hymnNoteDiffFor(status, "1")).toMatchObject({ itemId: "1", action: "create" });
        expect(hymnNoteDiffFor(status, "2")).toBeNull();
        expect(
            hymnNoteDiffFor(planHymnNoteStatus({ ...input, categories: { ok: true, categories: [] } }), "1")
        ).toBeNull();
    });
});
