import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// vi.hoisted is required: vi.mock is hoisted above const declarations.
const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    revalidatePath: vi.fn(),
    redirect: vi.fn((url: string) => {
        throw new Error(`NEXT_REDIRECT ${url}`);
    }),
    getCatalogSong: vi.fn(),
    markCatalogSong: vi.fn(),
    unmarkCatalogSong: vi.fn(),
    addCatalogEntry: vi.fn(),
    editCatalogEntry: vi.fn(),
    deleteCatalogEntry: vi.fn(),
    moveCatalogEntry: vi.fn(),
    editCatalogHymn: vi.fn(),
    addCatalogHymnAlias: vi.fn(),
    removeCatalogHymnAlias: vi.fn(),
    getHymnOptions: vi.fn(),
    previewCatalogHymnMerge: vi.fn(),
    mergeCatalogHymns: vi.fn(),
}));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({
    redirect: mocks.redirect,
    RedirectType: { push: "push", replace: "replace" },
}));
vi.mock("@/lib/queries/catalog", () => ({ getCatalogSong: mocks.getCatalogSong }));
vi.mock("@/lib/queries/marks", () => ({
    markCatalogSong: mocks.markCatalogSong,
    unmarkCatalogSong: mocks.unmarkCatalogSong,
}));
vi.mock("@/lib/queries/catalogEdit", () => ({
    addCatalogEntry: mocks.addCatalogEntry,
    editCatalogEntry: mocks.editCatalogEntry,
    deleteCatalogEntry: mocks.deleteCatalogEntry,
    moveCatalogEntry: mocks.moveCatalogEntry,
    editCatalogHymn: mocks.editCatalogHymn,
    addCatalogHymnAlias: mocks.addCatalogHymnAlias,
    removeCatalogHymnAlias: mocks.removeCatalogHymnAlias,
    getHymnOptions: mocks.getHymnOptions,
    previewCatalogHymnMerge: mocks.previewCatalogHymnMerge,
    mergeCatalogHymns: mocks.mergeCatalogHymns,
}));

import { FIX_MARKED_FIELDS_MESSAGE, STALE_PAGE_MESSAGE } from "@/lib/catalog/editForms";
import type { MergePreview } from "@/lib/catalog/merge";
import { MERGE_REFUSED_NOW_MESSAGE } from "@/lib/catalog/mergeText";
import { FORM_FAILURE_MESSAGE } from "@/lib/forms";
import {
    addEntryAction,
    addHymnAliasAction,
    deleteEntryAction,
    editEntryAction,
    editHymnAction,
    listHymnOptionsAction,
    markSongAction,
    mergeHymnsAction,
    moveEntryAction,
    previewHymnMergeAction,
    removeHymnAliasAction,
    unmarkSongAction,
} from "./editActions";

const SESSION = { user: { email: "someone@example.com" }, expires: "2026-11-03T12:00:00.000Z" };

/** A FormData of `fields`. */
function form(fields: Record<string, string>): FormData {
    const data = new FormData();
    for (const [name, value] of Object.entries(fields)) {
        data.set(name, value);
    }
    return data;
}

/** The three pages a change to songs, hymns or entries revalidates. */
function expectCatalogEditsRevalidated() {
    expect(mocks.revalidatePath.mock.calls).toEqual([
        ["/catalog", "layout"],
        ["/plans", "layout"],
        ["/"],
    ]);
}

