import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// vi.hoisted is required: vi.mock is hoisted above const declarations.
const { auth, revalidatePath, requestCreditLabels, cancelCreditLabels } = vi.hoisted(() => ({
    auth: vi.fn(),
    revalidatePath: vi.fn(),
    requestCreditLabels: vi.fn(),
    cancelCreditLabels: vi.fn(),
}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/queries/credits", () => ({ requestCreditLabels, cancelCreditLabels }));

import { FORM_FAILURE_MESSAGE } from "@/lib/forms";
import { cancelCreditLabelsAction, requestCreditLabelsAction } from "./actions";

const SESSION = {
    user: { email: "someone@example.com" },
    expires: "2026-11-03T12:00:00.000Z",
};

const LABEL = { pcoSongId: "1001", shownAuthor: "Fanny Crosby", author: "Words & Music: Fanny Crosby" };

beforeEach(() => {
    auth.mockResolvedValue(SESSION);
});

afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
});

describe("requestCreditLabelsAction", () => {
    test("throws without a session, before anything is read", async () => {
        auth.mockResolvedValue(null);
        await expect(requestCreditLabelsAction([LABEL])).rejects.toThrow("Not signed in");
        expect(requestCreditLabels).not.toHaveBeenCalled();
    });

    test("queues the labels, revalidates the page and says what it did", async () => {
        requestCreditLabels.mockReturnValue({ queued: 1, waiting: 0, changed: 0 });
        await expect(requestCreditLabelsAction([LABEL])).resolves.toEqual({
            ok: true,
            message: "1 label will be written to Planning Center, a few a second. This page shows how it goes.",
        });
        expect(requestCreditLabels).toHaveBeenCalledWith([LABEL]);
        expect(revalidatePath).toHaveBeenCalledWith("/catalog/credits");
    });

    test("says so when every song chosen changed since the page loaded", async () => {
        requestCreditLabels.mockReturnValue({ queued: 0, waiting: 0, changed: 2 });
        await expect(requestCreditLabelsAction([LABEL, LABEL])).resolves.toMatchObject({
            ok: false,
            message: expect.stringMatching(/^2 songs changed since this page loaded/),
        });
        expect(revalidatePath).toHaveBeenCalledWith("/catalog/credits");
    });

    test("answers what is not a list of labels with a message, asking for nothing", async () => {
        for (const sent of [null, [], [{ ...LABEL, pcoSongId: "../1" }], [{ ...LABEL, author: "" }], "1001"]) {
            await expect(requestCreditLabelsAction(sent)).resolves.toEqual({
                ok: false,
                message: "This page asked for labels that cannot be written. Reload it and try again.",
            });
        }
        expect(requestCreditLabels).not.toHaveBeenCalled();
        expect(revalidatePath).not.toHaveBeenCalled();
    });

    test("logs a failure and says something went wrong", async () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        requestCreditLabels.mockImplementation(() => {
            throw new Error("database is locked");
        });
        await expect(requestCreditLabelsAction([LABEL])).resolves.toEqual({
            ok: false,
            message: FORM_FAILURE_MESSAGE,
        });
        expect(consoleError).toHaveBeenCalled();
        expect(revalidatePath).not.toHaveBeenCalled();
    });
});

describe("cancelCreditLabelsAction", () => {
    test("throws without a session", async () => {
        auth.mockResolvedValue(null);
        await expect(cancelCreditLabelsAction()).rejects.toThrow("Not signed in");
        expect(cancelCreditLabels).not.toHaveBeenCalled();
    });

    test("stops the labels that wait, revalidates the page and says how many", async () => {
        cancelCreditLabels.mockReturnValue(3);
        await expect(cancelCreditLabelsAction()).resolves.toEqual({
            ok: true,
            message: "Stopped 3 labels: they were not written.",
        });
        expect(revalidatePath).toHaveBeenCalledWith("/catalog/credits");
    });

    test("logs a failure and says something went wrong", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        cancelCreditLabels.mockImplementation(() => {
            throw new Error("database is locked");
        });
        await expect(cancelCreditLabelsAction()).resolves.toEqual({ ok: false, message: FORM_FAILURE_MESSAGE });
    });
});
