import { describe, expect, test } from "vitest";
import { MAX_REQUESTED_CREDIT_LABELS, readRequestedCreditLabels } from "./requestedCreditLabels";

const LABEL = { pcoSongId: "1001", shownAuthor: "Fanny Crosby", author: "Words & Music: Fanny Crosby" };

describe("readRequestedCreditLabels", () => {
    test("reads each label asked for, with its id parsed", () => {
        expect(
            readRequestedCreditLabels([LABEL, { pcoSongId: "1002", shownAuthor: "", author: "Words: X" }])
        ).toEqual([LABEL, { pcoSongId: "1002", shownAuthor: "", author: "Words: X" }]);
    });

    test("keeps only the fields it knows", () => {
        expect(readRequestedCreditLabels([{ ...LABEL, source: "auto" }])).toEqual([LABEL]);
    });

    test("refuses anything but a non-empty list of labels, not too many", () => {
        expect(readRequestedCreditLabels(null)).toBeNull();
        expect(readRequestedCreditLabels("1001")).toBeNull();
        expect(readRequestedCreditLabels({ 0: LABEL, length: 1 })).toBeNull();
        expect(readRequestedCreditLabels([])).toBeNull();
        expect(readRequestedCreditLabels(Array(MAX_REQUESTED_CREDIT_LABELS + 1).fill(LABEL))).toBeNull();
        expect(readRequestedCreditLabels(Array(MAX_REQUESTED_CREDIT_LABELS).fill(LABEL))).toHaveLength(
            MAX_REQUESTED_CREDIT_LABELS
        );
    });

    test("refuses the whole request when one label is not one", () => {
        for (const bad of [
            null,
            "1001",
            { ...LABEL, pcoSongId: "1001/../1002" },
            { ...LABEL, pcoSongId: 1001 },
            { ...LABEL, pcoSongId: "0" },
            { ...LABEL, shownAuthor: null },
            { ...LABEL, shownAuthor: "x".repeat(2001) },
            { ...LABEL, author: "" },
            { ...LABEL, author: 7 },
            { ...LABEL, author: "x".repeat(2001) },
        ]) {
            expect(readRequestedCreditLabels([LABEL, bad])).toBeNull();
        }
    });
});
