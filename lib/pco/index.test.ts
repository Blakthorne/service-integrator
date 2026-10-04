import { afterEach, describe, expect, test, vi } from "vitest";
import * as barrel from "@/lib/pco";
import { pcoAuthHeaders } from "@/lib/pco";

afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

describe("the barrel", () => {
    test("exports PcoValidationError, the PcoError for a 422", () => {
        const error = new barrel.PcoValidationError("/services/v2/songs", [
            { title: "Validation Error", detail: "must exist", parameter: "category" },
        ]);
        expect(error).toBeInstanceOf(barrel.PcoError);
        expect(error).toMatchObject({ status: 422, details: ["category: must exist"] });
    });

    test("exports the writes of lib/pco/writes.ts, through which app code writes", () => {
        const exported = Object.keys(barrel);
        for (const name of [
            "createItemNote",
            "updateItemNote",
            "deleteItemNote",
            "createSong",
            "updateSong",
            "createSongItem",
            "assignSongTags",
        ]) {
            expect(exported).toContain(name);
        }
    });

    test("leaves out the write plumbing: only modules inside lib/pco write to PCO", () => {
        const exported = Object.keys(barrel);
        expect(exported).toContain("PcoError");
        for (const name of ["pcoMutate", "jsonApi", "toOne", "toMany"]) {
            expect(exported).not.toContain(name);
        }
    });
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