beforeEach(() => {
    for (const mock of Object.values(mocks)) {
        mock.mockClear();
    }
    mocks.auth.mockResolvedValue(SESSION);
    vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe("every action", () => {
    const calls: [string, () => Promise<unknown>][] = [
        ["markSongAction", () => markSongAction(form({ songId: "42", mark: "to-learn" }))],
        ["unmarkSongAction", () => unmarkSongAction(form({ songId: "42", mark: "to-learn" }))],
        ["addEntryAction", () => addEntryAction(form({ songId: "42", bookId: "1", placement: "end" }))],
        ["editEntryAction", () => editEntryAction(form({ entryId: "7", placement: "end" }))],
        ["deleteEntryAction", () => deleteEntryAction(form({ entryId: "7" }))],
        ["moveEntryAction", () => moveEntryAction(form({ entryId: "7", direction: "up" }))],
        ["editHymnAction", () => editHymnAction(form({ hymnId: "5", title: "Amazing Grace" }))],
        ["addHymnAliasAction", () => addHymnAliasAction(form({ hymnId: "5", alias: "Grace" }))],
        ["removeHymnAliasAction", () => removeHymnAliasAction(form({ hymnId: "5", alias: "Grace" }))],
        ["listHymnOptionsAction", () => listHymnOptionsAction()],
        ["previewHymnMergeAction", () => previewHymnMergeAction(form({ sourceId: "5", targetId: "6" }))],
        ["mergeHymnsAction", () => mergeHymnsAction(form({ sourceId: "5", targetId: "6", songId: "42" }))],
    ];

    test.each(calls)("%s throws without a session, before it reads or writes anything", async (_name, call) => {
        mocks.auth.mockResolvedValue(null);
        await expect(call()).rejects.toThrow("Not signed in");
        for (const [name, mock] of Object.entries(mocks)) {
            if (name !== "auth") {
                expect(mock).not.toHaveBeenCalled();
            }
        }
    });
});

describe("markSongAction and unmarkSongAction", () => {
    test("marks the song with its note, and revalidates the catalog's pages", async () => {
        mocks.markCatalogSong.mockReturnValue({ ok: true, changed: true });
        const state = await markSongAction(form({ songId: "42", mark: "to-learn", note: "  For  Advent " }));
        expect(mocks.markCatalogSong).toHaveBeenCalledWith(42, "to-learn", "For Advent");
        expect(state).toEqual({
            status: "success",
            message: 'Marked to learn, with the note "For Advent".',
            values: { songId: "42", mark: "to-learn", note: "For Advent" },
        });
        expect(mocks.revalidatePath.mock.calls).toEqual([["/catalog", "layout"]]);
    });

    test("takes a blank note for none", async () => {
        mocks.markCatalogSong.mockReturnValue({ ok: true, changed: true });
        const state = await markSongAction(form({ songId: "42", mark: "to-learn", note: "  " }));
        expect(mocks.markCatalogSong).toHaveBeenCalledWith(42, "to-learn", null);
        expect(state).toMatchObject({ status: "success", message: "Marked to learn." });
    });

    test("marks a note that is too long, and says a song id that is not one as the form's message", async () => {
        const long = await markSongAction(form({ songId: "42", mark: "to-learn", note: "x".repeat(201) }));
        expect(long).toEqual({
            status: "error",
            message: FIX_MARKED_FIELDS_MESSAGE,
            fieldErrors: { note: { message: "A note has at most 200 characters." } },
            values: { songId: "42", mark: "to-learn", note: "x".repeat(201) },
        });
        const stale = await markSongAction(form({ songId: "abc", mark: "to-learn" }));
        expect(stale).toMatchObject({ status: "error", message: "That song is not in the catalog.", fieldErrors: {} });
        const unknown = await markSongAction(form({ songId: "42", mark: "favourite" }));
        expect(unknown).toMatchObject({ status: "error", message: "That is not a mark the catalog knows." });
        expect(mocks.markCatalogSong).not.toHaveBeenCalled();
        expect(mocks.revalidatePath).not.toHaveBeenCalled();
    });

    test("gives back the catalog's refusal, and logs a failure", async () => {
        mocks.markCatalogSong.mockReturnValueOnce({
            ok: false,
            reason: "song-not-found",
            message: "There is no such catalog song.",
        });
        expect(await markSongAction(form({ songId: "42", mark: "to-learn" }))).toMatchObject({
            status: "error",
            message: "There is no such catalog song.",
        });
        mocks.markCatalogSong.mockImplementationOnce(() => {
            throw new Error("disk I/O error");
        });
        expect(await markSongAction(form({ songId: "42", mark: "to-learn" }))).toMatchObject({
            status: "error",
            message: FORM_FAILURE_MESSAGE,
        });
        expect(console.error).toHaveBeenCalledOnce();
        expect(mocks.revalidatePath).not.toHaveBeenCalled();
    });

    test("unmarks the song, ignoring any note, and says when it was not marked", async () => {
        mocks.unmarkCatalogSong.mockReturnValueOnce({ ok: true, changed: true });
        expect(await unmarkSongAction(form({ songId: "42", mark: "to-learn" }))).toMatchObject({
            status: "success",
            message: "No longer marked to learn.",
            values: { note: "" },
        });
        expect(mocks.unmarkCatalogSong).toHaveBeenCalledWith(42, "to-learn");
        expect(mocks.revalidatePath.mock.calls).toEqual([["/catalog", "layout"]]);

        mocks.unmarkCatalogSong.mockReturnValueOnce({ ok: true, changed: false });
        expect(await unmarkSongAction(form({ songId: "42", mark: "to-learn" }))).toMatchObject({
            message: "The song was not marked to learn.",
        });
    });
});

/** A song as `getCatalogSong` reads it, with the entries a twin link is found in. */
const SONG = {
    id: 42,
    entries: [
        { id: 7, bookId: 1, songId: 42, number: 396, position: null, locationLabel: null, variantNote: null, bookCode: "R", label: "R-396" },
        { id: 8, bookId: 1, songId: 42, number: 397, position: null, locationLabel: null, variantNote: "Descant", bookCode: "R", label: "R-397" },
    ],
};

describe("addEntryAction", () => {
    const ADD = { songId: "42", bookId: "1", placement: "number", number: "396", variantNote: "" };

    test("adds the entry, revalidates every page that shows numbers, and reports it", async () => {
        mocks.addCatalogEntry.mockReturnValue({ ok: true, entryId: 9, label: "R-396" });
        const state = await addEntryAction(form(ADD));
        expect(mocks.addCatalogEntry).toHaveBeenCalledWith({
            songId: 42,
            bookId: 1,
            placement: { kind: "number", number: 396 },
            variantNote: null,
        });
        expect(state).toMatchObject({ status: "success", message: "Added R-396.", entryId: 9, label: "R-396" });
        expectCatalogEditsRevalidated();
    });

    test("marks what the reader refuses, and says a hidden id that is not one as the form's message", async () => {
        expect(await addEntryAction(form({ ...ADD, number: "0" }))).toMatchObject({
            status: "error",
            message: FIX_MARKED_FIELDS_MESSAGE,
            fieldErrors: { placement: { message: "Type the song's number, a whole number from 1 to 99,999." } },
            values: { number: "0" },
        });
        expect(await addEntryAction(form({ ...ADD, songId: "x" }))).toMatchObject({
            status: "error",
            message: "That song is not in the catalog.",
        });
        expect(mocks.addCatalogEntry).not.toHaveBeenCalled();
    });

    test("links a number that is taken to the song that has it", async () => {
        mocks.addCatalogEntry.mockReturnValue({
            ok: false,
            problems: [
                {
                    reason: "number-taken",
                    part: "placement",
                    message: 'R-396 is taken by "Holy, Holy, Holy (NICAEA)".',
                    existing: { kind: "song", songId: 9, label: "Holy, Holy, Holy (NICAEA)" },
                },
            ],
        });
        expect(await addEntryAction(form(ADD))).toMatchObject({
            status: "error",
            message: FIX_MARKED_FIELDS_MESSAGE,
            fieldErrors: {
                placement: {
                    message: 'R-396 is taken by "Holy, Holy, Holy (NICAEA)".',
                    link: { href: "/catalog/songs/9", label: "Holy, Holy, Holy (NICAEA)" },
                },
            },
        });
        expect(mocks.getCatalogSong).not.toHaveBeenCalled();
        expect(mocks.revalidatePath).not.toHaveBeenCalled();
    });

    test("links a second plain entry in the book to the song's entry there", async () => {
        mocks.addCatalogEntry.mockReturnValue({
            ok: false,
            problems: [
                {
                    reason: "song-already-in-book",
                    part: "variantNote",
                    message: "This song is already in Rejoice Hymns as R-396.",
                    existing: null,
                },
            ],
        });
        mocks.getCatalogSong.mockReturnValue(SONG);
        expect(await addEntryAction(form({ ...ADD, number: "500" }))).toMatchObject({
            fieldErrors: {
                variantNote: {
                    message: "This song is already in Rejoice Hymns as R-396.",
                    link: { href: "/catalog/books/R", label: "R-396" },
                },
            },
        });
        expect(mocks.getCatalogSong).toHaveBeenCalledWith(42);

        // Reading the song fails: the message stands alone, and the failure is logged.
        mocks.getCatalogSong.mockImplementation(() => {
            throw new Error("disk I/O error");
        });
        const state = await addEntryAction(form({ ...ADD, number: "500" }));
        expect(state).toMatchObject({
            fieldErrors: { variantNote: { message: "This song is already in Rejoice Hymns as R-396." } },
        });
        expect(state.status === "error" && state.fieldErrors.variantNote?.link).toBeUndefined();
        expect(console.error).toHaveBeenCalledOnce();
    });

    test("logs a failure and says nothing changed", async () => {
        mocks.addCatalogEntry.mockImplementation(() => {
            throw new Error("disk I/O error");
        });
        expect(await addEntryAction(form(ADD))).toMatchObject({ status: "error", message: FORM_FAILURE_MESSAGE });
        expect(console.error).toHaveBeenCalledOnce();
        expect(mocks.revalidatePath).not.toHaveBeenCalled();
    });
});

describe("editEntryAction", () => {
    test("saves the entry and reports its label", async () => {
        mocks.editCatalogEntry.mockReturnValue({ ok: true, entryId: 7, label: "R-395" });
        const state = await editEntryAction(
            form({ songId: "42", entryId: "7", placement: "number", number: "395", variantNote: "" })
        );
        expect(mocks.editCatalogEntry).toHaveBeenCalledWith({
            entryId: 7,
            placement: { kind: "number", number: 395 },
            variantNote: null,
        });
        expect(state).toMatchObject({ status: "success", message: "Saved R-395.", entryId: 7, label: "R-395" });
        expectCatalogEditsRevalidated();
    });

    test("links a clashing variant note to the song's other entry in the entry's book", async () => {
        mocks.editCatalogEntry.mockReturnValue({
            ok: false,
            problems: [
                {
                    reason: "song-already-in-book",
                    part: "variantNote",
                    message: 'This song is already in Rejoice Hymns as R-397 with the variant note "Descant".',
                    existing: null,
                },
            ],
        });
        mocks.getCatalogSong.mockReturnValue(SONG);
        const state = await editEntryAction(
            form({ songId: "42", entryId: "7", placement: "number", number: "396", variantNote: "Descant" })
        );
        expect(state).toMatchObject({
            fieldErrors: { variantNote: { link: { href: "/catalog/books/R", label: "R-397" } } },
        });
    });

    test("says an entry that is gone as the form's message", async () => {
        mocks.editCatalogEntry.mockReturnValue({
            ok: false,
            problems: [
                {
                    reason: "entry-not-found",
                    part: "entry",
                    message: "That entry is not in the catalog. It may have been deleted.",
                    existing: null,
                },
            ],
        });
        expect(
            await editEntryAction(form({ songId: "42", entryId: "7", placement: "number", number: "396" }))
        ).toMatchObject({
            status: "error",
            message: "That entry is not in the catalog. It may have been deleted.",
            fieldErrors: {},
        });
    });
});

describe("deleteEntryAction", () => {
    test("deletes the entry and reports the label it had", async () => {
        mocks.deleteCatalogEntry.mockReturnValue({ ok: true, songId: 42, label: "R-396" });
        expect(await deleteEntryAction(form({ entryId: "7" }))).toMatchObject({
            status: "success",
            label: "R-396",
        });
        expect(mocks.deleteCatalogEntry).toHaveBeenCalledWith(7);
        expectCatalogEditsRevalidated();
    });

    test("gives back an entry already gone, or an id that is not one, with its message", async () => {
        mocks.deleteCatalogEntry.mockReturnValue({
            ok: false,
            problems: [{ reason: "entry-not-found", part: "entry", message: "That entry is not in the catalog.", existing: null }],
        });
        expect(await deleteEntryAction(form({ entryId: "7" }))).toMatchObject({
            status: "error",
            message: "That entry is not in the catalog.",
        });
        expect(await deleteEntryAction(form({ entryId: "7.5" }))).toMatchObject({
            status: "error",
            message: "That entry is not in the catalog.",
        });
        expect(mocks.deleteCatalogEntry).toHaveBeenCalledOnce();
        expect(mocks.revalidatePath).not.toHaveBeenCalled();
    });
});

describe("moveEntryAction", () => {
    test("moves the entry and revalidates, or leaves it at the edge and revalidates nothing", async () => {
        mocks.moveCatalogEntry.mockReturnValueOnce({ ok: true, changed: true, position: 2 });
        expect(await moveEntryAction(form({ entryId: "7", direction: "up" }))).toMatchObject({
            status: "success",
            changed: true,
            position: 2,
        });
        expect(mocks.moveCatalogEntry).toHaveBeenCalledWith(7, "up");
        expectCatalogEditsRevalidated();

        mocks.revalidatePath.mockClear();
        mocks.moveCatalogEntry.mockReturnValueOnce({ ok: true, changed: false, position: 1 });
        expect(await moveEntryAction(form({ entryId: "7", direction: "up" }))).toMatchObject({
            status: "success",
            changed: false,
            position: 1,
        });
        expect(mocks.revalidatePath).not.toHaveBeenCalled();
    });

    test("refuses a direction it does not know, and an entry of a numbered book", async () => {
        expect(await moveEntryAction(form({ entryId: "7", direction: "sideways" }))).toMatchObject({
            status: "error",
            message: "Choose Move up or Move down.",
        });
        mocks.moveCatalogEntry.mockReturnValue({
            ok: false,
            problems: [
                {
                    reason: "entry-not-placed",
                    part: "placement",
                    message: "Rejoice Hymns numbers its songs: change the entry's number instead.",
                    existing: null,
                },
            ],
        });
        expect(await moveEntryAction(form({ entryId: "7", direction: "down" }))).toMatchObject({
            status: "error",
            message: "Rejoice Hymns numbers its songs: change the entry's number instead.",
        });
    });
});

describe("editHymnAction", () => {
    test("saves what was cleaned, and says what the rename did to the other titles", async () => {
        mocks.editCatalogHymn.mockReturnValue({ ok: true, hymnId: 5, aliasKept: "Amazing Grace!", aliasDropped: null });
        const state = await editHymnAction(
            form({ hymnId: "5", title: "  Amazing   Grace ", firstLine: "", notes: " Sing slowly. \r\n" })
        );
        expect(mocks.editCatalogHymn).toHaveBeenCalledWith({
            hymnId: 5,
            title: "Amazing Grace",
            firstLine: null,
            notes: "Sing slowly.",
        });
        expect(state).toEqual({
            status: "success",
            message: 'Saved. "Amazing Grace!" stays as another title, since a Planning Center song is still titled so.',
            values: { hymnId: "5", title: "Amazing Grace", firstLine: "", notes: "Sing slowly." },
        });
        expectCatalogEditsRevalidated();
    });

    test("marks a blank title, and links a title another hymn has to that hymn's song", async () => {
        expect(await editHymnAction(form({ hymnId: "5", title: " " }))).toMatchObject({
            status: "error",
            fieldErrors: { title: { message: "Type the hymn's title." } },
        });
        mocks.editCatalogHymn.mockReturnValue({
            ok: false,
            problems: [
                {
                    reason: "name-taken",
                    part: "title",
                    message: 'The catalog already has a hymn titled "Amazing Grace".',
                    existing: { kind: "song", songId: 11, label: "Amazing Grace (NEW BRITAIN)" },
                },
            ],
        });
        expect(await editHymnAction(form({ hymnId: "5", title: "Amazing Grace" }))).toMatchObject({
            status: "error",
            message: FIX_MARKED_FIELDS_MESSAGE,
            fieldErrors: {
                title: { link: { href: "/catalog/songs/11", label: "Amazing Grace (NEW BRITAIN)" } },
            },
        });
    });
});

describe("addHymnAliasAction and removeHymnAliasAction", () => {
    test("adds another title, and empties the field", async () => {
        mocks.addCatalogHymnAlias.mockReturnValue({ ok: true, alias: "Grace" });
        expect(await addHymnAliasAction(form({ hymnId: "5", alias: " Grace " }))).toEqual({
            status: "success",
            message: 'Added "Grace" as another title.',
            values: { hymnId: "5", alias: "" },
        });
        expect(mocks.addCatalogHymnAlias).toHaveBeenCalledWith({ hymnId: 5, alias: "Grace" });
        expectCatalogEditsRevalidated();
    });

    test("marks a title another hymn has on the field", async () => {
        mocks.addCatalogHymnAlias.mockReturnValue({
            ok: false,
            problems: [
                {
                    reason: "name-taken",
                    part: "alias",
                    message: '"Grace" is another title of "Amazing Grace".',
                    existing: { kind: "song", songId: 11, label: "Amazing Grace (NEW BRITAIN)" },
                },
            ],
        });
        expect(await addHymnAliasAction(form({ hymnId: "5", alias: "Grace" }))).toMatchObject({
            status: "error",
            fieldErrors: { alias: { link: { href: "/catalog/songs/11" } } },
        });
    });

    test("removes another title, and says a refusal as the form's message", async () => {
        mocks.removeCatalogHymnAlias.mockReturnValueOnce({ ok: true, alias: "Grace" });
        expect(await removeHymnAliasAction(form({ hymnId: "5", alias: "Grace" }))).toMatchObject({
            status: "success",
            message: 'Removed "Grace".',
        });
        mocks.removeCatalogHymnAlias.mockReturnValueOnce({
            ok: false,
            problems: [
                {
                    reason: "alias-not-found",
                    part: "alias",
                    message: '"Grace" is not another title of this hymn. It may have been removed already.',
                    existing: null,
                },
            ],
        });
        expect(await removeHymnAliasAction(form({ hymnId: "5", alias: "Grace" }))).toMatchObject({
            status: "error",
            message: '"Grace" is not another title of this hymn. It may have been removed already.',
            fieldErrors: {},
        });
    });
});

describe("listHymnOptionsAction", () => {
    test("gives every hymn to choose from, or says they could not be read", async () => {
        const options = [{ id: 6, title: "Rejoice, the Lord Is King", aliases: [], tunes: ["DARWALL"] }];
        mocks.getHymnOptions.mockReturnValueOnce(options);
        expect(await listHymnOptionsAction()).toEqual({ ok: true, options });
        mocks.getHymnOptions.mockImplementationOnce(() => {
            throw new Error("disk I/O error");
        });
        expect(await listHymnOptionsAction()).toMatchObject({ ok: false });
        expect(console.error).toHaveBeenCalledOnce();
        expect(mocks.revalidatePath).not.toHaveBeenCalled();
    });
});

/** A plan of merging hymn 5 into hymn 6: song 42 merges into 61, and song 43 moves. */
function preview(overrides: Partial<MergePreview> = {}): MergePreview {
    return {
        kind: "hymn",
        source: { id: 5, name: "Rejoice - the Lord Is King" },
        target: { id: 6, name: "Rejoice, the Lord Is King" },
        moves: [{ songId: 43, from: "A (GOPSAL)", to: "B (GOPSAL)", entries: [] }],
        merges: [
            {
                sourceSongId: 42,
                targetSongId: 61,
                source: "A (DARWALL)",
                target: "B (DARWALL)",
                entries: [],
                marks: [],
                notes: false,
                link: null,
            },
        ],
        aliasesAdded: [],
        detailTaken: null,
        notesAdded: false,
        refusals: [],
        ...overrides,
    };
}

describe("previewHymnMergeAction", () => {
    test("gives back the plan, writing and revalidating nothing", async () => {
        mocks.previewCatalogHymnMerge.mockReturnValue({ ok: true, preview: preview() });
        expect(await previewHymnMergeAction(form({ sourceId: "5", targetId: "6" }))).toEqual({
            ok: true,
            preview: preview(),
        });
        expect(mocks.previewCatalogHymnMerge).toHaveBeenCalledWith(5, 6);
        expect(mocks.mergeCatalogHymns).not.toHaveBeenCalled();
        expect(mocks.revalidatePath).not.toHaveBeenCalled();
    });

    test("asks for a target, and says a hymn that is gone", async () => {
        expect(await previewHymnMergeAction(form({ sourceId: "5", targetId: "" }))).toEqual({
            ok: false,
            message: "Choose the hymn to merge it into.",
        });
        mocks.previewCatalogHymnMerge.mockReturnValue({
            ok: false,
            reason: "target-not-found",
            message: "The hymn to merge into is not in the catalog. Choose another.",
        });
        expect(await previewHymnMergeAction(form({ sourceId: "5", targetId: "6" }))).toEqual({
            ok: false,
            message: "The hymn to merge into is not in the catalog. Choose another.",
        });
    });
});

describe("mergeHymnsAction", () => {
    test("merges, revalidates, and replaces the page with the song the page's song merged into", async () => {
        mocks.mergeCatalogHymns.mockReturnValue({ ok: true, preview: preview() });
        await expect(mergeHymnsAction(form({ sourceId: "5", targetId: "6", songId: "42" }))).rejects.toThrow(
            "NEXT_REDIRECT /catalog/songs/61"
        );
        expect(mocks.mergeCatalogHymns).toHaveBeenCalledWith(5, 6);
        expectCatalogEditsRevalidated();
        expect(mocks.redirect).toHaveBeenCalledWith("/catalog/songs/61", "replace");
    });

    test("lands on the page's own song when it moved", async () => {
        mocks.mergeCatalogHymns.mockReturnValue({ ok: true, preview: preview() });
        await expect(mergeHymnsAction(form({ sourceId: "5", targetId: "6", songId: "43" }))).rejects.toThrow(
            "NEXT_REDIRECT /catalog/songs/43"
        );
    });

    test("gives back a merge refused as it is written, with its plan, writing nothing", async () => {
        const refused = preview({
            refusals: [{ reason: "linked-apart", message: "Linked to different Planning Center songs.", songIds: [42, 61] }],
        });
        mocks.mergeCatalogHymns.mockReturnValue({ ok: false, reason: "refused", preview: refused });
        expect(await mergeHymnsAction(form({ sourceId: "5", targetId: "6", songId: "42" }))).toEqual({
            ok: false,
            message: MERGE_REFUSED_NOW_MESSAGE,
            preview: refused,
        });
        expect(mocks.revalidatePath).not.toHaveBeenCalled();
        expect(mocks.redirect).not.toHaveBeenCalled();
    });

    test("says a hymn that is gone, a page song that is not an id, and a failure", async () => {
        mocks.mergeCatalogHymns.mockReturnValueOnce({
            ok: false,
            reason: "source-not-found",
            message: "That hymn is not in the catalog. It may have been merged already.",
        });
        expect(await mergeHymnsAction(form({ sourceId: "5", targetId: "6", songId: "42" }))).toEqual({
            ok: false,
            message: "That hymn is not in the catalog. It may have been merged already.",
            preview: null,
        });
        expect(await mergeHymnsAction(form({ sourceId: "5", targetId: "6", songId: "x" }))).toEqual({
            ok: false,
            message: STALE_PAGE_MESSAGE,
            preview: null,
        });
        mocks.mergeCatalogHymns.mockImplementationOnce(() => {
            throw new Error("disk I/O error");
        });
        expect(await mergeHymnsAction(form({ sourceId: "5", targetId: "6", songId: "42" }))).toEqual({
            ok: false,
            message: FORM_FAILURE_MESSAGE,
            preview: null,
        });
        expect(console.error).toHaveBeenCalledOnce();
        expect(mocks.mergeCatalogHymns).toHaveBeenCalledTimes(2);
        expect(mocks.redirect).not.toHaveBeenCalled();
    });
});
