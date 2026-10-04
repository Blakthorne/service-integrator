import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// vi.hoisted is required: vi.mock is hoisted above const declarations.
const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    revalidatePath: vi.fn(),
    redirect: vi.fn((url: string) => {
        throw new Error(`NEXT_REDIRECT ${url}`);
    }),
    editCatalogTune: vi.fn(),
    addCatalogTuneAlias: vi.fn(),
    removeCatalogTuneAlias: vi.fn(),
    getTuneOptions: vi.fn(),
    previewCatalogTuneMerge: vi.fn(),
    mergeCatalogTunes: vi.fn(),
}));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({
    redirect: mocks.redirect,
    RedirectType: { push: "push", replace: "replace" },
}));
vi.mock("@/lib/queries/catalogEdit", () => ({
    editCatalogTune: mocks.editCatalogTune,
    addCatalogTuneAlias: mocks.addCatalogTuneAlias,
    removeCatalogTuneAlias: mocks.removeCatalogTuneAlias,
    getTuneOptions: mocks.getTuneOptions,
    previewCatalogTuneMerge: mocks.previewCatalogTuneMerge,
    mergeCatalogTunes: mocks.mergeCatalogTunes,
}));

import { FIX_MARKED_FIELDS_MESSAGE } from "@/lib/catalog/editForms";
import type { MergePreview } from "@/lib/catalog/merge";
import { MERGE_REFUSED_NOW_MESSAGE } from "@/lib/catalog/mergeText";
import { FORM_FAILURE_MESSAGE } from "@/lib/forms";
import {
    addTuneAliasAction,
    editTuneAction,
    listTuneOptionsAction,
    mergeTunesAction,
    previewTuneMergeAction,
    removeTuneAliasAction,
} from "./actions";

const SESSION = { user: { email: "someone@example.com" }, expires: "2026-11-03T12:00:00.000Z" };

function form(fields: Record<string, string>): FormData {
    const data = new FormData();
    for (const [name, value] of Object.entries(fields)) {
        data.set(name, value);
    }
    return data;
}

