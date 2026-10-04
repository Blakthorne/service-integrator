import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// vi.hoisted is required: vi.mock is hoisted above const declarations.
const { auth, revalidatePath, linkCatalogSong, saveSelection } = vi.hoisted(() => ({
    auth: vi.fn(),
    revalidatePath: vi.fn(),
    linkCatalogSong: vi.fn(),
    saveSelection: vi.fn(),
}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/queries/reconcile", () => ({ linkCatalogSong }));
// The real module's messages, with only the write mocked.
vi.mock("@/lib/queries/selections", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/queries/selections")>()),
    saveScheduleSelection: saveSelection,
}));

import { SELECTION_NOT_SAVED_MESSAGE } from "@/lib/queries/selections";
import { linkPcoSong, saveScheduleSelection } from "./actions";

const SESSION = {
    user: { email: "someone@example.com" },
    expires: "2026-11-03T12:00:00.000Z",
};

const ST = "1405391";
const PLAN = "81234567";
const PCO_SONG = "26000001";
const SONG = "42";
const ITEM = "91000001";

/** A refusal as linkCatalogSong returns it. */
const SONG_LINKED = {
    ok: false,
    reason: "song-linked",
    message:
        '"Abide with Me (EVENTIDE)" is already linked to the Planning Center song "Abide with Me". Undo that link first.',
};

beforeEach(() => {
    for (const mock of [auth, revalidatePath, linkCatalogSong, saveSelection]) {
        mock.mockReset();
    }
    auth.mockResolvedValue(SESSION);
    linkCatalogSong.mockResolvedValue({ ok: true, changed: true });
    saveSelection.mockReturnValue({ ok: true });
    vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
});

/** The action called with the four ids, any of which `overrides` replaces with something else. */
function link(
    overrides: Partial<Record<"serviceTypeId" | "planId" | "pcoSongId" | "songId", unknown>> = {}
) {
    const ids = { serviceTypeId: ST, planId: PLAN, pcoSongId: PCO_SONG, songId: SONG, ...overrides };
    // An action's arguments come from the network, so they may be anything.
    return linkPcoSong(
        ids.serviceTypeId as string,
        ids.planId as string,
        ids.pcoSongId as string,
        ids.songId as string
    );
}

describe("linkPcoSong", () => {
    test("throws without a session, before it links anything", async () => {
        auth.mockResolvedValue(null);

        await expect(link()).rejects.toThrow("Not signed in");
        expect(linkCatalogSong).not.toHaveBeenCalled();
        expect(revalidatePath).not.toHaveBeenCalled();
    });

    test("links the songs, then revalidates the plan's pages and the catalog's", async () => {
        await expect(link()).resolves.toEqual({ ok: true });

        expect(auth).toHaveBeenCalledTimes(1);
        expect(linkCatalogSong).toHaveBeenCalledTimes(1);
        expect(linkCatalogSong).toHaveBeenCalledWith(42, PCO_SONG);
        expect(revalidatePath.mock.calls).toEqual([
            [`/plans/${ST}/${PLAN}`, "layout"],
            ["/catalog", "layout"],
        ]);
    });

    test("revalidates when the two were already linked, so a tab that is out of date catches up", async () => {
        linkCatalogSong.mockResolvedValue({ ok: true, changed: false });

        await expect(link()).resolves.toEqual({ ok: true });
        expect(revalidatePath.mock.calls).toEqual([
            [`/plans/${ST}/${PLAN}`, "layout"],
            ["/catalog", "layout"],
        ]);
    });

    test.each([
        ["service type", "serviceTypeId"],
        ["plan", "planId"],
        ["Planning Center song", "pcoSongId"],
        ["catalog song", "songId"],
    ] as const)("refuses a %s id that is not one, without linking anything", async (_name, field) => {
        for (const value of [
            "",
            "abc",
            "0",
            "01",
            "-1",
            "1.5",
            " 1",
            "../1",
            "1/2",
            "12345678901234567890123",
            42,
            null,
            undefined,
            { id: "1" },
            ["1"],
        ]) {
            await expect(link({ [field]: value })).resolves.toEqual({
                ok: false,
                message: expect.stringContaining("Reload"),
            });
        }
        expect(linkCatalogSong).not.toHaveBeenCalled();
        expect(revalidatePath).not.toHaveBeenCalled();
    });

    test("returns a refusal's message as it is, and changes no page", async () => {
        linkCatalogSong.mockResolvedValue(SONG_LINKED);

        await expect(link()).resolves.toEqual({ ok: false, message: SONG_LINKED.message });
        expect(linkCatalogSong).toHaveBeenCalledWith(42, PCO_SONG);
        expect(revalidatePath).not.toHaveBeenCalled();
    });

    test("returns a message, and logs the cause, when linking throws", async () => {
        const cause = new Error("Could not open the database at /srv/data/x: denied");
        linkCatalogSong.mockRejectedValue(cause);

        await expect(link()).resolves.toEqual({
            ok: false,
            message: expect.stringContaining("nothing was linked"),
        });
        expect(console.error).toHaveBeenCalledWith(
            `Failed to link Planning Center song ${PCO_SONG} to catalog song 42:`,
            cause
        );
        expect(revalidatePath).not.toHaveBeenCalled();
    });
});

