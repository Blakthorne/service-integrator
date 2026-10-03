import "server-only";

declare const pcoIdBrand: unique symbol;

/** A string that has been checked to look like a PCO ID (see parsePcoId). */
export type PcoId = string & { readonly [pcoIdBrand]: true };

/** PCO IDs are positive integers: no sign, no leading zero, at most 20 digits. */
const PCO_ID_PATTERN = /^[1-9][0-9]{0,19}$/;

/**
 * Check a value from outside (a URL segment, a query parameter) before it goes
 * anywhere near a PCO request path. Returns it as a PcoId, or null when it is
 * not a plain decimal ID, e.g. "", "0", "01", "1e3", " 1", "../1", full-width
 * digits, more than 20 digits, or not a string at all.
 */
export function parsePcoId(raw: unknown): PcoId | null {
    return typeof raw === "string" && PCO_ID_PATTERN.test(raw)
        ? (raw as PcoId)
        : null;
}

/** Thrown by assertPcoId; orNotFound turns it into a 404. */
export class InvalidPcoIdError extends Error {
    constructor(raw: unknown) {
        // JSON-quoted and truncated, so a hostile value cannot forge log lines.
        super(
            `Invalid Planning Center ID: ${JSON.stringify(String(raw).slice(0, 40))}`
        );
        this.name = "InvalidPcoIdError";
    }
}

/**
 * Like parsePcoId, but throws InvalidPcoIdError instead of returning null.
 * Every getter calls this on its ID arguments before building a request path.
 */
export function assertPcoId(raw: unknown): PcoId {
    const id = parsePcoId(raw);
    if (id === null) {
        throw new InvalidPcoIdError(raw);
    }
    return id;
}
