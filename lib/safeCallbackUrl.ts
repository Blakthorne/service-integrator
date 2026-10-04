import { routes } from "./routes";

const MAX_LENGTH = 2048;

// One leading "/" that is not followed by "/" or "\" (browsers read "//host"
// and "/\host" as another host), then printable ASCII only (0x21 to 0x7E).
const SAFE_PATH = /^\/(?![/\\])[\x21-\x7E]*$/;

// A percent-encoded dot, slash or backslash ("%2E", "%2F", "%5C", in either
// case). The URL parser itself reads "%2E" as the dot of a "." or ".."
// segment, and a router that decodes a path turns "%2F" and "%5C" into
// separators.
const ENCODED_DOT_OR_SEPARATOR = /%(?:2[EeFf]|5[Cc])/;

// What a value is resolved against, to find the path a browser would go to.
// Any origin would do; ".invalid" is reserved, so it never names a real host.
const RESOLVE_BASE = "https://callback.invalid";

// The auth pages, in the path the value resolves to: "/auth" as a whole path
// segment, so "/auth" and "/auth/signin" match but "/authors" does not. This
// is the boundary the middleware matcher exempts from sign-in (auth/ and auth$
// in middleware.ts), and lib/safeCallbackUrl.test.ts checks the two against
// each other.
const AUTH_PAGES = /^\/auth(?:\/|$)/i;

/**
 * Validate a path from a query string or a form before redirecting to it (the
 * sign-in page's `callbackUrl`, the new-song form's `returnTo`), so neither
 * can be turned into an open redirect. Returns the value unchanged when it is
 * safe, or `null`.
 *
 * Only a site-relative path is accepted: a string that starts with exactly one
 * "/". That rules out "//host" and "/\host" (browsers read both as another
 * host), absolute URLs, "javascript:" URLs and bare text.
 *
 * After that slash only printable ASCII is allowed: no control characters, no
 * spaces and nothing above "~". The middleware builds `callbackUrl` from the
 * request's percent-encoded path and query, so a real deep link always passes.
 * Other characters are refused because
 * - browsers strip tabs and newlines from URLs, so "/\t/host" would turn into
 *   "//host";
 * - Node refuses to write a character above U+00FF (a Japanese character,
 *   U+2028, the full-width solidus U+FF0F) into the Location header, so `redirect()` would
 *   fail with a 500.
 *
 * The path must also stay a path once a browser resolves it. Next's router
 * resolves a redirect against the page's URL, which removes dot segments, so
 * "/.//evil.example" or "/a/..//evil.example" becomes "//evil.example", which
 * a browser reads as another host. The value is therefore resolved against a
 * dummy origin, and rejected unless it keeps that origin and its resolved
 * path does not start with "//". Also rejected, because they are never part
 * of a real deep link and can turn into separators or dot segments along the
 * way:
 * - a backslash anywhere: the URL parser reads "\" as "/" in a path, so
 *   "/.\/x" also resolves to "//x";
 * - a percent-encoded dot, slash or backslash in the path ("%2E", "%2F",
 *   "%5C", in either case): the URL parser reads "%2E" as a dot, and a router
 *   that decodes the path would make the others separators. In the query and
 *   the fragment they are only data, and stay ("?returnTo=%2Fcatalog").
 *
 * Also rejected:
 * - the auth pages: "/auth" itself and everything under it ("/auth/signin",
 *   "/auth?x=1", "/auth#x"), in any letter case, also when dot segments lead
 *   there ("/x/../auth"). The middleware leaves those public, and sending a
 *   signed-in user back to the sign-in page would loop. A path that merely
 *   starts with those letters, such as "/authors", is an ordinary protected
 *   page and is accepted;
 * - the empty string and anything over 2048 characters.
 *
 * Takes `unknown` because the value comes straight from `searchParams`, which
 * can hold a string, an array of strings or nothing.
 */
export function safeCallbackUrl(value: unknown): string | null {
    if (typeof value !== "string") {
        return null;
    }
    if (value.length > MAX_LENGTH || !SAFE_PATH.test(value)) {
        return null;
    }
    if (value.includes("\\")) {
        return null;
    }
    const path = value.split(/[?#]/, 1)[0];
    if (ENCODED_DOT_OR_SEPARATOR.test(path)) {
        return null;
    }
    let resolved: URL;
    try {
        resolved = new URL(value, RESOLVE_BASE);
    } catch {
        return null;
    }
    if (resolved.origin !== RESOLVE_BASE || resolved.pathname.startsWith("//")) {
        return null;
    }
    if (AUTH_PAGES.test(resolved.pathname)) {
        return null;
    }
    return value;
}

/**
 * Where the sign-in page sends a visitor once signed in, or at once when
 * already signed in: the `callbackUrl` it was given, when `safeCallbackUrl`
 * accepts it, otherwise the plans list. `searchParams` may hold the
 * parameter once, several times (the first counts) or not at all.
 */
export function signInTarget(callbackUrl: unknown): string {
    const value = Array.isArray(callbackUrl) ? callbackUrl[0] : callbackUrl;
    return safeCallbackUrl(value) ?? routes.plans();
}
