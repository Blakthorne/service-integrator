import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { describe, expect, test } from "vitest";
import { safeCallbackUrl } from "./safeCallbackUrl";

/** Whether Node will write `value` into a Location header, as `redirect()` does. */
function canBeLocationHeader(value: string): boolean {
    const response = new ServerResponse(new IncomingMessage(new Socket()));
    try {
        response.setHeader("Location", value);
        return true;
    } catch {
        return false;
    }
}

/**
 * What the sign-in page gets for a signed-out request to `pathAndQuery`: the
 * middleware puts the request's pathname and search into `callbackUrl`, and the
 * page reads the parameter back out of the redirect URL.
 */
function callbackUrlAfterMiddleware(pathAndQuery: string): string | null {
    const request = new URL("https://app.test" + pathAndQuery);
    const signInUrl = new URL("/auth/signin", request);
    signInUrl.searchParams.set(
        "callbackUrl",
        request.pathname + request.search
    );
    return safeCallbackUrl(
        new URL(signInUrl.href).searchParams.get("callbackUrl")
    );
}

describe("safeCallbackUrl", () => {
    describe("accepts site-relative paths", () => {
        const accepted = [
            "/",
            "/plans",
            "/plans/1/2?x=1",
            "/plans/1405391/98765/schedule",
            "/plans/1405391/98765/items/4321",
            "/unused-hymns?book=great",
            "/unused-hymns?book=rejoice&sort=number&page=2",
            "/plans#section",
            "/plans?q=a%20b&r=%2F%2Fevil.com",
            "/plans/a%20b",
            "/caf%C3%A9",
            "/%E6%97%A5%E6%9C%AC",
            "/plans?q=%C3%A9+x",
            "/%2F%2Fevil.com",
            "/.//evil.com",
            "/a\\b",
            "/!~",
            "/a!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~",
        ];

        test.each(accepted)("returns %j unchanged", (value) => {
            expect(safeCallbackUrl(value)).toBe(value);
        });

        test.each(accepted)("%j stays on this site", (value) => {
            expect(new URL(value, "https://x.test").origin).toBe(
                "https://x.test"
            );
        });

        test.each(accepted)("%j can be written into a Location header", (value) => {
            expect(canBeLocationHeader(value)).toBe(true);
        });

        test("accepts 2048 characters, but not 2049", () => {
            const path = (length: number) => "/" + "a".repeat(length - 1);
            expect(safeCallbackUrl(path(2048))).toBe(path(2048));
            expect(safeCallbackUrl(path(2049))).toBeNull();
        });
    });

    describe("accepts what the middleware sends", () => {
        // The middleware takes the request's pathname and search, which the URL
        // parser has already percent-encoded, so spaces and non-ASCII text arrive
        // as ASCII.
        test.each([
            ["/", "/"],
            ["/plans/1405391/98765/schedule", "/plans/1405391/98765/schedule"],
            ["/unused-hymns?book=great&sort=number", "/unused-hymns?book=great&sort=number"],
            ["/plans/a b/c?q=x y", "/plans/a%20b/c?q=x%20y"],
            [
                "/plans/日本語?q=é&r=日",
                "/plans/%E6%97%A5%E6%9C%AC%E8%AA%9E?q=%C3%A9&r=%E6%97%A5",
            ],
            ["/plans/ x", "/plans/%E2%80%A8x"],
            ["/plans/／", "/plans/%EF%BC%8F"],
            ["/plans/%E6%97%A5", "/plans/%E6%97%A5"],
            ["/plans/a%2Fb?q=%26", "/plans/a%2Fb?q=%26"],
            ["/plans/\\evil", "/plans//evil"],
        ])("a request for %j gives %j", (pathAndQuery, expected) => {
            const callbackUrl = callbackUrlAfterMiddleware(pathAndQuery);
            expect(callbackUrl).toBe(expected);
            expect(canBeLocationHeader(callbackUrl as string)).toBe(true);
        });

        test("a request that would be another host is refused", () => {
            expect(callbackUrlAfterMiddleware("//evil.com/x")).toBeNull();
            expect(callbackUrlAfterMiddleware("/\\evil.com")).toBeNull();
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

    describe("rejects spaces and anything that is not printable ASCII", () => {
        // Node throws ERR_INVALID_CHAR for a character above U+00FF in a
        // Location header, so redirect() would answer with a 500.
        const refused: [string, string][] = [
            ["a Japanese character", "/日"],
            ["U+2028 line separator", "/ "],
            ["a full-width solidus", "/／"],
            ["a full-width solidus pair that reads as //", "／／evil.com"],
            ["a full-width solidus after the slash", "/／evil.com"],
            ["an emoji", "/😀"],
            ["a lone surrogate", "/\ud800"],
            ["U+0100", "/Ā"],
            ["a zero-width space", "/pl​ans"],
            ["a right-to-left override", "/‮plans"],
            ["a Latin-1 letter (Node would accept it, browsers would garble it)", "/café"],
            ["U+00FF", "/ÿ"],
            ["a no-break space", "/pl ans"],
            ["a space", "/plans/a b"],
            ["a space right after the slash", "/ plans"],
            ["a trailing space", "/plans "],
        ];

        test.each(refused)("rejects %s", (_name, value) => {
            expect(safeCallbackUrl(value)).toBeNull();
        });

        test.each([
            ["a Japanese character", "/日"],
            ["U+2028 line separator", "/ "],
            ["a full-width solidus", "/／"],
        ])("Node cannot write %s into a Location header", (_name, value) => {
            expect(canBeLocationHeader(value)).toBe(false);
        });

        test("the ends of the allowed range", () => {
            expect(safeCallbackUrl("/!")).toBe("/!");
            expect(safeCallbackUrl("/~")).toBe("/~");
            expect(safeCallbackUrl("/ ")).toBeNull();
            expect(safeCallbackUrl("/\u007f")).toBeNull();
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
