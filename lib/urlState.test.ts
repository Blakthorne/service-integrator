import { describe, expect, test } from "vitest";
import { parseEnum, parsePage, withSearchParams } from "./urlState";

describe("parsePage", () => {
    test.each([
        ["1", 1],
        ["2", 2],
        ["25", 25],
        ["007", 7],
        [String(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER],
    ])("accepts %j as page %i", (value, expected) => {
        expect(parsePage(value)).toBe(expected);
    });

    test.each([
        null,
        "",
        "0",
        "00",
        "-1",
        "-0",
        "1.5",
        "1e2",
        "+2",
        " 2",
        "2 ",
        "2abc",
        "abc",
        "0x10",
        "Infinity",
        "NaN",
        "١٢", // Arabic-Indic digits
        String(Number.MAX_SAFE_INTEGER + 2),
        "9".repeat(400),
    ])("treats %j as page 1", (value) => {
        expect(parsePage(value)).toBe(1);
    });

    test("always returns an integer of at least 1", () => {
        for (const value of [null, "", "0", "-5", "3", "1.5", "99", "x"]) {
            for (const total of [undefined, 0, 1, 2.5, 10, -3]) {
                const page = parsePage(value, total);
                expect(Number.isInteger(page)).toBe(true);
                expect(page).toBeGreaterThanOrEqual(1);
            }
        }
    });

    describe("with totalPages", () => {
        test("keeps a page that is in range", () => {
            expect(parsePage("2", 3)).toBe(2);
            expect(parsePage("3", 3)).toBe(3);
        });

        test("clamps a page past the end to the last page", () => {
            expect(parsePage("4", 3)).toBe(3);
            expect(parsePage("999", 3)).toBe(3);
        });

        test("invalid values are still page 1", () => {
            expect(parsePage(null, 3)).toBe(1);
            expect(parsePage("0", 3)).toBe(1);
            expect(parsePage("abc", 3)).toBe(1);
        });

        test("an empty list is page 1", () => {
            expect(parsePage("5", 0)).toBe(1);
            expect(parsePage("5", -2)).toBe(1);
        });

        test("rounds a fractional total down", () => {
            expect(parsePage("5", 2.7)).toBe(2);
            expect(parsePage("5", 0.5)).toBe(1);
        });

        test("ignores a total that is not a finite number", () => {
            expect(parsePage("5", Number.NaN)).toBe(5);
            expect(parsePage("5", Number.POSITIVE_INFINITY)).toBe(5);
        });
    });
});

describe("parseEnum", () => {
    const BOOKS = ["all", "rejoice", "great"] as const;

    test("returns an allowed value", () => {
        expect(parseEnum("rejoice", BOOKS, "all")).toBe("rejoice");
        expect(parseEnum("great", BOOKS, "all")).toBe("great");
        expect(parseEnum("all", BOOKS, "all")).toBe("all");
    });

    test("falls back for a missing or unlisted value", () => {
        expect(parseEnum(null, BOOKS, "all")).toBe("all");
        expect(parseEnum("", BOOKS, "all")).toBe("all");
        expect(parseEnum("other", BOOKS, "great")).toBe("great");
    });

    test("is case-sensitive and exact", () => {
        expect(parseEnum("Rejoice", BOOKS, "all")).toBe("all");
        expect(parseEnum("rejoice ", BOOKS, "all")).toBe("all");
    });

    test("does not match inherited object keys", () => {
        expect(parseEnum("constructor", BOOKS, "all")).toBe("all");
        expect(parseEnum("__proto__", BOOKS, "all")).toBe("all");
        expect(parseEnum("toString", BOOKS, "all")).toBe("all");
    });

    test("works with a plain array and an empty string as an allowed value", () => {
        expect(parseEnum("b", ["a", "b"], "a")).toBe("b");
        expect(parseEnum("", ["", "x"], "x")).toBe("");
    });
});

describe("withSearchParams", () => {
    test("adds a key to an empty query string", () => {
        expect(withSearchParams("", { page: "2" })).toBe("?page=2");
    });

    test("appends a new key after the existing ones", () => {
        expect(withSearchParams("?book=great", { page: "2" })).toBe(
            "?book=great&page=2"
        );
    });

    test("updates an existing key in place, keeping the order of the others", () => {
        expect(withSearchParams("?a=1&b=2&c=3", { b: "9" })).toBe(
            "?a=1&b=9&c=3"
        );
        expect(withSearchParams("?a=1&b=2&c=3", { a: "x", c: "z" })).toBe(
            "?a=x&b=2&c=z"
        );
    });

    test("deletes a key set to null, keeping the order of the others", () => {
        expect(withSearchParams("?a=1&b=2&c=3", { b: null })).toBe("?a=1&c=3");
        expect(withSearchParams("?a=1&b=2", { a: null })).toBe("?b=2");
    });

    test("returns an empty string when no parameters are left", () => {
        expect(withSearchParams("?a=1", { a: null })).toBe("");
        expect(withSearchParams("", { a: null })).toBe("");
        expect(withSearchParams("", {})).toBe("");
        expect(withSearchParams("?", {})).toBe("");
    });

    test("leaves the query string alone when there are no updates", () => {
        expect(withSearchParams("?a=1&b=2", {})).toBe("?a=1&b=2");
    });

    test("applies deletions and updates together", () => {
        expect(
            withSearchParams("?a=1&b=2&c=3", { a: null, c: "x", d: "4" })
        ).toBe("?b=2&c=x&d=4");
    });

    test("deleting a key that is not there changes nothing", () => {
        expect(withSearchParams("?a=1", { z: null })).toBe("?a=1");
    });

    test("accepts a query string without its leading question mark", () => {
        expect(withSearchParams("a=1", { b: "2" })).toBe("?a=1&b=2");
    });

    test("keeps an empty value", () => {
        expect(withSearchParams("", { q: "" })).toBe("?q=");
        expect(withSearchParams("?q=x", { q: "" })).toBe("?q=");
    });

    test("encodes values", () => {
        expect(withSearchParams("", { q: "a b&c=d/é" })).toBe(
            "?q=a+b%26c%3Dd%2F%C3%A9"
        );
    });

    test("re-serializes existing values form-style", () => {
        expect(withSearchParams("?q=a%20b", { x: "1" })).toBe("?q=a+b&x=1");
        expect(withSearchParams("?q=a%2Bb", { x: "1" })).toBe("?q=a%2Bb&x=1");
    });

    test("setting a key that appears several times leaves one entry", () => {
        expect(withSearchParams("?t=a&u=1&t=b", { t: "c" })).toBe("?t=c&u=1");
    });

    test("deleting a key that appears several times removes them all", () => {
        expect(withSearchParams("?t=a&u=1&t=b", { t: null })).toBe("?u=1");
    });
});
