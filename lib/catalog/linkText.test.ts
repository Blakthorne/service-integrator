import { describe, expect, test } from "vitest";
import {
    LINK_REASON_DESCRIPTIONS,
    LINK_REASON_LABELS,
    LINK_SOURCE_DESCRIPTIONS,
    LINK_SOURCE_LABELS,
    describeNotInPcoCount,
    describeUnlinkedCount,
    ignoredMessage,
    linkedMessage,
    undoneMessage,
    unignoredMessage,
} from "./linkText";

describe("the words for a link", () => {
    test("give every reason a tag and a description of its own", () => {
        expect(LINK_REASON_LABELS).toEqual({
            exact: "Same title",
            alias: "Other title",
            "tune-hint": "Title names the tune",
            near: "Similar title",
        });
        const descriptions = Object.values(LINK_REASON_DESCRIPTIONS);
        expect(new Set(descriptions).size).toBe(descriptions.length);
    });

    test("give every source a tag and a description", () => {
        expect(LINK_SOURCE_LABELS).toEqual({ auto: "auto", manual: "manual", import: "import" });
        expect(LINK_SOURCE_DESCRIPTIONS.auto).toBe("Linked automatically by a sync");
        expect(LINK_SOURCE_DESCRIPTIONS.manual).toBe("Linked by hand");
    });
});

describe("describeUnlinkedCount", () => {
    test("counts the Planning Center songs not in the catalog", () => {
        expect(describeUnlinkedCount(1)).toBe("1 Planning Center song is not in the catalog.");
        expect(describeUnlinkedCount(1234)).toBe(
            "1,234 Planning Center songs are not in the catalog."
        );
    });

    test("says when there are none", () => {
        expect(describeUnlinkedCount(0)).toBe(
            "Every Planning Center song is in the catalog or ignored."
        );
    });
});

describe("describeNotInPcoCount", () => {
    test("counts the catalog songs not in Planning Center", () => {
        expect(describeNotInPcoCount(1)).toBe("1 catalog song is not in Planning Center.");
        expect(describeNotInPcoCount(524)).toBe("524 catalog songs are not in Planning Center.");
    });

    test("says when there are none", () => {
        expect(describeNotInPcoCount(0)).toBe("Every catalog song is linked to Planning Center.");
    });
});

describe("what Reconcile says after a change", () => {
    test("names the songs a change was about", () => {
        expect(linkedMessage("Abba, Father (PRITCHARD)", "Abba, Father (PRITCHARD)")).toBe(
            'Linked "Abba, Father (PRITCHARD)" to Abba, Father (PRITCHARD).'
        );
        expect(ignoredMessage("Happy Birthday")).toBe(
            'Ignored "Happy Birthday". It is under Ignored songs, at the end of the page.'
        );
        expect(undoneMessage("Amazing Grace", "Amazing Grace (NEW BRITAIN)")).toBe(
            'Unlinked "Amazing Grace" from Amazing Grace (NEW BRITAIN). It is back on the list of songs not in the catalog, and no sync will link it again.'
        );
        expect(unignoredMessage("Happy Birthday")).toBe(
            '"Happy Birthday" is back on the list of songs not in the catalog.'
        );
    });
});
