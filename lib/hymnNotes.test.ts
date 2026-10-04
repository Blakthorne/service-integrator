import { describe, expect, test } from "vitest";
import type { ItemNote, ItemNoteCategory } from "./domain";
import {
    HYMN_NOTE_TUNE_SEPARATOR,
    countHymnNoteActions,
    diffHymnNotes,
    findHymnNoteCategory,
    formatHymnNote,
    hymnNoteDiffFor,
    hymnNoteItems,
    hymnNoteState,
    hymnNotesToSync,
    missingCategoryMessage,
    planHymnNoteStatus,
    sameCategoryName,
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

/** The one item's diff. */
function diffOf(item: HymnNoteItem, settings = SETTINGS, categoryName = "Hymnal") {
    const [diff] = diffHymnNotes([item], categoryName, settings);
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

describe("sameCategoryName and findHymnNoteCategory", () => {
    test("names match without regard to case or whitespace", () => {
        expect(sameCategoryName("Hymnal", "hymnal")).toBe(true);
        expect(sameCategoryName("  Hymnal ", "HYMNAL")).toBe(true);
        expect(sameCategoryName("Hymn  Numbers", " hymn numbers")).toBe(true);
        expect(sameCategoryName("Hymnal", "Hymnals")).toBe(false);
        expect(sameCategoryName("Hymn Numbers", "HymnNumbers")).toBe(false);
    });

    const categories: ItemNoteCategory[] = [
        { id: "501", name: "Audio/Visual" },
        { id: "502", name: " hymnal" },
        { id: "503", name: "Hymnal" },
    ];

    test("finds the first category with the name", () => {
        expect(findHymnNoteCategory(categories, "Hymnal")).toEqual({ id: "502", name: " hymnal" });
        expect(findHymnNoteCategory(categories, "audio/visual")).toEqual({ id: "501", name: "Audio/Visual" });
    });

    test("is null when the service type has none", () => {
        expect(findHymnNoteCategory(categories, "Band")).toBeNull();
        expect(findHymnNoteCategory([], "Hymnal")).toBeNull();
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
        });
    });

    test("update: a hymnal note that says something else", () => {
        const stale = note("R-12");
        expect(diffOf(songItem("1", ST_ANNE, [stale]))).toMatchObject({
            current: "R-12",
            action: "update",
            changes: [{ kind: "update", noteId: stale.id, from: "R-12", content: "R-396 / G-317" }],
        });
    });

    test("unchanged: a hymnal note that says what it should, spaces around it aside", () => {
        for (const content of ["R-396 / G-317", "  R-396 / G-317\n"]) {
            expect(diffOf(songItem("1", ST_ANNE, [note(content)]))).toMatchObject({
                action: "unchanged",
                changes: [],
            });
        }
    });

    test("delete: a hymnal note on a song that is not linked, or is in no book", () => {
        for (const match of [null, NO_BOOK]) {
            const old = note("R-396");
            expect(diffOf(songItem("1", match, [old]))).toEqual({
                itemId: "1",
                title: "Song 1",
                sequence: 1,
                content: null,
                current: "R-396",
                action: "delete",
                changes: [{ kind: "delete", noteId: old.id, content: "R-396", reason: "nothing-to-say" }],
            });
        }
    });

    test("delete removes every hymnal note of an item with nothing to say", () => {
        const [first, second] = [note("R-1"), note("R-2")];
        expect(diffOf(songItem("1", null, [first, second])).changes).toEqual([
            { kind: "delete", noteId: first.id, content: "R-1", reason: "nothing-to-say" },
            { kind: "delete", noteId: second.id, content: "R-2", reason: "nothing-to-say" },
        ]);
    });

    test("dedupe: keeps the first hymnal note and deletes the rest", () => {
        const [kept, extra, another] = [note("R-396 / G-317"), note("R-12"), note("R-396 / G-317")];
        expect(diffOf(songItem("1", ST_ANNE, [kept, extra, another]))).toMatchObject({
            current: "R-396 / G-317",
            action: "dedupe",
            changes: [
                { kind: "delete", noteId: extra.id, content: "R-12", reason: "duplicate" },
                { kind: "delete", noteId: another.id, content: "R-396 / G-317", reason: "duplicate" },
            ],
        });
    });

    test("update and dedupe: the first note is updated, then the extras deleted", () => {
        const [kept, extra] = [note("R-12"), note("R-396 / G-317")];
        expect(diffOf(songItem("1", ST_ANNE, [kept, extra]))).toMatchObject({
            action: "update",
            changes: [
                { kind: "update", noteId: kept.id, from: "R-12", content: "R-396 / G-317" },
                { kind: "delete", noteId: extra.id, reason: "duplicate" },
            ],
        });
    });

    test("none: nothing to say and no hymnal note", () => {
        for (const match of [null, NO_BOOK]) {
            expect(diffOf(songItem("1", match))).toMatchObject({
                content: null,
                current: null,
                action: "none",
                changes: [],
            });
        }
    });

    test("never touches notes in other categories", () => {
        const vocals = note("Women on verse 2", "Vocals", "502");
        const band = note("R-396 / G-317", "Band", "503");
        // The Band note says the numbers, but it is not a hymnal note.
        expect(diffOf(songItem("1", ST_ANNE, [vocals, band]))).toMatchObject({
            current: null,
            action: "create",
            changes: [{ kind: "create", content: "R-396 / G-317" }],
        });
        expect(diffOf(songItem("2", null, [vocals]))).toMatchObject({ action: "none", changes: [] });
        const hymnal = note("R-12");
        const changes = diffOf(songItem("3", null, [vocals, hymnal, band])).changes;
        expect(changes.map((change) => change.kind === "delete" && change.noteId)).toEqual([hymnal.id]);
    });

    test("matches the category's name without regard to case or whitespace", () => {
        const odd = note("R-396 / G-317", "  hymnal ");
        expect(diffOf(songItem("1", ST_ANNE, [odd]), SETTINGS, "Hymnal").action).toBe("unchanged");
        const other = note("R-396 / G-317", "Hymnal");
        expect(diffOf(songItem("1", ST_ANNE, [other]), SETTINGS, " HYMNAL").action).toBe("unchanged");
        expect(diffOf(songItem("1", ST_ANNE, [other]), SETTINGS, "Hymn Numbers").action).toBe("create");
    });

    test("follows the settings: the tune turned on updates a note of numbers only", () => {
        const numbersOnly = note("R-396 / G-317");
        expect(diffOf(songItem("1", ST_ANNE, [numbersOnly]), WITH_TUNE)).toMatchObject({
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
        expect(diffHymnNotes(items, "Hymnal", SETTINGS).map(({ itemId }) => itemId)).toEqual(["1", "3"]);
    });

    test("does not change the items it is given", () => {
        const items = [songItem("1", ST_ANNE, [note("R-12"), note("R-13")])];
        const before = JSON.stringify(items);
        diffHymnNotes(items, "Hymnal", SETTINGS);
        expect(JSON.stringify(items)).toBe(before);
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
    const diffs = diffHymnNotes(
        [
            songItem("1", ST_ANNE),
            songItem("2", ST_ANNE, [note("R-1")]),
            songItem("3", ST_ANNE, [note("R-396 / G-317")]),
            songItem("4", null, [note("R-1")]),
            songItem("5", ST_ANNE, [note("R-396 / G-317"), note("R-1")]),
            songItem("6", null),
            songItem("7", ST_ANNE, [note("R-396 / G-317")]),
        ],
        "Hymnal",
        SETTINGS
    );

    test("countHymnNoteActions counts each action", () => {
        expect(countHymnNoteActions(diffs)).toEqual({
            create: 1,
            update: 1,
            unchanged: 2,
            delete: 1,
            dedupe: 1,
            none: 1,
        });
        expect(countHymnNoteActions([])).toEqual({
            create: 0,
            update: 0,
            unchanged: 0,
            delete: 0,
            dedupe: 0,
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
                },
            ],
        });
    });

    test("finds the category the settings name, without regard to case", () => {
        const status = planHymnNoteStatus({
            ...input,
            categories: { ok: true, categories: [{ id: "601", name: "hymn numbers" }] },
            settings: { ...DEFAULT_SETTINGS, hymnNoteCategoryName: "Hymn Numbers" },
        });
        expect(status).toMatchObject({ kind: "ready", category: { id: "601" } });
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
