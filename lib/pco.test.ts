import { afterEach, describe, expect, test, vi } from "vitest";
import { fetchAllSongs, pcoAuthHeaders } from "./pco";

afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

describe("pcoAuthHeaders", () => {
    test("throws when credentials are missing", () => {
        vi.stubEnv("PLANNING_CENTER_ID", "");
        vi.stubEnv("PLANNING_CENTER_TOKEN", "");
        expect(() => pcoAuthHeaders()).toThrow("Planning Center credentials not configured");
    });

    test("builds a Basic auth header", () => {
        vi.stubEnv("PLANNING_CENTER_ID", "id");
        vi.stubEnv("PLANNING_CENTER_TOKEN", "tok");
        const headers = pcoAuthHeaders();
        expect(headers.Authorization).toBe(`Basic ${Buffer.from("id:tok").toString("base64")}`);
    });
});

describe("fetchAllSongs", () => {
    test("follows links.next and maps attributes across pages", async () => {
        vi.stubEnv("PLANNING_CENTER_ID", "id");
        vi.stubEnv("PLANNING_CENTER_TOKEN", "tok");

        const page1 = {
            data: [{ attributes: { title: "Amazing Grace", last_scheduled_at: "2025-01-01T00:00:00Z" } }],
            links: { next: "https://api.planningcenteronline.com/services/v2/songs?offset=100" },
        };
        const page2 = {
            data: [{ attributes: { title: "Never Sung", last_scheduled_at: null } }],
            links: {},
        };
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce({ ok: true, json: async () => page1 })
            .mockResolvedValueOnce({ ok: true, json: async () => page2 });
        vi.stubGlobal("fetch", fetchMock);

        const songs = await fetchAllSongs();

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(songs).toEqual([
            { title: "Amazing Grace", lastScheduledAt: "2025-01-01T00:00:00Z" },
            { title: "Never Sung", lastScheduledAt: null },
        ]);
    });

    test("throws on a non-ok response", async () => {
        vi.stubEnv("PLANNING_CENTER_ID", "id");
        vi.stubEnv("PLANNING_CENTER_TOKEN", "tok");
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 429 }));
        await expect(fetchAllSongs()).rejects.toThrow("status: 429");
    });
});
