import "server-only";
import { getDb } from "@/lib/db";
import { errorMessage } from "@/lib/db/errors";
import { recordWrite, type NewWriteLogEntry } from "@/lib/db/writeLog";
import {
    EmailError,
    emailStatus,
    sendEmail,
    type EmailVariable,
    type SendEmailOptions,
} from "@/lib/email";
import { assertPcoId } from "@/lib/pco";
import { buildPlanEmail } from "@/lib/planEmail";
import { getPlanDetail } from "./plans";
import { getSettings } from "./settings";

/**
 * A plan's email to the staff: what the Email dialog shows
 * (`previewPlanEmail`), and the send (`sendPlanEmail`), which the write log
 * records without the email's text. The email is `buildPlanEmail`'s
 * (lib/planEmail.ts), and lib/email.ts sends it.
 */

/** What the Email dialog shows before anything is sent. */
export interface PlanEmailPreview {
    /** Whether email is set up on the server (`SMTP_URL` and `EMAIL_FROM`). */
    configured: boolean;
    /** When it is not: the variables that are missing or not usable. */
    missing?: EmailVariable[];
    /** Who it would go to: the `emailRecipients` setting, empty until some are saved. */
    to: string[];
    subject: string;
    /** The plain-text body. */
    text: string;
}

/**
 * Plan `planId`'s email as it would be sent now, with whether email is set
 * up and who it would go to. Reads the plan as its pages do
 * (`getPlanDetail`: four Planning Center requests, deduped within a request)
 * and the settings; sends nothing. A plan or service type that cannot be
 * read throws, as on the plan's pages.
 */
export async function previewPlanEmail(
    serviceTypeId: string,
    planId: string
): Promise<PlanEmailPreview> {
    const detail = await getPlanDetail(serviceTypeId, planId);
    const { settings } = getSettings();
    const { subject, text } = buildPlanEmail(detail, settings);
    const status = emailStatus();
    return {
        configured: status.configured,
        ...(status.configured ? {} : { missing: status.missing }),
        to: [...settings.emailRecipients],
        subject,
        text,
    };
}

/** What the write log records an email asked for: its recipients and subject, never its text. */
export interface EmailWritePayload {
    to: string[];
    subject: string;
}

/** What came of an email, as the write log records it. */
export type EmailWriteResult =
    /** Sent: its Message-ID, and the recipients the server took and refused. */
    | { messageId: string; accepted: string[]; rejected: string[] }
    /** Not sent: why, with Nodemailer's code and the server's reply code when there are some. */
    | { error: string; code?: string; responseCode?: number };

/** What `sendPlanEmail` did. */
export type SendPlanEmailResult =
    | {
          ok: true;
          /** Who it was sent to. */
          to: string[];
          subject: string;
          /** The recipients the server took. */
          accepted: string[];
          /** The recipients the server refused; the email went to the others. */
          rejected: string[];
      }
    /** Nothing was sent: email is not set up on the server. */
    | { ok: false; kind: "not-configured"; missing: EmailVariable[]; message: string }
    /** Nothing was sent: the settings name no recipients, or could not be read. */
    | { ok: false; kind: "no-recipients" | "unavailable"; message: string }
    /** The send failed; the write log records it. */
    | { ok: false; kind: "failed"; message: string };

/** What `sendPlanEmail` says when email is not set up. */
export function notConfiguredMessage(missing: readonly EmailVariable[]): string {
    return `Email is not set up: set ${missing.join(" and ")} on the server.`;
}

/** What `sendPlanEmail` says when no one would get the email. */
export const NO_RECIPIENTS_MESSAGE =
    "No one would get this email: add its recipients in Settings first.";

/** What the write log records of a failed send. */
function failureOf(error: unknown): Extract<EmailWriteResult, { error: string }> {
    if (error instanceof EmailError) {
        return {
            error: error.message,
            ...(error.code === null ? {} : { code: error.code }),
            ...(error.responseCode === null ? {} : { responseCode: error.responseCode }),
        };
    }
    return { error: errorMessage(error) };
}

/** Record a send; a failure to record is logged and changes nothing else. */
function logWrite(entry: NewWriteLogEntry): void {
    try {
        recordWrite(getDb(), entry);
    } catch (error) {
        console.error(`Failed to record an email (${entry.target}):`, error);
    }
}

/**
 * Send plan `planId`'s email to the recipients in the settings, now.
 *
 * It refuses, sending nothing, when email is not set up on the server, when
 * the settings name no recipients, and when the settings cannot be read.
 * Otherwise it reads the plan afresh (as `getPlanDetail` reads it for its
 * pages) and builds the email from what it finds, never from a preview,
 * then sends it (unpaced: someone is waiting, and it waits on the SMTP
 * server too). It records a `write_log` row (`email`) whether the send
 * worked or failed: the recipients and the subject it asked for, never the
 * text, and what came of it. `options.transport` stands in for SMTP in
 * tests.
 *
 * A failed send comes back as a value, with a message fit to show that
 * never holds `SMTP_URL`. Invalid ids, and a plan or service type that
 * cannot be read, throw before anything is sent.
 */
export async function sendPlanEmail(
    serviceTypeId: string,
    planId: string,
    options: SendEmailOptions = {}
): Promise<SendPlanEmailResult> {
    const st = assertPcoId(serviceTypeId);
    const plan = assertPcoId(planId);
    const status = emailStatus();
    if (!status.configured) {
        return {
            ok: false,
            kind: "not-configured",
            missing: status.missing,
            message: notConfiguredMessage(status.missing),
        };
    }
    const { settings, error } = getSettings();
    if (error !== null) {
        return {
            ok: false,
            kind: "unavailable",
            message: `The settings could not be read, so the email was not sent: ${error}`,
        };
    }
    const to = [...settings.emailRecipients];
    if (to.length === 0) {
        return { ok: false, kind: "no-recipients", message: NO_RECIPIENTS_MESSAGE };
    }

    const { subject, text } = buildPlanEmail(await getPlanDetail(st, plan), settings);
    const payload: EmailWritePayload = { to, subject };
    const target = `plan ${plan}`;
    try {
        const sent = await sendEmail({ to, subject, text }, options);
        logWrite({ kind: "email", target, ok: true, payload, result: sent });
        return { ok: true, to, subject, accepted: sent.accepted, rejected: sent.rejected };
    } catch (sendError) {
        // An EmailError's message never holds SMTP_URL, so it is safe to log and show.
        console.error(`Failed to email plan ${st}/${plan}:`, sendError);
        const result = failureOf(sendError);
        logWrite({ kind: "email", target, ok: false, payload, result });
        return { ok: false, kind: "failed", message: result.error };
    }
}
