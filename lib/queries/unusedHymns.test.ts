import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { PcoSong } from "@/lib/unusedHymns";

// vi.hoisted is required: vi.mock is hoisted above const declarations, so the
// mock fn must be created inside hoisted() to exist when the factory runs.
const { fetchAllSongs } = vi.hoisted(() => ({ fetchAllSongs: vi.fn() }));
vi.mock("@/lib/pco", () => ({ fetchAllSongs }));

const HOUR_MS = 60 * 60 * 1000;

const sampleSongs: PcoSong[] = [
    { title: "Amazing Grace", lastScheduledAt: "2025-01-01T00:00:00Z" },
];

// Where the module keeps its cache: see sharedCache in unusedHymns.ts.
const CACHE_GLOBAL = "__unusedHymnsCache";

/** Another copy of the module, which shares whatever cache is already in place. */
async function loadAnotherCopy() {
    vi.resetModules();
    return import("./unusedHymns");
}

/** A fresh copy of the module with an empty cache, so each test starts clean. */
async function loadQueries() {
    delete (globalThis as unknown as Record<string, unknown>)[CACHE_GLOBAL];
    return loadAnotherCopy();
}

beforeEach(() => {
    // Only Date is faked, so promises and timers behave normally.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-03T12:00:00.000Z"));
    fetchAllSongs.mockReset();
    fetchAllSongs.mockResolvedValue(sampleSongs);
});

afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
});

describe("getUnusedHymns", () => {
    test("returns a result with the expected shape", async () => {
        const { getUnusedHymns } = await loadQueries();
        const result = await getUnusedHymns();
        expect(result).toHaveProperty("unused");
        expect(result).toHaveProperty("review");
        expect(result.meta).toHaveProperty("computedAt");
        expect(result.meta.totals).toHaveProperty("rejoice");
        expect(fetchAllSongs).toHaveBeenCalledTimes(1);
    });

    test("computes it from the hymn catalog and the PCO songs", async () => {
        const { getUnusedHymns } = await loadQueries();
        const result = await getUnusedHymns();
        // "Amazing Grace" is a hymnbook title that PCO has scheduled: it is
        // used, so it is not listed, but the rest of the catalog still is.
        expect(result.unused.map((hymn) => hymn.songTitle)).not.toContain(
            "Amazing Grace"
        );
        expect(result.unused.length).toBeGreaterThan(100);
        expect(result.meta.songsScanned).toBe(1);
        expect(result.meta.computedAt).toBe("2026-10-03T12:00:00.000Z");
    });

    test("serves the second call from the cache (no re-fetch)", async () => {
        const { getUnusedHymns } = await loadQueries();
        const first = await getUnusedHymns();
        const second = await getUnusedHymns();
        expect(second).toBe(first);
        expect(fetchAllSongs).toHaveBeenCalledTimes(1);
    });

    test("recomputes once the one-hour TTL has passed", async () => {
        const { getUnusedHymns } = await loadQueries();
        await getUnusedHymns();

        vi.setSystemTime(Date.now() + HOUR_MS - 1);
        await getUnusedHymns();
        expect(fetchAllSongs).toHaveBeenCalledTimes(1);

        vi.setSystemTime(Date.now() + 1);
        const refreshed = await getUnusedHymns();
        expect(fetchAllSongs).toHaveBeenCalledTimes(2);
        expect(refreshed.meta.computedAt).toBe("2026-10-03T13:00:00.000Z");
    });

    test("concurrent calls share one fetch", async () => {
        const { getUnusedHymns } = await loadQueries();
        const [first, second] = await Promise.all([
            getUnusedHymns(),
            getUnusedHymns(),
        ]);
        expect(second).toBe(first);
        expect(fetchAllSongs).toHaveBeenCalledTimes(1);
    });

    test("refresh: true busts the cache", async () => {
        const { getUnusedHymns } = await loadQueries();
        await getUnusedHymns();
        await getUnusedHymns({ refresh: true });
        expect(fetchAllSongs).toHaveBeenCalledTimes(2);
    });

    test("a refreshed result is what later calls get", async () => {
        const { getUnusedHymns } = await loadQueries();
        const before = await getUnusedHymns();
        expect(before.unused.map((hymn) => hymn.songTitle)).not.toContain(
            "Amazing Grace"
        );

        // PCO no longer reports the song as scheduled.
        fetchAllSongs.mockResolvedValue([
            { title: "Amazing Grace", lastScheduledAt: null },
        ]);
        vi.setSystemTime(Date.now() + 1000);
        const refreshed = await getUnusedHymns({ refresh: true });
        const later = await getUnusedHymns();

        expect(refreshed.unused.map((hymn) => hymn.songTitle)).toContain(
            "Amazing Grace"
        );
        expect(refreshed.meta.computedAt).toBe("2026-10-03T12:00:01.000Z");
        expect(later).toBe(refreshed);
        expect(fetchAllSongs).toHaveBeenCalledTimes(2);
    });

    test("copies of the module share one cache, as the page and the refresh action do", async () => {
        // Next compiles a server action that a client component imports in its
        // own module layer, so the page and the action each load this module.
        const page = await loadQueries();
        const action = await loadAnotherCopy();
        expect(action).not.toBe(page);

        const first = await page.getUnusedHymns();
        await expect(action.getUnusedHymns()).resolves.toBe(first);
        expect(fetchAllSongs).toHaveBeenCalledTimes(1);

        // What the action refreshes is what the page then serves.
        fetchAllSongs.mockResolvedValue([
            { title: "Amazing Grace", lastScheduledAt: null },
        ]);
        vi.setSystemTime(Date.now() + 1000);
        const refreshed = await action.getUnusedHymns({ refresh: true });
        expect(refreshed).not.toBe(first);
        await expect(page.getUnusedHymns()).resolves.toBe(refreshed);
        expect(fetchAllSongs).toHaveBeenCalledTimes(2);
    });

    test("refresh: false is the same as no options", async () => {
        const { getUnusedHymns } = await loadQueries();
        await getUnusedHymns();
        await getUnusedHymns({ refresh: false });
        await getUnusedHymns({});
        expect(fetchAllSongs).toHaveBeenCalledTimes(1);
    });

    test("propagates a failure without caching it, so the next call retries", async () => {
        fetchAllSongs.mockRejectedValueOnce(new Error("boom"));
        const { getUnusedHymns } = await loadQueries();

        await expect(getUnusedHymns()).rejects.toThrow("boom");
        const result = await getUnusedHymns();

        expect(result.meta.songsScanned).toBe(1);
        expect(fetchAllSongs).toHaveBeenCalledTimes(2);
    });

    test("propagates a failure from a refresh, and the next call retries", async () => {
        const { getUnusedHymns } = await loadQueries();
        await getUnusedHymns();

        fetchAllSongs.mockRejectedValueOnce(new Error("PCO down"));
        await expect(getUnusedHymns({ refresh: true })).rejects.toThrow(
            "PCO down"
        );

        await expect(getUnusedHymns()).resolves.toHaveProperty("unused");
        expect(fetchAllSongs).toHaveBeenCalledTimes(3);
    });
});
