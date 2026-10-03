import { describe, expect, test } from "vitest";
import { planLabel } from "./planLabel";

describe("planLabel", () => {
    test("is the plan's dates, a middle dot, then the service type", () => {
        expect(
            planLabel({ dates: "October 4, 2026" }, { name: "Sunday Morning" })
        ).toBe("October 4, 2026 · Sunday Morning");
    });

    test("uses PCO's text as it is, for a range of dates too", () => {
        expect(
            planLabel(
                { dates: "December 24 & 25, 2026" },
                { name: "Christmas Services" }
            )
        ).toBe("December 24 & 25, 2026 · Christmas Services");
    });
});
