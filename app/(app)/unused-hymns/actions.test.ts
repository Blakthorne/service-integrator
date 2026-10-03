import { beforeEach, describe, expect, test, vi } from "vitest";
import type { UnusedHymnsResult } from "@/lib/unusedHymns";

// vi.hoisted is required: vi.mock is hoisted above const declarations.
const { auth, getUnusedHymns } = vi.hoisted(() => ({
    auth: vi.fn(),
    getUnusedHymns: vi.fn(),
}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/queries/unusedHymns", () => ({ getUnusedHymns }));

import { refreshUnusedHymns } from "./actions";

const refreshed: UnusedHymnsResult = {
    unused: [],
    review: [],
    meta: {
        songsScanned: 0,
        usedTitleCount: 0,
        computedAt: "2026-10-03T12:00:00.000Z",
        totals: { rejoice: 0, greatHymns: 0 },
    },
};

beforeEach(() => {
    auth.mockReset();
    getUnusedHymns.mockReset();
    getUnusedHymns.mockResolvedValue(refreshed);
});

describe("refreshUnusedHymns", () => {
    test("throws without a session, and never reaches Planning Center", async () => {
        auth.mockResolvedValue(null);

        await expect(refreshUnusedHymns()).rejects.toThrow("Not signed in");
        expect(getUnusedHymns).not.toHaveBeenCalled();
    });

    test("with a session, recomputes the result and returns it", async () => {
        auth.mockResolvedValue({
            user: { email: "someone@example.com" },
            expires: "2026-11-03T12:00:00.000Z",
        });

        await expect(refreshUnusedHymns()).resolves.toBe(refreshed);
        expect(getUnusedHymns).toHaveBeenCalledTimes(1);
        expect(getUnusedHymns).toHaveBeenCalledWith({ refresh: true });
    });

    test("lets a failed refresh through, for the caller to handle", async () => {
        auth.mockResolvedValue({ user: {}, expires: "2026-11-03T12:00:00.000Z" });
        getUnusedHymns.mockRejectedValue(new Error("PCO down"));

        await expect(refreshUnusedHymns()).rejects.toThrow("PCO down");
    });
});
