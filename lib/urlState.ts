/**
 * Parse a `?page=` value into a 1-based page number.
 *
 * Only plain ASCII digits count, and the number must be a safe integer of at
 * least 1. Everything else ("", "0", "-1", "1.5", "1e2", "+2", " 2", "abc",
 * a missing parameter) is page 1. Leading zeros are fine ("007" is 7).
 *
 * When `totalPages` is given, the result is clamped to it. The clamp never goes
 * below 1, so an empty list is still page 1. A `totalPages` that is not a
 * finite number is ignored, and a fractional one is rounded down.
 */
export function parsePage(value: string | null, totalPages?: number): number {
    let page = 1;
    if (typeof value === "string" && /^[0-9]+$/.test(value)) {
        const parsed = Number(value);
        if (Number.isSafeInteger(parsed) && parsed >= 1) {
            page = parsed;
        }
    }
    if (totalPages !== undefined && Number.isFinite(totalPages)) {
        page = Math.min(page, Math.max(1, Math.floor(totalPages)));
    }
    return page;
}

/**
 * Narrow a query-string value to one of `allowed`, or `fallback` when it is
 * missing or not listed. The comparison is exact (case-sensitive).
 */
export function parseEnum<T extends string>(
    value: string | null,
    allowed: readonly T[],
    fallback: T
): T {
    return allowed.find((candidate) => candidate === value) ?? fallback;
}

/**
 * Apply `updates` to a query string and return the new one, with its leading
 * "?", or "" when no parameters are left.
 *
 * A `null` value deletes the key. Any other value sets it: an existing key is
 * updated in place (so the order of the other keys is preserved) and a new key
 * goes at the end. Setting a key that appears several times leaves one entry.
 * The result is re-serialized form-style, so a space becomes "+".
 *
 * `search` is typically `window.location.search`; a leading "?" is optional.
 */
export function withSearchParams(
    search: string,
    updates: Record<string, string | null>
): string {
    const params = new URLSearchParams(search);
    for (const [key, value] of Object.entries(updates)) {
        if (value === null) {
            params.delete(key);
        } else {
            params.set(key, value);
        }
    }
    const next = params.toString();
    return next === "" ? "" : `?${next}`;
}
