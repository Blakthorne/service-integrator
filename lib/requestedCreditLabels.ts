import "server-only";
import type { CreditLabelAsked } from "./creditLabels";
import { parsePcoId } from "@/lib/pco";

/** The most labels one request may ask for: far more than the library has songs. */
export const MAX_REQUESTED_CREDIT_LABELS = 5000;

/** The longest author or label one may carry; Planning Center's are far shorter. */
const MAX_AUTHOR_LENGTH = 2000;

/**
 * The labels the Credits page asks for, as its action receives them: from
 * the browser, so anything at all. Each must be `{ pcoSongId, shownAuthor,
 * author }`, the id a Planning Center id (`parsePcoId`, convention 19), the
 * author shown text ("" for none) and the label non-empty text, each at
 * most 2000 characters; at most `MAX_REQUESTED_CREDIT_LABELS` of them, and
 * at least one. Null when any is not, so a tampered or stale page asks for
 * nothing. The query checks the rest against the database.
 */
export function readRequestedCreditLabels(value: unknown): CreditLabelAsked[] | null {
    if (!Array.isArray(value) || value.length === 0 || value.length > MAX_REQUESTED_CREDIT_LABELS) {
        return null;
    }
    const asked: CreditLabelAsked[] = [];
    for (const item of value) {
        if (typeof item !== "object" || item === null) {
            return null;
        }
        const { pcoSongId, shownAuthor, author } = item as Record<string, unknown>;
        const id = typeof pcoSongId === "string" ? parsePcoId(pcoSongId) : null;
        if (
            id === null ||
            typeof shownAuthor !== "string" ||
            shownAuthor.length > MAX_AUTHOR_LENGTH ||
            typeof author !== "string" ||
            author === "" ||
            author.length > MAX_AUTHOR_LENGTH
        ) {
            return null;
        }
        asked.push({ pcoSongId: id, shownAuthor, author });
    }
    return asked;
}
