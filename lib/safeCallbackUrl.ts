const MAX_LENGTH = 2048;

// One leading "/" that is not followed by "/" or "\" (browsers read "//host"
// and "/\host" as another host), then printable ASCII only (0x21 to 0x7E).
const SAFE_PATH = /^\/(?![/\\])[\x21-\x7E]*$/;

/**
 * Validate a `callbackUrl` from a query string before redirecting to it, so
 * the sign-in page cannot be turned into an open redirect. Returns the value
 * unchanged when it is safe, or `null`.
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
 *   U+2028, a full-width "／") into the Location header, so `redirect()` would
 *   fail with a 500.
 *
 * Also rejected:
 * - anything starting with "/auth", in any letter case: those pages are
 *   public, and sending a signed-in user back to the sign-in page would loop;
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
    if (value.toLowerCase().startsWith("/auth")) {
        return null;
    }
    return value;
}