/** The save action called with its three ids, any of which `overrides` replaces, and a choice. */
function save(
    overrides: Partial<Record<"serviceTypeId" | "planId" | "itemId", unknown>> = {},
    option: unknown = "numbers",
    customText?: unknown
) {
    const ids = { serviceTypeId: ST, planId: PLAN, itemId: ITEM, ...overrides };
    // An action's arguments come from the network, so they may be anything.
    return saveScheduleSelection(
        ids.serviceTypeId as string,
        ids.planId as string,
        ids.itemId as string,
        option as "numbers",
        customText as string | undefined
    );
}

describe("saveScheduleSelection", () => {
    test("throws without a session, before it saves anything", async () => {
        auth.mockResolvedValue(null);

        await expect(save()).rejects.toThrow("Not signed in");
        expect(saveSelection).not.toHaveBeenCalled();
    });

    test("saves the choice for the plan's item, and revalidates nothing", async () => {
        await expect(save({}, "blank")).resolves.toEqual({ ok: true });

        expect(auth).toHaveBeenCalledTimes(1);
        expect(saveSelection).toHaveBeenCalledTimes(1);
        expect(saveSelection).toHaveBeenCalledWith(PLAN, ITEM, "blank", undefined);
        expect(revalidatePath).not.toHaveBeenCalled();
    });

    test("passes Custom's text on as it was typed", async () => {
        await expect(save({}, "custom", "  last verse only ")).resolves.toEqual({ ok: true });

        expect(saveSelection).toHaveBeenCalledWith(PLAN, ITEM, "custom", "  last verse only ");
    });

    test.each([
        ["service type", "serviceTypeId"],
        ["plan", "planId"],
        ["item", "itemId"],
    ] as const)("refuses a %s id that is not one, without saving anything", async (_name, field) => {
        for (const value of ["", "abc", "0", "01", "-1", " 1", "../1", "1/2", 42, null, undefined, ["1"]]) {
            await expect(save({ [field]: value })).resolves.toEqual({
                ok: false,
                message: SELECTION_NOT_SAVED_MESSAGE,
            });
        }
        expect(saveSelection).not.toHaveBeenCalled();
    });

    test("returns a refusal of the option or the text as it is", async () => {
        const refusal = { ok: false, message: "Custom text is at most 500 characters." };
        saveSelection.mockReturnValue(refusal);

        await expect(save({}, "custom", "x".repeat(501))).resolves.toEqual(refusal);
        // The query checks the option and the text, so they reach it as sent.
        await save({}, "verse 2", { text: "x" });
        expect(saveSelection).toHaveBeenLastCalledWith(PLAN, ITEM, "verse 2", { text: "x" });
    });

    test("returns a message, and logs the cause, when the database cannot be written", async () => {
        const cause = new Error("database is locked");
        saveSelection.mockImplementation(() => {
            throw cause;
        });

        await expect(save()).resolves.toEqual({
            ok: false,
            message: "The database could not be written.",
        });
        expect(console.error).toHaveBeenCalledWith(
            `Failed to save the Schedule tab's choice for plan ${ST}/${PLAN} item ${ITEM}:`,
            cause
        );
    });
});
