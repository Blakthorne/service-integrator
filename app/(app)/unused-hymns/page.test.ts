import { beforeEach, describe, expect, test, vi } from "vitest";

// vi.hoisted is required: vi.mock is hoisted above const declarations.
const { permanentRedirect } = vi.hoisted(() => ({ permanentRedirect: vi.fn() }));
vi.mock("next/navigation", () => ({ permanentRedirect }));

import { parseCatalogSongsQuery } from "@/lib/catalog/filter";
import UnusedHymnsPage from "./page";

beforeEach(() => {
    permanentRedirect.mockReset();
});

describe("the old Unused Hymns page", () => {
    test("redirects, permanently, to the songs list's never scheduled filter", () => {
        UnusedHymnsPage();

        expect(permanentRedirect).toHaveBeenCalledTimes(1);
        expect(permanentRedirect).toHaveBeenCalledWith("/catalog?used=never");
    });

    test("sends visitors to a view that the songs list reads as never scheduled", () => {
        UnusedHymnsPage();

        const [target] = permanentRedirect.mock.calls[0] as [string];
        const { pathname, searchParams } = new URL(target, "https://example.test");
        expect(pathname).toBe("/catalog");
        expect(parseCatalogSongsQuery(searchParams, ["R", "G"])).toEqual({
            q: "",
            book: null,
            linked: "all",
            used: "never",
            sort: "title",
            page: 1,
        });
    });
});
