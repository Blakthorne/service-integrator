import { describe, expect, test } from "vitest";
import {
    ADD_BOOK_ID,
    NOT_IN_USE_NOTICE,
    UNNUMBERED_ORDER_NOTE,
    entryRowId,
    formatEntryCount,
} from "./bookText";

describe("entryRowId", () => {
    test("is the entry's number behind a fixed prefix", () => {
        expect(entryRowId(396)).toBe("entry-396");
        expect(entryRowId(1)).toBe("entry-1");
    });

    test("is a valid, distinct id for every number", () => {
        expect(entryRowId(12)).not.toBe(entryRowId(120));
        expect(entryRowId(12)).toMatch(/^[a-z][a-z0-9-]*$/);
    });
});

describe("formatEntryCount", () => {
    test("is singular for one entry only", () => {
        expect(formatEntryCount(1)).toBe("1 entry");
    });

    test("is plural for none and for many", () => {
        expect(formatEntryCount(0)).toBe("0 entries");
        expect(formatEntryCount(2)).toBe("2 entries");
        expect(formatEntryCount(708)).toBe("708 entries");
    });
});

describe("ADD_BOOK_ID", () => {
    test("is a valid DOM id, which a link's fragment can name", () => {
        expect(ADD_BOOK_ID).toMatch(/^[a-z][a-z0-9-]*$/);
    });
});

describe("the notes on a book's page", () => {
    test("a book that is not in use says what it leaves out, and how to put it back", () => {
        expect(NOT_IN_USE_NOTICE).toContain("schedule text");
        expect(NOT_IN_USE_NOTICE).toContain("hymnal notes");
        expect(NOT_IN_USE_NOTICE).toContain("book filter");
        expect(NOT_IN_USE_NOTICE).toContain("Edit the book");
    });

    test("a book without numbers says its entries move, and where a new one goes", () => {
        expect(UNNUMBERED_ORDER_NOTE).toContain("move an entry up or down");
        expect(UNNUMBERED_ORDER_NOTE).toContain("end of the list");
    });
});
