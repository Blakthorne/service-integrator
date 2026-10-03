import { describe, expect, test } from "vitest";
import { safeCallbackUrl } from "./safeCallbackUrl";

describe("safeCallbackUrl", () => {
    describe("accepts site-relative paths", () => {
        test.each([
            "/",
            "/plans",
            "/plans/1/2?x=1",
            "/plans/1405391/98765/schedule",
            "/plans/1405391/98765/items/4321",
            "/unused-hymns?book=great",
            "/unused-hymns?book=rejoice&sort=number&page=2",
            "/plans#section",
            "/plans?q=a%20b&r=%2F%2Fevil.com",
            "/plans/a b",
            "/café",
            "/%2F%2Fevil.com",
            "/.//evil.com",
            "/a\\b",
        ])("returns %j unchanged", (value) => {
            expect(safeCallbackUrl(value)).toBe(value);
        });

        test("accepts 2048 characters, but not 2049", () => {
            const path = (length: number) => "/" + "a".repeat(length - 1);
            expect(safeCallbackUrl(path(2048))).toBe(path(2048));
            expect(safeCallbackUrl(path(2049))).toBeNull();
        });
    });

    describe("rejects other hosts", () => {
        test.each([
            ["a protocol-relative URL", "//evil.com"],
            ["a protocol-relative URL with a path", "//evil.com/plans"],
            ["three slashes", "///evil.com"],
            ["a slash and a backslash", "/\\evil.com"],
            ["a slash and two backslashes", "/\\\\evil.com"],
            ["an absolute URL", "https://evil.com"],
            ["an absolute http URL", "http://evil.com/plans"],
            ["a javascript: URL", "javascript:alert(1)"],
            ["a data: URL", "data:text/html,<script>alert(1)</script>"],
            ["a leading backslash", "\\evil.com"],
            ["a bare host", "evil.com"],
            ["a relative path", "plans/1/2"],
            ["a leading space", " /plans"],
            ["a query string only", "?x=1"],
            ["a hash only", "#x"],
        ])("rejects %s", (_name, value) => {
            expect(safeCallbackUrl(value)).toBeNull();
        });

        test("rejects an encoded protocol-relative URL (it is a relative path, not a decoded one)", () => {
            expect(safeCallbackUrl("%2F%2Fevil.com")).toBeNull();
            expect(safeCallbackUrl("%2Fplans")).toBeNull();
        });
    });

    describe("rejects the auth pages, which would loop", () => {
        test.each([
            "/auth",
            "/auth/signin",
            "/auth/signin?callbackUrl=%2Fplans",
            "/auth/error",
            "/auth?x=1",
            "/AUTH/signin",
            "/Auth/signin",
            "/authors",
        ])("rejects %j", (value) => {
            expect(safeCallbackUrl(value)).toBeNull();
        });

        test("allows a path that only contains auth", () => {
            expect(safeCallbackUrl("/plans/auth")).toBe("/plans/auth");
            expect(safeCallbackUrl("/plans?next=/auth")).toBe("/plans?next=/auth");
        });
    });

    describe("rejects control characters", () => {
        test.each([
            ["a newline", "/plans\n"],
            ["a newline in the middle", "/pl\nans"],
            ["a carriage return and line feed", "/plans\r\nSet-Cookie: x=1"],
            ["a tab after the slash (browsers strip it)", "/\t/evil.com"],
            ["a tab", "/plans\t"],
            ["a null byte", "/pl\u0000ans"],
            ["escape", "/pl\u001bans"],
            ["delete", "/pl\u007fans"],
            ["a C1 control", "/pl\u0085ans"],
        ])("rejects %s", (_name, value) => {
            expect(safeCallbackUrl(value)).toBeNull();
        });
    });

    describe("rejects values that are not usable strings", () => {
        test("the empty string", () => {
            expect(safeCallbackUrl("")).toBeNull();
        });

        test.each([
            ["undefined", undefined],
            ["null", null],
            ["a number", 42],
            ["a boolean", true],
            ["an array holding a safe path", ["/plans"]],
            ["an empty array", []],
            ["an object", { toString: () => "/plans" }],
            ["a function", () => "/plans"],
        ])("rejects %s", (_name, value) => {
            expect(safeCallbackUrl(value)).toBeNull();
        });
    });
});
