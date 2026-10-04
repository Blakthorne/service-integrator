/**
 * Parsers for the catalog's IDs as they arrive in URLs, one per kind of ID
 * (beside `parsePcoId`, which checks Planning Center IDs). Pure and safe on
 * both sides: a page validates its params with them before any query, and a
 * client component may use them too.
 */

/** A catalog ID is a positive integer: no sign, no leading zero, at most 10 digits. */
const CATALOG_ID_PATTERN = /^[1-9][0-9]{0,9}$/;

/**
 * Check a catalog ID (a song's, tune's, hymn's or import run's) from a URL
 * segment or query parameter, as `parseCatalogId(params.songId) ?? notFound()`.
 * Returns the number, or null when the value is not a plain decimal ID: "",
 * "0", "01", "-1", "1.5", "1e3", " 1", full-width digits, more than 10
 * digits, or not a string at all.
 */
export function parseCatalogId(raw: unknown): number | null {
    return typeof raw === "string" && CATALOG_ID_PATTERN.test(raw)
        ? Number(raw)
        : null;
}

/** A book code is a letter, then up to 7 letters, digits, "_" or "-". */
const BOOK_CODE_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,7}$/;

/**
 * Check a book code ("R", "G", "CB") from a URL segment. Returns it as given
 * (books are looked up without regard to case), or null when it does not
 * look like a code: empty, starting with a digit or a symbol, longer than 8
 * characters, holding spaces, dots, slashes or non-ASCII letters, or not a
 * string at all.
 */
export function parseBookCode(raw: unknown): string | null {
    return typeof raw === "string" && BOOK_CODE_PATTERN.test(raw) ? raw : null;
}
