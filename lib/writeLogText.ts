import type { WriteLogEntry, WriteLogKind } from "./db/writeLog";

/**
 * A row of the write log in words, for the Settings page's "Recent writes":
 * what was done, to which plan and item, and how it went.
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

/**
 * The plan, and the item in it, a write was made to, as the log recorded
 * them (not checked as ids). A song added to a plan that Planning Center
 * refused made no item, so it has none.
 */
export interface WritePlace {
    serviceTypeId: string;
    planId: string;
    itemId: string | null;
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

/** Text quoted for a sentence: a note, a title, a name. */
function quote(text: string): string {
    return `"${text}"`;
}

/** What a kind's reader makes of a row: what was done, what it wrote, and where; null for a place the row does not say. */
interface Described {
    what: string;
    detail: string | null;
    place: WritePlace | null;
}

/** What a hymnal note write did, from its payload; null when the payload is not one this build knows. */
function describeItemNote(payload: unknown): Described | null {
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
 * What a plan's email row says, from its payload and result: who it was
 * sent to and its subject (never its text: the log does not keep it), and
 * who the mail server refused. Null when the payload is not one this build
 * knows (an empty one, or a newer build's), so the row keeps its kind and
 * its target.
 */
function describeEmail(payload: unknown, result: unknown): Described | null {
    const record = asRecord(payload);
    if (record === null) {
        return null;
    }
    const to = textsOf(record.to);
    const subject = asText(record.subject);
    if (to.length === 0 && subject === null) {
        return null;
    }
    const sentTo =
        to.length === 0
            ? `Subject ${quote(subject ?? "")}.`
            : subject === null
              ? `To ${to.join(", ")}.`
              : `To ${to.join(", ")}: ${quote(subject)}.`;
    const refused = textsOf(asRecord(result)?.rejected);
    return {
        what: "Sent a plan's email",
        detail: refused.length > 0 ? `${sentTo} The mail server refused ${refused.join(", ")}.` : sentTo,
        place: null,
    };
}

/**
 * What a write to a Planning Center song says, from its payload (the
 * `action` that `lib/queries/pcoSongs.ts` logs it with): credits saved from
 * the credit editor, a song created, its CCLI number set, and the typed
 * title and credits written back over the ones CCLI replaced them with. Null
 * when the payload is not one of these or lacks what its words need (the
 * song's title), so the row keeps its kind and its target.
 */
function describeSong(payload: unknown): Described | null {
    const record = asRecord(payload);
    if (record === null) {
        return null;
    }
    const title = asText(record.title);
    switch (record.action) {
        case "credits": {
            const author = asText(record.author);
            const previous = asText(record.previous);
            return title === null
                ? null
                : {
                      what: `Credits saved for ${quote(title)}`,
                      detail:
                          author === null
                              ? null
                              : previous === null
                                ? `Now ${quote(author)}.`
                                : `Was ${quote(previous)}; now ${quote(author)}.`,
                      place: null,
                  };
        }
        case "create": {
            const author = asText(record.author);
            const copyright = asText(record.copyright);
            const given = [
                author === null ? null : `the credits ${quote(author)}`,
                copyright === null ? null : `the copyright ${quote(copyright)}`,
            ].filter((part) => part !== null);
            return title === null
                ? null
                : {
                      what: `Song ${quote(title)} created in Planning Center`,
                      detail: given.length === 0 ? null : `With ${given.join(" and ")}.`,
                      place: null,
                  };
        }
        case "ccli-number": {
            const { ccliNumber } = record;
            return title === null
                ? null
                : {
                      what: `CCLI number set on ${quote(title)}`,
                      detail:
                          typeof ccliNumber === "number" && Number.isInteger(ccliNumber)
                              ? `CCLI song number ${ccliNumber}.`
                              : null,
                      place: null,
                  };
        }
        case "restore-typed-details": {
            const typed = asRecord(record.typed);
            const fromCcli = asRecord(record.fromCcli);
            const typedTitle = asText(typed?.title);
            const typedAuthor = asText(typed?.author);
            if (typedTitle === null && typedAuthor === null) {
                return null;
            }
            const fromTitle = asText(fromCcli?.title);
            const fromAuthor = asText(fromCcli?.author);
            const changes = [
                typedTitle === null
                    ? null
                    : fromTitle === null
                      ? `Title now ${quote(typedTitle)}.`
                      : `Title was ${quote(fromTitle)}; now ${quote(typedTitle)}.`,
                typedAuthor === null
                    ? null
                    : fromAuthor === null
                      ? `Credits now ${quote(typedAuthor)}.`
                      : `Credits were ${quote(fromAuthor)}; now ${quote(typedAuthor)}.`,
            ].filter((part) => part !== null);
            const fields =
                typedTitle !== null && typedAuthor !== null
                    ? "title and credits"
                    : typedTitle !== null
                      ? "title"
                      : "credits";
            return {
                what: `Typed ${fields} written back over CCLI's`,
                detail: changes.join(" "),
                place: null,
            };
        }
        default:
            return null;
    }
}

/**
 * What a song added to a plan says, from its payload and result: the song's
 * title and the plan's date, with the arrangement it was added with, and the
 * plan and the item made (a refused write made none) to link to. Null when
 * the payload is not an add or lacks the title or the date.
 */
function describeItem(payload: unknown, result: unknown): Described | null {
    const record = asRecord(payload);
    if (record === null || record.action !== "add-song") {
        return null;
    }
    const title = asText(record.title);
    const planDates = asText(record.planDates);
    if (title === null || planDates === null) {
        return null;
    }
    const arrangement = asText(record.arrangement);
    const serviceTypeId = asText(record.serviceTypeId);
    const planId = asText(record.planId);
    return {
        what: `${quote(title)} added to the plan for ${planDates}`,
        detail: arrangement === null ? null : `With the arrangement ${quote(arrangement)}.`,
        place:
            serviceTypeId === null || planId === null
                ? null
                : {
                      serviceTypeId,
                      planId,
                      itemId: asText(asRecord(asRecord(result)?.item)?.id),
                  },
    };
}

/**
 * A payload's list of tags in words: their names (their ids for one with no
 * name), or "no tags" for an empty list; null when it is not a list, or has
 * tags that name nothing.
 */
function tagNames(value: unknown): string | null {
    if (!Array.isArray(value)) {
        return null;
    }
    const names = value.flatMap((tag) => {
        const record = asRecord(tag);
        return asText(record?.name) ?? asText(record?.id) ?? [];
    });
    if (names.length === 0) {
        return value.length === 0 ? "no tags" : null;
    }
    return names.join(", ");
}

/**
 * What a song's tags being set says, from its payload: the song's title, and
 * the tags it had and has now (`assign` replaces them all). Null when the
 * payload is not an assign or lacks the title.
 */
function describeTags(payload: unknown): Described | null {
    const record = asRecord(payload);
    if (record === null || record.action !== "assign") {
        return null;
    }
    const title = asText(record.title);
    if (title === null) {
        return null;
    }
    const now = tagNames(record.tags);
    const was = tagNames(record.previous);
    return {
        what: `Tags set on ${quote(title)}`,
        detail:
            now === null ? null : was === null ? `Now ${now}.` : `Was ${was}; now ${now}.`,
        place: null,
    };
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

/**
 * A failed write's reason as one line: Planning Center's reasons or the
 * error, then the status it answered with in brackets, unless the reason
 * already says it (an error's own text does: "responded with status: 500").
 */
export function describeFailureLine(outcome: Extract<WriteOutcome, { ok: false }>): string {
    const { message, status } = outcome;
    return status === null || message.includes(String(status))
        ? message
        : `${message} (Planning Center answered ${status})`;
}

/** What a row says of what it did, by its kind; null for a kind, or a payload, this build cannot read. */
function describeKind(row: WriteLogRow): Described | null {
    switch (row.kind) {
        case "item-note":
            return describeItemNote(row.payload);
        case "song":
            return describeSong(row.payload);
        case "item":
            return describeItem(row.payload, row.result);
        case "tags":
            return describeTags(row.payload);
        case "email":
            return describeEmail(row.payload, row.result);
        default:
            return null;
    }
}

/**
 * A row of the write log, in words. A row whose payload this build cannot
 * read, or that lacks a field its words need, says only its kind ("Song
 * write"), its target and how it went.
 */
export function describeWrite(row: WriteLogRow): WriteDescription {
    const described = describeKind(row);
    const kindWords = Object.hasOwn(KIND_WORDS, row.kind) ? KIND_WORDS[row.kind] : row.kind;
    return {
        what: described?.what ?? `${kindWords} write`,
        detail: described?.detail ?? null,
        place: described?.place ?? null,
        target: row.target,
        outcome: row.ok ? { ok: true } : { ok: false, ...describeFailure(row.result) },
    };
}
