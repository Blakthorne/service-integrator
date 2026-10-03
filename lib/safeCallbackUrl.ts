const MAX_LENGTH = 2048;

/**
 * Validate a `callbackUrl` from a query string before redirecting to it, so
 * the sign-in page cannot be turned into an open redirect. Returns the value
 * unchanged when it is safe, or `null`.
 *
 * Only a site-relative path is accepted: a string that starts with exactly one
 * "/". That rules out "//host" and "/\host" (browsers read both as another
 * host), absolute URLs, "javascript:" URLs and bare text.
 *
 * Also rejected:
 * - control characters anywhere (browsers strip tabs and newlines from URLs,
 *   so "/\t/host" would turn into "//host");
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
    if (value.length === 0 || value.length > MAX_LENGTH) {
        return null;
    }
    if (value[0] !== "/" || value[1] === "/" || value[1] === "\\") {
        return null;
    }
    if (/\p{Cc}/u.test(value)) {
        return null;
    }
    if (value.toLowerCase().startsWith("/auth")) {
        return null;
    }
    return value;
}
