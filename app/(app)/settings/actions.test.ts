import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// vi.hoisted is required: vi.mock is hoisted above const declarations.
const { auth, revalidatePath, syncPcoSongsNow } = vi.hoisted(() => ({
    auth: vi.fn(),
    revalidatePath: vi.fn(),
    syncPcoSongsNow: vi.fn(),
}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/queries/reconcile", () => ({ syncPcoSongsNow }));

import { FORM_FAILURE_MESSAGE } from "@/lib/forms";
import { syncPcoSongsAction } from "./actions";

const SESSION = {
    user: { email: "someone@example.com" },
    expires: "2026-11-03T12:00:00.000Z",
};

/** A finished run of the song sync, as syncPcoSongsNow gives it. */
function run(ok: boolean, message: string | null) {
    return {
        id: 7,
        kind: "pco-songs",
        startedAt: "2026-10-04T12:00:00.000Z",
        finishedAt: "2026-10-04T12:00:05.000Z",
        ok,
        message,
        counts: null,
    };
}

/** The pages a sync revalidates. */
const SYNC_PAGES = [["/settings"], ["/catalog", "layout"], ["/plans", "layout"]];

beforeEach(() => {
    for (const mock of [auth, revalidatePath, syncPcoSongsNow]) {
        mock.mockReset();
    }
    auth.mockResolvedValue(SESSION);
    vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe("syncPcoSongsAction", () => {
    test("throws without a session, before it syncs", async () => {
        auth.mockResolvedValue(null);

        await expect(syncPcoSongsAction()).rejects.toThrow("Not signed in");
        expect(syncPcoSongsNow).not.toHaveBeenCalled();
        expect(revalidatePath).not.toHaveBeenCalled();
    });

    test("syncs, gives the run's message and revalidates the pages it changes", async () => {
        syncPcoSongsNow.mockResolvedValue(run(true, "Synced 397 songs: 5 auto-linked"));

        await expect(syncPcoSongsAction()).resolves.toEqual({
            ok: true,
            message: "Synced 397 songs: 5 auto-linked",
        });
        expect(syncPcoSongsNow).toHaveBeenCalledTimes(1);
        expect(revalidatePath.mock.calls).toEqual(SYNC_PAGES);
    });

    test("says why a sync failed, and still revalidates, since the run is recorded", async () => {
        syncPcoSongsNow.mockResolvedValue(run(false, "PCO request failed (status: 500)"));

        await expect(syncPcoSongsAction()).resolves.toEqual({
            ok: false,
            message: "The sync failed: PCO request failed (status: 500).",
        });
        expect(revalidatePath.mock.calls).toEqual(SYNC_PAGES);
    });

    test("words a run without a message", async () => {
        syncPcoSongsNow.mockResolvedValue(run(true, null));
        await expect(syncPcoSongsAction()).resolves.toEqual({ ok: true, message: "Synced." });

        syncPcoSongsNow.mockResolvedValue(run(false, null));
        await expect(syncPcoSongsAction()).resolves.toEqual({
            ok: false,
            message: "The sync failed: no reason was recorded.",
        });
    });

    test("returns a message, and logs the cause, when the database cannot be opened", async () => {
        const cause = new Error("Could not open the database");
        syncPcoSongsNow.mockRejectedValue(cause);

        await expect(syncPcoSongsAction()).resolves.toEqual({
            ok: false,
            message: FORM_FAILURE_MESSAGE,
        });
        expect(console.error).toHaveBeenCalledWith(
            "Failed to sync the Planning Center songs:",
            cause
        );
        expect(revalidatePath).not.toHaveBeenCalled();
    });

    test("returns a message when no run was recorded", async () => {
        syncPcoSongsNow.mockResolvedValue(null);

        await expect(syncPcoSongsAction()).resolves.toEqual({
            ok: false,
            message: FORM_FAILURE_MESSAGE,
        });
    });
});
