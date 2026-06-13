import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { PcoSong } from "@/lib/unusedHymns";

// vi.hoisted is required: vi.mock is hoisted above const declarations, so the
// mock fn must be created inside hoisted() to exist when the factory runs.
const { fetchAllSongs } = vi.hoisted(() => ({ fetchAllSongs: vi.fn() }));
vi.mock("@/lib/pco", () => ({ fetchAllSongs }));

const sampleSongs: PcoSong[] = [
    { title: "Amazing Grace", lastScheduledAt: "2025-01-01T00:00:00Z" },
];

async function loadRoute() {
    vi.resetModules();
    return import("./route");
}

beforeEach(() => {
    fetchAllSongs.mockReset();
    fetchAllSongs.mockResolvedValue(sampleSongs);
});

afterEach(() => {
    vi.clearAllMocks();
});

describe("GET /api/unused-hymns", () => {
    test("returns a result with the expected shape", async () => {
        const { GET } = await loadRoute();
        const res = await GET(new Request("http://localhost/api/unused-hymns"));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toHaveProperty("unused");
        expect(body).toHaveProperty("review");
        expect(body.meta).toHaveProperty("computedAt");
        expect(body.meta.totals).toHaveProperty("rejoice");
        expect(fetchAllSongs).toHaveBeenCalledTimes(1);
    });

    test("serves the second request from cache (no re-fetch)", async () => {
        const { GET } = await loadRoute();
        await GET(new Request("http://localhost/api/unused-hymns"));
        await GET(new Request("http://localhost/api/unused-hymns"));
        expect(fetchAllSongs).toHaveBeenCalledTimes(1);
    });

    test("?refresh=1 busts the cache", async () => {
        const { GET } = await loadRoute();
        await GET(new Request("http://localhost/api/unused-hymns"));
        await GET(new Request("http://localhost/api/unused-hymns?refresh=1"));
        expect(fetchAllSongs).toHaveBeenCalledTimes(2);
    });

    test("returns 500 when fetching fails", async () => {
        fetchAllSongs.mockRejectedValueOnce(new Error("boom"));
        const { GET } = await loadRoute();
        const res = await GET(new Request("http://localhost/api/unused-hymns"));
        expect(res.status).toBe(500);
        const body = await res.json();
        expect(body.error).toBeTruthy();
    });
});
