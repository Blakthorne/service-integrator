import type { ExpectedPlanEmail } from "./queries/email";
import { EMAIL_RECIPIENTS_MAX } from "./settings";

/**
 * The email the Email dialog's preview showed, as its Send sends it back
 * (`{ to, subject, text }`), for `sendPlanEmail` to hold the send to: it
 * refuses, sending nothing, when the recipients or the subject are no
 * longer these. It comes from a browser, so the send action reads it
 * first. Pure and safe on both sides.
 */

/**
 * The previewed email in `value`, as an action receives it, from the
 * network, so it may be anything: an object with a list of at most
 * `EMAIL_RECIPIENTS_MAX` text recipients (the most the settings hold), a
 * text subject and a text body, rebuilt from those three fields alone
 * (anything else the browser sent is dropped). Null for anything else. It
 * checks the shape only: `sendPlanEmail` compares it with the email as it
 * reads now.
 */
export function readPreviewedPlanEmail(value: unknown): ExpectedPlanEmail | null {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return null;
    }
    const { to, subject, text } = value as Record<string, unknown>;
    if (
        !Array.isArray(to) ||
        to.length > EMAIL_RECIPIENTS_MAX ||
        !to.every((address) => typeof address === "string") ||
        typeof subject !== "string" ||
        typeof text !== "string"
    ) {
        return null;
    }
    return { to: [...to], subject, text };
}