function expectTuneEditsRevalidated() {
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
        ["editTuneAction", () => editTuneAction(form({ tuneId: "10", name: "DARWALL" }))],
        ["addTuneAliasAction", () => addTuneAliasAction(form({ tuneId: "10", alias: "DARWAL" }))],
        ["removeTuneAliasAction", () => removeTuneAliasAction(form({ tuneId: "10", alias: "DARWAL" }))],
        ["listTuneOptionsAction", () => listTuneOptionsAction()],
        ["previewTuneMergeAction", () => previewTuneMergeAction(form({ sourceId: "10", targetId: "11" }))],
        ["mergeTunesAction", () => mergeTunesAction(form({ sourceId: "10", targetId: "11" }))],
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

describe("editTuneAction", () => {
    test("saves what was cleaned, revalidates, and says what the rename did to the other names", async () => {
        mocks.editCatalogTune.mockReturnValue({ ok: true, tuneId: 10, aliasKept: null, aliasDropped: "DARWALL" });
        const state = await editTuneAction(form({ tuneId: "10", name: " DARWALL ", meter: "6.6.6.6.8.8", notes: "" }));
        expect(mocks.editCatalogTune).toHaveBeenCalledWith({
            tuneId: 10,
            name: "DARWALL",
            meter: "6.6.6.6.8.8",
            notes: null,
        });
        expect(state).toEqual({
            status: "success",
            message: "Saved. DARWALL is no longer another name: it is the name now.",
            values: { tuneId: "10", name: "DARWALL", meter: "6.6.6.6.8.8", notes: "" },
        });
        expectTuneEditsRevalidated();
    });

    test("marks a blank name, says a tune id that is not one, and links a name another tune has", async () => {
        expect(await editTuneAction(form({ tuneId: "10", name: "" }))).toMatchObject({
            status: "error",
            message: FIX_MARKED_FIELDS_MESSAGE,
            fieldErrors: { name: { message: "Type the tune's name." } },
        });
        expect(await editTuneAction(form({ tuneId: "ten", name: "DARWALL" }))).toMatchObject({
            status: "error",
            message: "That tune is not in the catalog.",
            fieldErrors: {},
        });
        mocks.editCatalogTune.mockReturnValue({
            ok: false,
            problems: [
                {
                    reason: "name-taken",
                    part: "name",
                    message: "The catalog already has the tune DARWALL.",
                    existing: { kind: "tune", tuneId: 11, label: "DARWALL" },
                },
            ],
        });
        expect(await editTuneAction(form({ tuneId: "10", name: "DARWALL" }))).toMatchObject({
            fieldErrors: { name: { link: { href: "/catalog/tunes/11", label: "DARWALL" } } },
        });
        expect(mocks.revalidatePath).not.toHaveBeenCalled();
    });

    test("logs a failure and says nothing changed", async () => {
        mocks.editCatalogTune.mockImplementation(() => {
            throw new Error("disk I/O error");
        });
        expect(await editTuneAction(form({ tuneId: "10", name: "DARWALL" }))).toMatchObject({
            status: "error",
            message: FORM_FAILURE_MESSAGE,
        });
        expect(console.error).toHaveBeenCalledOnce();
    });
});

describe("addTuneAliasAction and removeTuneAliasAction", () => {
    test("adds another name and empties the field, and removes one", async () => {
        mocks.addCatalogTuneAlias.mockReturnValue({ ok: true, alias: "DARWAL" });
        expect(await addTuneAliasAction(form({ tuneId: "10", alias: "DARWAL" }))).toEqual({
            status: "success",
            message: "Added DARWAL as another name.",
            values: { tuneId: "10", alias: "" },
        });
        expectTuneEditsRevalidated();
        mocks.removeCatalogTuneAlias.mockReturnValue({ ok: true, alias: "DARWAL" });
        expect(await removeTuneAliasAction(form({ tuneId: "10", alias: "DARWAL" }))).toMatchObject({
            status: "success",
            message: "Removed DARWAL.",
        });
        expect(mocks.removeCatalogTuneAlias).toHaveBeenCalledWith({ tuneId: 10, alias: "DARWAL" });
    });

    test("marks a name that is the tune's own on the field", async () => {
        mocks.addCatalogTuneAlias.mockReturnValue({
            ok: false,
            problems: [{ reason: "alias-is-name", part: "alias", message: "DARWALL is the tune's name.", existing: null }],
        });
        expect(await addTuneAliasAction(form({ tuneId: "10", alias: "DARWALL" }))).toMatchObject({
            status: "error",
            message: FIX_MARKED_FIELDS_MESSAGE,
            fieldErrors: { alias: { message: "DARWALL is the tune's name." } },
        });
    });
});

describe("listTuneOptionsAction", () => {
    test("gives every tune to choose from, or says they could not be read", async () => {
        const options = [{ id: 11, name: "DARWALL", aliases: [], meter: null }];
        mocks.getTuneOptions.mockReturnValueOnce(options);
        expect(await listTuneOptionsAction()).toEqual({ ok: true, options });
        mocks.getTuneOptions.mockImplementationOnce(() => {
            throw new Error("disk I/O error");
        });
        expect(await listTuneOptionsAction()).toMatchObject({ ok: false });
        expect(console.error).toHaveBeenCalledOnce();
    });
});

function preview(overrides: Partial<MergePreview> = {}): MergePreview {
    return {
        kind: "tune",
        source: { id: 10, name: "DARWAL" },
        target: { id: 11, name: "DARWALL" },
        moves: [{ songId: 301, from: "A (DARWAL)", to: "A (DARWALL)", entries: [] }],
        merges: [],
        aliasesAdded: ["DARWAL"],
        detailTaken: null,
        notesAdded: false,
        refusals: [],
        ...overrides,
    };
}

describe("previewTuneMergeAction", () => {
    test("gives back the plan, and asks for a target", async () => {
        mocks.previewCatalogTuneMerge.mockReturnValue({ ok: true, preview: preview() });
        expect(await previewTuneMergeAction(form({ sourceId: "10", targetId: "11" }))).toEqual({
            ok: true,
            preview: preview(),
        });
        expect(mocks.previewCatalogTuneMerge).toHaveBeenCalledWith(10, 11);
        expect(await previewTuneMergeAction(form({ sourceId: "10" }))).toEqual({
            ok: false,
            message: "Choose the tune to merge it into.",
        });
        expect(mocks.revalidatePath).not.toHaveBeenCalled();
    });
});

describe("mergeTunesAction", () => {
    test("merges, revalidates, and replaces the page with the target tune's", async () => {
        mocks.mergeCatalogTunes.mockReturnValue({ ok: true, preview: preview() });
        await expect(mergeTunesAction(form({ sourceId: "10", targetId: "11" }))).rejects.toThrow(
            "NEXT_REDIRECT /catalog/tunes/11"
        );
        expect(mocks.mergeCatalogTunes).toHaveBeenCalledWith(10, 11);
        expectTuneEditsRevalidated();
        expect(mocks.redirect).toHaveBeenCalledWith("/catalog/tunes/11", "replace");
    });

    test("gives back a refused merge with its plan, a tune that is gone, and a failure", async () => {
        const refused = preview({
            refusals: [{ reason: "entry-collision", message: "Would be in Rejoice Hymns twice.", songIds: [301, 401] }],
        });
        mocks.mergeCatalogTunes.mockReturnValueOnce({ ok: false, reason: "refused", preview: refused });
        expect(await mergeTunesAction(form({ sourceId: "10", targetId: "11" }))).toEqual({
            ok: false,
            message: MERGE_REFUSED_NOW_MESSAGE,
            preview: refused,
        });
        mocks.mergeCatalogTunes.mockReturnValueOnce({
            ok: false,
            reason: "target-not-found",
            message: "The tune to merge into is not in the catalog. Choose another.",
        });
        expect(await mergeTunesAction(form({ sourceId: "10", targetId: "11" }))).toEqual({
            ok: false,
            message: "The tune to merge into is not in the catalog. Choose another.",
            preview: null,
        });
        mocks.mergeCatalogTunes.mockImplementationOnce(() => {
            throw new Error("disk I/O error");
        });
        expect(await mergeTunesAction(form({ sourceId: "10", targetId: "11" }))).toEqual({
            ok: false,
            message: FORM_FAILURE_MESSAGE,
            preview: null,
        });
        expect(console.error).toHaveBeenCalledOnce();
        expect(mocks.revalidatePath).not.toHaveBeenCalled();
        expect(mocks.redirect).not.toHaveBeenCalled();
    });
});
