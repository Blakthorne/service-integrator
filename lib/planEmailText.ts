import type { EmailStatus, EmailVariable } from "./email";
// Types only: what the email's preview and send give the dialog.
import type { PlanEmailPreview, SendPlanEmailResult } from "./queries/email";

/**
 * The words of a plan's email on its pages: what the "Email this plan"
 * dialog says before a send (the email as it would go, and why it cannot),
 * what it says after (who got it, or why not), and how Settings explains
 * setting email up on the server. Pure and safe on both sides: the
 * components render what these return.
 */

/** What the dialog's status line says while an action runs. */
export const EMAIL_PENDING_TEXT = {
    previewing: "Reading the plan from Planning Center…",
    sending: "Sending the email…",
} as const;

/** What the dialog is for, under its title. */
export const EMAIL_DIALOG_DESCRIPTION =
    "Sends this plan's schedule and its songs' copyright text, as plain text, to the recipients in Settings.";

/** What each environment variable that email needs holds. */
const VARIABLE_HELP: Readonly<Record<EmailVariable, string>> = {
    SMTP_URL:
        "the mail server and its login, as a URL such as smtps://user:password@smtp.example.org (write @ and : in the user name or password as %40 and %3A)",
    EMAIL_FROM: "who the email is from: an address, or Name <address>",
};

/** How to set email up on the server, for what is missing: the dialog's and Settings' explanation. */
export interface EmailSetupText {
    /** What is wrong, in a sentence. */
    headline: string;
    /** The variables that are not set or not usable, each with what it holds. */
    variables: { name: EmailVariable; help: string }[];
    /** What to do about it. */
    howTo: string;
}

/**
 * Why email cannot be sent, and what to do: it is not set up on the server
 * because `missing` (`emailStatus`'s list: not set, or not usable) need to
 * be in the server's `.env.production`, which a deploy writes from the
 * secrets of the same names. The app reads them when it starts.
 */
export function describeEmailSetup(missing: readonly EmailVariable[]): EmailSetupText {
    const names = missing.join(" and ");
    return {
        headline: "Email is not set up on the server, so nothing can be sent.",
        variables: missing.map((name) => ({ name, help: VARIABLE_HELP[name] })),
        howTo:
            missing.length === 0
                ? "Check SMTP_URL and EMAIL_FROM in the server's .env.production, then restart the app."
                : `Add ${names} to the server's .env.production file (a deploy writes that file from the secrets of the same names) and restart the app.`,
    };
}

/** How Settings shows whether email can be sent. */
export interface EmailTransportText {
    /** Fine, or to be fixed. */
    tone: "ok" | "warning";
    /** A few words that do not rely on colour: "Set up on the server". */
    status: string;
    /** What to know, or null when the status says it all. */
    detail: string | null;
    /** What is missing and how to set it up, when it is not set up. */
    setup: EmailSetupText | null;
}

/**
 * Whether email can be sent, in words, for the Email card: set up on the
 * server (both variables are set and usable; their values are never
 * shown), or not, with what is missing (`describeEmailSetup`).
 */
export function describeEmailTransport(status: EmailStatus): EmailTransportText {
    if (status.configured) {
        return {
            tone: "ok",
            status: "Set up on the server",
            detail: "SMTP_URL and EMAIL_FROM are both set, so Email this plan can send. Their values are never shown.",
            setup: null,
        };
    }
    return {
        tone: "warning",
        status: "Not set up on the server",
        detail: null,
        setup: describeEmailSetup(status.missing),
    };
}

/** "1 recipient", "2 recipients". */
export function recipientCount(count: number): string {
    return `${count} ${count === 1 ? "recipient" : "recipients"}`;
}

/** What the Send button says: "Send to 2 recipients". */
export function sendButtonLabel(recipients: number): string {
    return `Send to ${recipientCount(recipients)}`;
}

/** Why a preview cannot be sent. */
export type PlanEmailNotice =
    /** Email is not set up on the server. */
    | { kind: "not-configured"; setup: EmailSetupText }
    /** The settings name no recipients: nobody would get it. */
    | { kind: "no-recipients"; message: string };

