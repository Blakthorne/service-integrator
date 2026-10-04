import { describe, expect, test } from "vitest";
import {
    NAV_ITEMS,
    PLAN_TABS,
    navAriaCurrent,
    pcoWebUrls,
    routes,
} from "./routes";

describe("routes", () => {
    test("static routes", () => {
        expect(routes.home()).toBe("/");
        expect(routes.plans()).toBe("/plans");
        expect(routes.unusedHymns()).toBe("/unused-hymns");
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
            routes.unusedHymns(),
        ];
        for (const href of all) {
            expect(href).toMatch(/^\/[^?#]*$/);
            expect(href === "/" || !href.endsWith("/")).toBe(true);
        }
    });
});

describe("NAV_ITEMS", () => {
    const [plans, unusedHymns] = NAV_ITEMS;

    test("lists Plans, then Unused Hymns", () => {
        expect(NAV_ITEMS.map((item) => item.label)).toEqual([
            "Plans",
            "Unused Hymns",
        ]);
    });

    test("hrefs come from the route builders", () => {
        expect(plans.href).toBe(routes.plans());
        expect(unusedHymns.href).toBe(routes.unusedHymns());
    });

    // [pathname, Plans active, Unused Hymns active]
    const cases: [string, boolean, boolean][] = [
        ["/", true, false],
        ["/plans", true, false],
        ["/plans/1405391/98765", true, false],
        ["/plans/1405391/98765/schedule", true, false],
        ["/plans/1405391/98765/items/4321", true, false],
        ["/plansx", false, false],
        ["/plans-archive", false, false],
        ["/unused-hymns", false, true],
        ["/unused-hymns/anything", false, true],
        ["/unused-hymnsx", false, false],
        ["/auth/signin", false, false],
        ["/something-else", false, false],
        ["", false, false],
    ];

    test.each(cases)(
        "%j: Plans active=%s, Unused Hymns active=%s",
        (pathname, plansActive, unusedActive) => {
            expect(plans.isActive(pathname)).toBe(plansActive);
            expect(unusedHymns.isActive(pathname)).toBe(unusedActive);
        }
    );

    test("tolerates a trailing slash", () => {
        expect(plans.isActive("/plans/")).toBe(true);
        expect(unusedHymns.isActive("/unused-hymns/")).toBe(true);
    });
});

describe("navAriaCurrent", () => {
    const [plans, unusedHymns] = NAV_ITEMS;

    type Current = "page" | "true" | undefined;
    // [pathname, Plans, Unused Hymns]
    const cases: [string, Current, Current][] = [
        // "/" only redirects to /plans, which is the Plans item's own page.
        ["/", "true", undefined],
        ["/plans", "page", undefined],
        ["/plans/1405391/98765", "true", undefined],
        ["/plans/1405391/98765/schedule", "true", undefined],
        ["/plans/1405391/98765/items/4321", "true", undefined],
        ["/plansx", undefined, undefined],
        ["/unused-hymns", undefined, "page"],
        ["/unused-hymns/anything", undefined, "true"],
        ["/unused-hymnsx", undefined, undefined],
        ["/auth/signin", undefined, undefined],
    ];

    test.each(cases)(
        "%j: Plans %s, Unused Hymns %s",
        (pathname, plansValue, unusedValue) => {
            expect(navAriaCurrent(plans, pathname)).toBe(plansValue);
            expect(navAriaCurrent(unusedHymns, pathname)).toBe(unusedValue);
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
