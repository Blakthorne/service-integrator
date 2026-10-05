import { describe, expect, test } from "vitest";
import {
    CATALOG_SECTIONS,
    NAV_ITEMS,
    NAV_UTILITY_ITEMS,
    PLAN_TABS,
    catalogSectionFor,
    navAriaCurrent,
    pcoWebUrls,
    routes,
} from "./routes";

describe("routes", () => {
    test("static routes", () => {
        expect(routes.home()).toBe("/");
        expect(routes.plans()).toBe("/plans");
        expect(routes.settings()).toBe("/settings");
        expect(routes.catalog()).toBe("/catalog");
        expect(routes.catalogTunes()).toBe("/catalog/tunes");
        expect(routes.catalogBooks()).toBe("/catalog/books");
        expect(routes.catalogImport()).toBe("/catalog/import");
    });

    test("catalogFiltered puts the songs list's filters in the query", () => {
        expect(routes.catalogFiltered({})).toBe("/catalog");
        expect(routes.catalogFiltered({ linked: "no" })).toBe("/catalog?linked=no");
        expect(routes.catalogFiltered({ used: "never" })).toBe("/catalog?used=never");
        expect(routes.catalogFiltered({ linked: "yes", used: "never" })).toBe(
            "/catalog?linked=yes&used=never"
        );
    });

    test("the reconcile page and the new-song form", () => {
        expect(routes.catalogReconcile()).toBe("/catalog/reconcile");
        expect(routes.catalogSongNew()).toBe("/catalog/songs/new");
        expect(routes.catalogSongNew({ pcoSongId: "123" })).toBe(
            "/catalog/songs/new?pcoSongId=123"
        );
        expect(
            routes.catalogSongNew({
                pcoSongId: "123",
                returnTo: "/plans/1/2/schedule?x=1&y=2",
            })
        ).toBe(
            "/catalog/songs/new?pcoSongId=123&returnTo=%2Fplans%2F1%2F2%2Fschedule%3Fx%3D1%26y%3D2"
        );
    });

    test("catalog builders put the id or code at the end", () => {
        expect(routes.catalogSong(42)).toBe("/catalog/songs/42");
        expect(routes.catalogTune(7)).toBe("/catalog/tunes/7");
        expect(routes.catalogBook("G")).toBe("/catalog/books/G");
        expect(routes.catalogImportRun(3)).toBe("/catalog/import/3");
    });

    test("plan builders put the ids in order", () => {
        expect(routes.plan("1405391", "98765")).toBe("/plans/1405391/98765");
        expect(routes.planSchedule("1405391", "98765")).toBe(
            "/plans/1405391/98765/schedule"
        );
        expect(routes.planItem("1405391", "98765", "4321")).toBe(
            "/plans/1405391/98765/items/4321"
        );
    });

    test("no builder adds a trailing slash or a query string", () => {
        const all = [
            routes.home(),
            routes.plans(),
            routes.plan("1", "2"),
            routes.planSchedule("1", "2"),
            routes.planItem("1", "2", "3"),
            routes.settings(),
            routes.catalog(),
            routes.catalogSong(1),
            routes.catalogTunes(),
            routes.catalogTune(1),
            routes.catalogBooks(),
            routes.catalogBook("R"),
            routes.catalogImport(),
            routes.catalogImportRun(1),
            routes.catalogReconcile(),
            routes.catalogSongNew(),
        ];
        for (const href of all) {
            expect(href).toMatch(/^\/[^?#]*$/);
            expect(href === "/" || !href.endsWith("/")).toBe(true);
        }
    });
});

describe("NAV_ITEMS", () => {
    const [plans, catalog] = NAV_ITEMS;

    test("lists Plans, then Catalog", () => {
        expect(NAV_ITEMS.map((item) => item.label)).toEqual(["Plans", "Catalog"]);
    });

    test("hrefs come from the route builders", () => {
        expect(plans.href).toBe(routes.plans());
        expect(catalog.href).toBe(routes.catalog());
    });

    // [pathname, Plans active, Catalog active]
    const cases: [string, boolean, boolean][] = [
        ["/", true, false],
        ["/plans", true, false],
        ["/plans/1405391/98765", true, false],
        ["/plans/1405391/98765/schedule", true, false],
        ["/plans/1405391/98765/items/4321", true, false],
        ["/plansx", false, false],
        ["/plans-archive", false, false],
        ["/catalog", false, true],
        ["/catalog/songs/42", false, true],
        ["/catalog/books/G", false, true],
        ["/catalogx", false, false],
        ["/unused-hymns", false, false],
        ["/unused-hymns/anything", false, false],
        ["/unused-hymnsx", false, false],
        ["/settings", false, false],
        ["/auth/signin", false, false],
        ["/something-else", false, false],
        ["", false, false],
    ];

    test.each(cases)(
        "%j: Plans active=%s, Catalog active=%s",
        (pathname, plansActive, catalogActive) => {
            expect(plans.isActive(pathname)).toBe(plansActive);
            expect(catalog.isActive(pathname)).toBe(catalogActive);
        }
    );

    test("tolerates a trailing slash", () => {
        expect(plans.isActive("/plans/")).toBe(true);
        expect(catalog.isActive("/catalog/")).toBe(true);
    });
});

describe("navAriaCurrent", () => {
    const [plans, catalog] = NAV_ITEMS;

    type Current = "page" | "true" | undefined;
    // [pathname, Plans, Catalog]
    const cases: [string, Current, Current][] = [
        // "/" only redirects to /plans, which is the Plans item's own page.
        ["/", "true", undefined],
        ["/plans", "page", undefined],
        ["/plans/1405391/98765", "true", undefined],
        ["/plans/1405391/98765/schedule", "true", undefined],
        ["/plans/1405391/98765/items/4321", "true", undefined],
        ["/plansx", undefined, undefined],
        ["/catalog", undefined, "page"],
        ["/catalog/songs/42", undefined, "true"],
        ["/unused-hymns", undefined, undefined],
        ["/unused-hymns/anything", undefined, undefined],
        ["/unused-hymnsx", undefined, undefined],
        ["/auth/signin", undefined, undefined],
    ];

    test.each(cases)(
        "%j: Plans %s, Catalog %s",
        (pathname, plansValue, catalogValue) => {
            expect(navAriaCurrent(plans, pathname)).toBe(plansValue);
            expect(navAriaCurrent(catalog, pathname)).toBe(catalogValue);
        }
    );

    test("is set exactly when the item is active", () => {
        for (const item of NAV_ITEMS) {
            for (const [pathname] of cases) {
                expect(navAriaCurrent(item, pathname) !== undefined).toBe(
                    item.isActive(pathname)
                );
            }
        }
    });

    test("never marks two items as the current page at once", () => {
        for (const [pathname] of cases) {
            const pages = NAV_ITEMS.filter(
                (item) => navAriaCurrent(item, pathname) === "page"
            );
            expect(pages.length).toBeLessThanOrEqual(1);
        }
    });
});

describe("NAV_UTILITY_ITEMS", () => {
    const [settings] = NAV_UTILITY_ITEMS;

    test("lists Settings, as a gear", () => {
        expect(NAV_UTILITY_ITEMS.map((item) => item.label)).toEqual(["Settings"]);
        expect(settings.icon).toBe("gear");
        expect(settings.href).toBe(routes.settings());
    });

    test.each<[string, boolean, "page" | "true" | undefined]>([
        ["/settings", true, "page"],
        ["/settings/", true, "true"],
        ["/settings/anything", true, "true"],
        ["/settingsx", false, undefined],
        ["/", false, undefined],
        ["/plans", false, undefined],
        ["/catalog", false, undefined],
    ])("%j: Settings active=%s, aria-current=%s", (pathname, active, current) => {
        expect(settings.isActive(pathname)).toBe(active);
        expect(navAriaCurrent(settings, pathname)).toBe(current);
    });

    test("never marks it and a section link as the current page at once", () => {
        const items = [...NAV_ITEMS, ...NAV_UTILITY_ITEMS];
        for (const pathname of ["/", "/plans", "/catalog", "/settings"]) {
            const pages = items.filter(
                (item) => navAriaCurrent(item, pathname) === "page"
            );
            expect(pages.length).toBeLessThanOrEqual(1);
        }
    });
});

describe("CATALOG_SECTIONS", () => {
    test("lists Songs, Tunes, Books, Reconcile and Import, linked by the builders", () => {
        expect(CATALOG_SECTIONS.map((section) => section.label)).toEqual([
            "Songs",
            "Tunes",
            "Books",
            "Reconcile",
            "Import",
        ]);
        expect(CATALOG_SECTIONS.map((section) => section.href)).toEqual([
            routes.catalog(),
            routes.catalogTunes(),
            routes.catalogBooks(),
            routes.catalogReconcile(),
            routes.catalogImport(),
        ]);
    });

    test.each<[string | null, string | undefined]>([
        [null, "Songs"],
        ["songs", "Songs"],
        ["tunes", "Tunes"],
        ["books", "Books"],
        ["import", "Import"],
        ["reconcile", "Reconcile"],
        ["(group)", undefined],
    ])("segment %j belongs to %s", (segment, label) => {
        expect(catalogSectionFor(segment)?.label).toBe(label);
    });

    test("no segment belongs to two sections", () => {
        const segments = CATALOG_SECTIONS.flatMap((section) => section.segments);
        expect(new Set(segments).size).toBe(segments.length);
    });
});

describe("PLAN_TABS", () => {
    test("lists the Copyright tab (default) and the Schedule tab", () => {
        expect(PLAN_TABS.map((tab) => tab.segment)).toEqual([null, "schedule"]);
        expect(PLAN_TABS.map((tab) => tab.label)).toEqual([
            "Copyright Information",
            "Service Schedule",
        ]);
    });

    test("hrefs are the plan builders", () => {
        expect(PLAN_TABS[0].href).toBe(routes.plan);
        expect(PLAN_TABS[1].href).toBe(routes.planSchedule);
        expect(PLAN_TABS.map((tab) => tab.href("1405391", "98765"))).toEqual([
            "/plans/1405391/98765",
            "/plans/1405391/98765/schedule",
        ]);
    });
});

describe("pcoWebUrls", () => {
    test("plan links to the plan in the Planning Center web app", () => {
        expect(pcoWebUrls.plan("98765")).toBe(
            "https://services.planningcenteronline.com/plans/98765"
        );
    });

    test("song links to the song in the Planning Center web app", () => {
        expect(pcoWebUrls.song("4321")).toBe(
            "https://services.planningcenteronline.com/songs/4321"
        );
    });
});