/** What the dialog shows of a preview. */
export interface PlanEmailPreviewView {
    /** What the dialog says first, which takes focus when the preview arrives. */
    headline: string;
    /** Why it cannot be sent, when it cannot; none when it can. */
    notices: PlanEmailNotice[];
    /** Whether Send is offered: email is set up and someone would get it. */
    canSend: boolean;
    /** The Send button's words. */
    sendLabel: string;
    /** Who it would go to. */
    recipients: string[];
    subject: string;
    /** The plain-text body, as it would be sent. */
    text: string;
}

/** What a preview says when it can be sent. */
const READY_HEADLINE = "Check the email below, then send it.";

/** What a preview says when it cannot be sent. */
const BLOCKED_HEADLINE = "This email cannot be sent yet.";

/** What a preview says when the settings name no recipients. */
export const NO_RECIPIENTS_NOTICE = "No one would get this email: no recipients are set yet.";

/**
 * A preview as the dialog shows it: the email as it would go, and, when it
 * cannot go, why (email not set up on the server, and no recipients), with
 * Send offered only when nothing stops it.
 */
export function planEmailPreviewView(preview: PlanEmailPreview): PlanEmailPreviewView {
    const notices: PlanEmailNotice[] = [];
    if (!preview.configured) {
        notices.push({ kind: "not-configured", setup: describeEmailSetup(preview.missing ?? []) });
    }
    if (preview.to.length === 0) {
        notices.push({ kind: "no-recipients", message: NO_RECIPIENTS_NOTICE });
    }
    const canSend = notices.length === 0;
    return {
        headline: canSend ? READY_HEADLINE : BLOCKED_HEADLINE,
        notices,
        canSend,
        sendLabel: sendButtonLabel(preview.to.length),
        recipients: [...preview.to],
        subject: preview.subject,
        text: preview.text,
    };
}

/** How a send went: done, done in part, or not done. */
export type PlanEmailTone = "success" | "warning" | "error";

/** What the dialog shows of a send's outcome. */
export interface PlanEmailOutcomeView {
    tone: PlanEmailTone;
    /** What happened, in a sentence; it takes focus, and is an alert unless the send succeeded. */
    summary: string;
    /** The addresses the mail server took the email for. */
    delivered: string[];
    /** The addresses the mail server refused; the others still got it. */
    refused: string[];
    /** The subject of the email that went out; null when none did. */
    subject: string | null;
    /** Set when email is not set up on the server: what to do. */
    setup: EmailSetupText | null;
    /** True when the way on is Settings (no recipients). */
    settingsLink: boolean;
}

function outcome(
    tone: PlanEmailTone,
    summary: string,
    rest: Partial<Omit<PlanEmailOutcomeView, "tone" | "summary">> = {}
): PlanEmailOutcomeView {
    return {
        tone,
        summary,
        delivered: [],
        refused: [],
        subject: null,
        setup: null,
        settingsLink: false,
        ...rest,
    };
}

/**
 * What a send came to, for the dialog: who the mail server took the email
 * for and who it refused, or, when nothing was sent, why not (the message
 * the action gave) and what to do about it.
 */
export function planEmailOutcomeView(result: SendPlanEmailResult): PlanEmailOutcomeView {
    if (result.ok) {
        const delivered =
            result.accepted.length > 0 || result.rejected.length > 0 ? result.accepted : result.to;
        const refused = result.rejected;
        const rest = { delivered, refused, subject: result.subject };
        if (delivered.length === 0) {
            return outcome(
                "error",
                "The mail server refused every recipient, so no one got the email.",
                rest
            );
        }
        if (refused.length > 0) {
            return outcome(
                "warning",
                `Sent to ${delivered.length} of ${recipientCount(delivered.length + refused.length)}: the mail server refused ${refused.length}.`,
                rest
            );
        }
        return outcome("success", `Sent to ${recipientCount(delivered.length)}.`, rest);
    }
    switch (result.kind) {
        case "not-configured":
            return outcome("error", result.message, { setup: describeEmailSetup(result.missing) });
        case "no-recipients":
            return outcome("error", result.message, { settingsLink: true });
        case "unavailable":
        case "busy":
        case "failed":
            return outcome("error", result.message);
    }
}
