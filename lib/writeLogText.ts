import type { WriteLogEntry, WriteLogKind } from "./db/writeLog";

/**
 * A row of the write log in words, for the Settings page's "Recent writes to
 * Planning Center": what was done, to which plan and item, and how it went.
 * The log keeps what each write asked for (`payload`) and what came of it
 * (`result`) as JSON, written by the `lib/queries` function that made the
 * write, so a row is read defensively: one this build cannot make sense of
 * (a newer build's) still has its kind, its target and its outcome.
 *
 * Pure and safe on both sides.
 */

/** What each kind of write is called. A new kind in `WRITE_LOG_KINDS` needs its words here. */
const KIND_WORDS: Readonly<Record<WriteLogKind, string>> = {
    "item-note": "Hymnal note",
    song: "Song",
    item: "Plan item",
    tags: "Song tags",
    email: "Email",
};

/** The plan and item a write was made to, as the log recorded them (not checked as ids). */
export interface WritePlace {
    serviceTypeId: string;
    planId: string;
    itemId: string;
}

/** How a write went: made, or refused or failed, with why. */
export type WriteOutcome =
    | { ok: true }
    | {
          ok: false;
          /** Planning Center's reasons, or the error, fit to show. */
          message: string;
          /** The status Planning Center answered with, when the log has it. */
          status: number | null;
      };

/** A row of the write log, in words. */
export interface WriteDescription {
    /** What was done: "Created a hymnal note". */
    what: string;
    /** What it wrote or replaced, in words; null when the row does not say. */
    detail: string | null;
    /** The plan and item it was done to; null when the row does not say, and `target` is all there is. */
    place: WritePlace | null;
    /** The log's own name for what was written: "plan 123 item 456". */
    target: string;
    outcome: WriteOutcome;
}

/** What `describeWrite` reads of a row. */
export type WriteLogRow = Pick<WriteLogEntry, "kind" | "target" | "ok" | "payload" | "result">;

/** What the outcome says when a failed write has no reason on record. */
export const NO_REASON_RECORDED = "No reason was recorded.";

function asRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

/** `value` when it is text that says something, else null. */
function asText(value: unknown): string | null {
    return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** The items of `value` that are text that says something. */
function textsOf(value: unknown): string[] {
    return Array.isArray(value) ? value.flatMap((item) => asText(item) ?? []) : [];
}

/** A note's text, quoted, for a sentence. */
function quote(text: string): string {
    return `"${text}"`;
}

/** What a hymnal note write did, from its payload; null when the payload is not one this build knows. */
function describeItemNote(
    payload: unknown
): { what: string; detail: string | null; place: WritePlace } | null {
    const record = asRecord(payload);
    if (record === null) {
        return null;
    }
    const serviceTypeId = asText(record.serviceTypeId);
    const planId = asText(record.planId);
    const itemId = asText(record.itemId);
    if (serviceTypeId === null || planId === null || itemId === null) {
        return null;
    }
    const place = { serviceTypeId, planId, itemId };
    const content = asText(record.content);
    const previous = asText(record.previous);
    switch (record.action) {
        case "create":
            return {
                what: "Created a hymnal note",
                detail: content === null ? null : `It says ${quote(content)}.`,
                place,
            };
        case "update":
            return {
                what: "Changed a hymnal note",
                detail:
                    content === null
                        ? null
                        : previous === null
                          ? `Now ${quote(content)}.`
                          : `Was ${quote(previous)}; now ${quote(content)}.`,
                place,
            };
        case "delete":
            return {
                what:
                    record.reason === "duplicate"
                        ? "Deleted an extra hymnal note"
                        : record.reason === "nothing-to-say"
                          ? "Deleted a hymnal note (its song has no numbers)"
                          : "Deleted a hymnal note",
                detail: previous === null ? null : `It said ${quote(previous)}.`,
                place,
            };
        default:
            return null;
    }
}

/**
 * Why a write failed, from its result: Planning Center's own reasons for a
 * 422 ("category: must exist"), else the error. A result in another shape
 * has no reason to give.
 */
function describeFailure(result: unknown): { message: string; status: number | null } {
    const record = asRecord(result);
    if (record === null) {
        return { message: NO_REASON_RECORDED, status: null };
    }
    const details = textsOf(record.details);
    const message = details.length > 0 ? details.join("; ") : (asText(record.error) ?? NO_REASON_RECORDED);
    const status =
        typeof record.status === "number" && Number.isInteger(record.status) ? record.status : null;
    return { message, status };
}

/** A row of the write log, in words. */
export function describeWrite(row: WriteLogRow): WriteDescription {
    const itemNote = row.kind === "item-note" ? describeItemNote(row.payload) : null;
    const kindWords = Object.hasOwn(KIND_WORDS, row.kind) ? KIND_WORDS[row.kind] : row.kind;
    return {
        what: itemNote?.what ?? `${kindWords} write`,
        detail: itemNote?.detail ?? null,
        place: itemNote?.place ?? null,
        target: row.target,
        outcome: row.ok ? { ok: true } : { ok: false, ...describeFailure(row.result) },
    };
}
