import { readFileSync } from "node:fs";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { describe, expect, test } from "vitest";
import { safeCallbackUrl, signInTarget } from "./safeCallbackUrl";

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

/**
 * The matcher in middleware.ts as a regex: it matches the paths the middleware
 * protects. The file is read as text because Next needs `config.matcher` to be
 * a literal, so it cannot come from a shared module, and importing the
 * middleware would pull in next-auth.
 */
function middlewareMatcher(): RegExp {
    const source = readFileSync(
        new URL("../middleware.ts", import.meta.url),
        "utf8"
    )
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
    const literal = /matcher:\s*\[\s*"((?:[^"\\]|\\.)*)"\s*\]/.exec(source);
    if (literal === null) {
        throw new Error("could not find the matcher string in middleware.ts");
    }
    const pattern = JSON.parse(`"${literal[1]}"`) as string;
    return new RegExp(`^${pattern}$`, "i");
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
            "/authors",
            "/authorize?x=1",
            "/Authors/1",
            "/author/1",
            "/auth-callback",
            "/authx/y",
            "/plans#section",
            "/plans?q=a%20b&r=%2F%2Fevil.com",
            "/plans/a%20b",
            "/caf%C3%A9",
            "/%E6%97%A5%E6%9C%AC",
            "/plans?q=%C3%A9+x",
            "/catalog/songs/new?pcoSongId=1&returnTo=%2Fcatalog%2Freconcile",
            "/plans#%2F%2Fevil.com",
            "/plans//x",
            "/a/../b",
            "/!~",
            "/a!\"#$%&'()*+,-./:;<=>?@[]^_`{|}~",
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
                "/plans/\u65e5\u672c\u8a9e?q=\u00e9&r=\u65e5",
                "/plans/%E6%97%A5%E6%9C%AC%E8%AA%9E?q=%C3%A9&r=%E6%97%A5",
            ],
            ["/plans/\u2028x", "/plans/%E2%80%A8x"],
            ["/plans/\uff0f", "/plans/%EF%BC%8F"],
            ["/plans/%E6%97%A5", "/plans/%E6%97%A5"],
            ["/plans/a?q=%26%2F", "/plans/a?q=%26%2F"],
            ["/plans/\\evil", "/plans//evil"],
            // Protected pages whose names merely start with "auth".
            ["/authors", "/authors"],
            ["/authorize?x=1", "/authorize?x=1"],
            ["/authors/1?q=a b", "/authors/1?q=a%20b"],
        ])("a request for %j gives %j", (pathAndQuery, expected) => {
            const callbackUrl = callbackUrlAfterMiddleware(pathAndQuery);
            expect(callbackUrl).toBe(expected);
            expect(canBeLocationHeader(callbackUrl as string)).toBe(true);
        });

        test("a request that would be another host is refused", () => {
            expect(callbackUrlAfterMiddleware("//evil.com/x")).toBeNull();
            expect(callbackUrlAfterMiddleware("/\\evil.com")).toBeNull();
            expect(callbackUrlAfterMiddleware("/.//evil.com")).toBeNull();
            expect(callbackUrlAfterMiddleware("/a/..//evil.com")).toBeNull();
        });

        test("a request whose path holds an encoded slash is refused, so sign-in goes to the plans", () => {
            expect(callbackUrlAfterMiddleware("/plans/a%2Fb?q=%26")).toBeNull();
            expect(signInTarget(callbackUrlAfterMiddleware("/plans/a%2Fb?q=%26"))).toBe("/plans");
        });

        test("the auth pages are refused: the middleware leaves them public, so they would loop", () => {
            for (const path of [
                "/auth",
                "/auth/signin",
                "/AUTH/x",
                "/auth?x=1",
                "/auth/error?error=AccessDenied",
            ]) {
                expect(callbackUrlAfterMiddleware(path)).toBeNull();
            }
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

    describe("rejects a path that a browser resolves to another host", () => {
        // Next's router resolves a redirect against the page's URL before it
        // calls history.pushState, and resolving removes dot segments: these
        // become "//evil.example/...", which a browser reads as another host.
        const resolvedElsewhere: [string, string][] = [
            ["a dot segment before two slashes", "/.//evil.example/phish"],
            ["a dot-dot segment before two slashes", "/a/..//x"],
            ["a dot segment and a backslash", "/.\\/x"],
            ["dot-dot segments back to the root", "/a/b/../..//x"],
            ["a dot-dot segment at the root", "/..//x"],
            ["an encoded dot segment", "/%2e//evil.example/phish"],
            ["an encoded dot segment, in capitals", "/%2E//evil.example/phish"],
            ["an encoded dot-dot segment", "/a/%2e%2e//x"],
            ["a half-encoded dot-dot segment", "/a/.%2E//x"],
            ["a dot-dot segment encoded the other way", "/a/%2e.//x"],
        ];

        test.each(resolvedElsewhere)("the URL parser resolves %s to //", (_name, value) => {
            expect(new URL(value, "https://x.test").pathname).toMatch(/^\/\//);
        });

        test.each(resolvedElsewhere)("rejects %s", (_name, value) => {
            expect(safeCallbackUrl(value)).toBeNull();
        });

        test.each([
            ["an encoded slash", "/%2F%2Fevil.example"],
            ["an encoded slash, in lower case", "/%2f%2fevil.example"],
            ["an encoded slash after a dot segment", "/.%2F/x"],
            ["an encoded slash after a dot-dot segment", "/a/..%2F/x"],
            ["an encoded backslash", "/%5C%5Cevil.example"],
            ["an encoded backslash, in lower case", "/.%5c/x"],
            ["an encoded dot and backslash", "/%2e%5c/x"],
            ["an encoded dot inside a segment", "/file%2Ename"],
        ])("rejects %s in the path, which a router that decodes it would make a separator", (_name, value) => {
            expect(safeCallbackUrl(value)).toBeNull();
        });

        test.each([
            ["in the path", "/a\\b"],
            ["in the query", "/plans?q=a\\b"],
            ["in the fragment", "/plans#a\\b"],
        ])("rejects a backslash %s", (_name, value) => {
            expect(safeCallbackUrl(value)).toBeNull();
        });

        test("keeps encoded slashes and dots in the query and the fragment, which are only data", () => {
            expect(safeCallbackUrl("/plans?r=%2F%2Fevil.com&d=%2E%2E")).toBe(
                "/plans?r=%2F%2Fevil.com&d=%2E%2E"
            );
            expect(safeCallbackUrl("/plans#%2e%2e%2f%5c")).toBe("/plans#%2e%2e%2f%5c");
        });

        test("accepts dot segments that stay on this site, unchanged", () => {
            expect(safeCallbackUrl("/a/../b")).toBe("/a/../b");
            expect(safeCallbackUrl("/./plans")).toBe("/./plans");
        });
    });

    describe("rejects the auth pages, which would loop", () => {
        test.each([
            "/auth",
            "/auth/",
            "/auth/signin",
            "/auth/signin?callbackUrl=%2Fplans",
            "/auth/error",
            "/auth/x/y?z=1",
            "/auth?x=1",
            "/auth#x",
            "/AUTH",
            "/AUTH/signin",
            "/Auth/signin",
            "/Auth?x",
        ])("rejects %j", (value) => {
            expect(safeCallbackUrl(value)).toBeNull();
        });

        test.each(["/x/../auth", "/x/../auth/signin", "/plans/../AUTH?x=1", "/./auth#x"])(
            "rejects %j, whose dot segments lead to the auth pages",
            (value) => {
                expect(safeCallbackUrl(value)).toBeNull();
            }
        );

        test("allows a path that only contains auth, or only starts with those letters", () => {
            expect(safeCallbackUrl("/plans/auth")).toBe("/plans/auth");
            expect(safeCallbackUrl("/plans?next=/auth")).toBe("/plans?next=/auth");
            // These are ordinary pages the middleware protects, so a signed-out
            // visitor to one of them is sent to sign-in with it as callbackUrl.
            expect(safeCallbackUrl("/authors")).toBe("/authors");
            expect(safeCallbackUrl("/authorize?x=1")).toBe("/authorize?x=1");
            expect(safeCallbackUrl("/auth-callback")).toBe("/auth-callback");
            expect(safeCallbackUrl("/authx/y")).toBe("/authx/y");
        });
    });

    describe("agrees with the middleware matcher", () => {
        // The middleware sends a signed-out visitor to sign-in with the path as
        // callbackUrl, except for the paths its matcher leaves public. A
        // callbackUrl is therefore refused exactly when the matcher leaves the
        // path public and it is one of the auth pages (accepting one would loop
        // a signed-in visitor back to sign-in), and accepted for the rest.
        // /api/auth/..., /_next/... and favicon.ico are public too, but nobody
        // is sent back to them, so they are not covered here.
        const protectedByMiddleware = middlewareMatcher();
        const pathnameOf = (path: string): string => path.split(/[?#]/)[0];

        test("the matcher was read correctly", () => {
            expect(protectedByMiddleware.test("/")).toBe(true);
            expect(protectedByMiddleware.test("/plans")).toBe(true);
            expect(protectedByMiddleware.test("/authors")).toBe(true);
            expect(protectedByMiddleware.test("/auth")).toBe(false);
            expect(protectedByMiddleware.test("/auth/signin")).toBe(false);
            expect(protectedByMiddleware.test("/api/auth/session")).toBe(false);
        });

        test.each([
            "/auth",
            "/auth/",
            "/auth/signin",
            "/auth/error?error=AccessDenied",
            "/auth?x=1",
            "/auth#x",
            "/AUTH/x",
            "/Auth",
            "/authors",
            "/authorize",
            "/authorize?x=1",
            "/author/1",
            "/auth-callback",
            "/authx/y",
            "/Authors/1",
            "/plans",
            "/plans/auth",
            "/unused-hymns?book=great",
            "/",
        ])("%j is accepted exactly when the middleware protects it", (path) => {
            expect(safeCallbackUrl(path) !== null).toBe(
                protectedByMiddleware.test(pathnameOf(path))
            );
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
            ["a Japanese character", "/\u65e5"],
            ["U+2028 line separator", "/\u2028"],
            ["a full-width solidus", "/\uff0f"],
            ["a full-width solidus pair that reads as //", "\uff0f\uff0fevil.com"],
            ["a full-width solidus after the slash", "/\uff0fevil.com"],
            ["an emoji", "/\u{1f600}"],
            ["a lone surrogate", "/\ud800"],
            ["U+0100", "/\u0100"],
            ["a zero-width space", "/pl\u200bans"],
            ["a right-to-left override", "/\u202eplans"],
            ["a Latin-1 letter (Node would accept it, browsers would garble it)", "/caf\u00e9"],
            ["U+00FF", "/\u00ff"],
            ["a no-break space", "/pl\u00a0ans"],
            ["a space", "/plans/a b"],
            ["a space right after the slash", "/ plans"],
            ["a trailing space", "/plans "],
        ];

        test.each(refused)("rejects %s", (_name, value) => {
            expect(safeCallbackUrl(value)).toBeNull();
        });

        test.each([
            ["a Japanese character", "/\u65e5"],
            ["U+2028 line separator", "/\u2028"],
            ["a full-width solidus", "/\uff0f"],
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

describe("signInTarget", () => {
    test("is the callbackUrl when it is safe", () => {
        expect(signInTarget("/plans/1405391/98765/schedule?x=1")).toBe(
            "/plans/1405391/98765/schedule?x=1"
        );
        expect(signInTarget("/")).toBe("/");
        expect(signInTarget("/catalog?used=never")).toBe("/catalog?used=never");
    });

    test("takes the first of a parameter given several times", () => {
        expect(signInTarget(["/catalog", "/settings"])).toBe("/catalog");
        expect(signInTarget(["//evil.com", "/catalog"])).toBe("/plans");
    });

    test.each<[string, unknown]>([
        ["no callbackUrl", undefined],
        ["an empty one", ""],
        ["an empty list", []],
        ["another host", "//evil.com"],
        ["an auth page", "/auth/signin"],
        ["an absolute URL", "https://evil.com/plans"],
    ])("falls back to the plans list for %s", (_, value) => {
        expect(signInTarget(value)).toBe("/plans");
    });
});
