import { describe, expect, test } from "vitest";
import {
    HISTORY_ROWS_SHOWN,
    foldHistoryRows,
    historyRows,
    serviceTypeLabel,
} from "./songHistoryText";
import type { SongHistoryEntry } from "./reports";

const MORNING = "1405391";
const EVENING = "1486055";

function entry(
    planId: string,
    planDate: string,
    upcoming = false,
    serviceTypeId = MORNING,
    itemId = "1"
): SongHistoryEntry {
    return { planId, itemId, serviceTypeId, planDate, upcoming };
}

describe("serviceTypeLabel", () => {
    const names = { [MORNING]: "Sunday Morning", [EVENING]: "  Sunday Evening  " };

    test("is the service type's name", () => {
        expect(serviceTypeLabel(names, MORNING)).toBe("Sunday Morning");
        expect(serviceTypeLabel(names, EVENING)).toBe("Sunday Evening");
    });

    test("falls back to the id when the names are not known, or the type is not listed", () => {
        expect(serviceTypeLabel({}, MORNING)).toBe("Service type 1405391");
        expect(serviceTypeLabel(names, "999")).toBe("Service type 999");
        expect(serviceTypeLabel({ [MORNING]: "   " }, MORNING)).toBe("Service type 1405391");
    });

    test("does not read a name off the object's prototype", () => {
        expect(serviceTypeLabel({}, "constructor")).toBe("Service type constructor");
    });
});

describe("historyRows", () => {
    const entries = [
        entry("30", "2026-10-11", true),
        entry("20", "2026-09-27", false, MORNING, "5"),
        entry("20", "2026-09-27", false, MORNING, "9"),
        entry("10", "2026-09-20", false, EVENING),
    ];
    const names = { [MORNING]: "Sunday Morning", [EVENING]: "Sunday Evening" };

    test("keeps the order and gives each occurrence a date heading, its service type and whether it is upcoming", () => {
        expect(historyRows(entries, names)).toEqual([
            {
                key: "30-1",
                planId: "30",
                serviceTypeId: MORNING,
                date: "Sunday, October 11, 2026",
                serviceTypeName: "Sunday Morning",
                upcoming: true,
            },
            {
                key: "20-5",
                planId: "20",
                serviceTypeId: MORNING,
                date: "Sunday, September 27, 2026",
                serviceTypeName: "Sunday Morning",
                upcoming: false,
            },
            {
                key: "20-9",
                planId: "20",
                serviceTypeId: MORNING,
                date: "Sunday, September 27, 2026",
                serviceTypeName: "Sunday Morning",
                upcoming: false,
            },
            {
                key: "10-1",
                planId: "10",
                serviceTypeId: EVENING,
                date: "Sunday, September 20, 2026",
                serviceTypeName: "Sunday Evening",
                upcoming: false,
            },
        ]);
    });

    test("lists a song that is twice in one plan twice, each with its own key", () => {
        const rows = historyRows(entries, names);
        expect(new Set(rows.map(({ key }) => key)).size).toBe(rows.length);
        expect(rows.filter(({ planId }) => planId === "20")).toHaveLength(2);
    });

    test("names a service type by its id when its names are not known", () => {
        expect(historyRows(entries.slice(3), {})[0].serviceTypeName).toBe("Service type 1486055");
    });

    test("has no rows for no occurrences", () => {
        expect(historyRows([], names)).toEqual([]);
    });
});

describe("foldHistoryRows", () => {
    const rows = (count: number) => Array.from({ length: count }, (_, index) => index);

    test("lists them all when there are few", () => {
        expect(foldHistoryRows(rows(0))).toEqual({ shown: [], folded: [] });
        expect(foldHistoryRows(rows(HISTORY_ROWS_SHOWN))).toEqual({
            shown: rows(HISTORY_ROWS_SHOWN),
            folded: [],
        });
    });

    test("does not fold away fewer than three rows", () => {
        expect(foldHistoryRows(rows(HISTORY_ROWS_SHOWN + 2)).folded).toEqual([]);
        expect(foldHistoryRows(rows(HISTORY_ROWS_SHOWN + 2)).shown).toHaveLength(HISTORY_ROWS_SHOWN + 2);
    });

    test("lists the first rows and folds the earlier ones away", () => {
        const { shown, folded } = foldHistoryRows(rows(HISTORY_ROWS_SHOWN + 3));
        expect(shown).toEqual(rows(HISTORY_ROWS_SHOWN));
        expect(folded).toEqual([10, 11, 12]);
        expect(foldHistoryRows(rows(100)).folded).toHaveLength(90);
    });
});
