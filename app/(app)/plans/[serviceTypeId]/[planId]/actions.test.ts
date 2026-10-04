import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// vi.hoisted is required: vi.mock is hoisted above const declarations.
const { auth, revalidatePath, linkCatalogSong } = vi.hoisted(() => ({
    auth: vi.fn(),
    revalidatePath: vi.fn(),
    linkCatalogSong: vi.fn(),
}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/queries/reconcile", () => ({ linkCatalogSong }));

import { linkPcoSong } from "./actions";

const SESSION = {
    user: { email: "someone@example.com" },
    expires: "2026-11-03T12:00:00.000Z",
};

const ST = "1405391";
const PLAN = "81234567";
const PCO_SONG = "26000001";
const SONG = "42";

/** A refusal as linkCatalogSong returns it. */
const SONG_LINKED = {
    ok: false,
    reason: "song-linked",
    message:
        '"Abide with Me (EVENTIDE)" is already linked to the Planning Center song "Abide with Me". Undo that link first.',
};

beforeEach(() => {
    for (const mock of [auth, revalidatePath, linkCatalogSong]) {
        mock.mockReset();
    }
    auth.mockResolvedValue(SESSION);
    linkCatalogSong.mockResolvedValue({ ok: true, changed: true });
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

    test("links the songs, then revalidates the plan's pages", async () => {
        await expect(link()).resolves.toEqual({ ok: true });

        expect(auth).toHaveBeenCalledTimes(1);
        expect(linkCatalogSong).toHaveBeenCalledTimes(1);
        expect(linkCatalogSong).toHaveBeenCalledWith(42, PCO_SONG);
        expect(revalidatePath).toHaveBeenCalledTimes(1);
        expect(revalidatePath).toHaveBeenCalledWith(`/plans/${ST}/${PLAN}`, "layout");
    });

    test("revalidates when the two were already linked, so a tab that is out of date catches up", async () => {
        linkCatalogSong.mockResolvedValue({ ok: true, changed: false });

        await expect(link()).resolves.toEqual({ ok: true });
        expect(revalidatePath).toHaveBeenCalledWith(`/plans/${ST}/${PLAN}`, "layout");
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
