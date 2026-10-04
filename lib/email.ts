import "server-only";
import { createTransport } from "nodemailer";

/**
 * Email from the app, sent through Nodemailer over SMTP: a plan's songs,
 * sent to the staff on demand (lib/queries/email.ts). Two environment
 * variables set it up:
 *
 * - `SMTP_URL`: the SMTP server and its login, as a URL. `smtps://` is TLS
 *   from the start (port 465 unless the URL names one), as in
 *   `smtps://office%40example.org:app-password@smtp.gmail.com`; `smtp://`
 *   (port 587) must switch to TLS with STARTTLS before it sends a login.
 *   Percent-encode `@`, `:`, `/`, `%`, `#`, `?` and `$` in the user name and
 *   password (`@` is `%40`). It holds the password, so it is never shown,
 *   logged or put in an error message.
 * - `EMAIL_FROM`: who the email is from: an address, or `Name <address>`.
 *
 * Nothing opens a connection until `sendEmail`, which tests give a stand-in
 * transport instead.
 */

/** The environment variables email needs, in the order they are checked. */
export const EMAIL_VARIABLES = ["SMTP_URL", "EMAIL_FROM"] as const;

export type EmailVariable = (typeof EMAIL_VARIABLES)[number];

/**
 * Whether email can be sent, or which variables stop it: each one not set
 * (blank counts as not set) or not usable, an `SMTP_URL` that is not an
 * `smtp://` or `smtps://` URL with a host, or an `EMAIL_FROM` with no "@".
 */
export type EmailStatus =
    | { configured: true }
    | { configured: false; missing: EmailVariable[] };

/** One email: plain text, to every address in `to`. */
export interface EmailMessage {
    to: readonly string[];
    subject: string;
    text: string;
}

/** What the SMTP server did with an email it took. */
export interface SentEmail {
    /** The Message-ID it went out with. */
    messageId: string;
    /** The recipients the server took. */
    accepted: string[];
    /** The recipients the server refused; the email went to the others. */
    rejected: string[];
}

/** The mail a transport is given to send. */
export interface OutgoingMail {
    from: string;
    to: string[];
    subject: string;
    text: string;
}

/** A recipient as a transport reports it: an address, or Nodemailer's `{ name, address }`. */
export type ReportedAddress = string | { address: string };

/** What a transport says of an email it sent, as Nodemailer's SMTP transport does. */
export interface TransportReport {
    messageId?: string;
    accepted?: readonly ReportedAddress[];
    rejected?: readonly ReportedAddress[];
}

/**
 * What sends one email: Nodemailer's SMTP transport (`sendEmail` makes one
 * from `SMTP_URL`), or a stand-in that tests give `sendEmail`.
 */
export interface EmailTransport {
    sendMail(mail: OutgoingMail): Promise<TransportReport>;
    /** Release its connections, once the email is sent or has failed. */
    close?(): void;
}

/** Options for `sendEmail`. */
export interface SendEmailOptions {
    /** Send through this instead of an SMTP transport made from `SMTP_URL` (tests). */
    transport?: EmailTransport;
}

/**
 * Why an email was not sent. Its message is fit to show and to log: it never
 * holds `SMTP_URL` or its password, and the error Nodemailer threw is not
 * kept (as `cause` or otherwise), since it may.
 */
export class EmailError extends Error {
    /**
     * What kind of failure: Nodemailer's code, such as "EAUTH" (the login was
     * refused), "ECONNECTION" or "ETIMEDOUT"; "ECONFIG" when `SMTP_URL` or
     * `EMAIL_FROM` is missing or not usable; null when there is none.
     */
    readonly code: string | null;
    /** The SMTP server's reply code, such as 535; null when there is none. */
    readonly responseCode: number | null;

    constructor(
        message: string,
        { code = null, responseCode = null }: { code?: string | null; responseCode?: number | null } = {}
    ) {
        super(message);
        this.name = "EmailError";
        this.code = code;
        this.responseCode = responseCode;
    }
}

/**
 * How long one send waits for each step, so that a server that does not
 * answer fails the send in seconds rather than hold someone waiting for
 * minutes (Nodemailer's defaults: 2 minutes to connect, 10 of silence).
 */
const CONNECTION_TIMEOUT_MS = 15_000;
const GREETING_TIMEOUT_MS = 15_000;
const SOCKET_TIMEOUT_MS = 30_000;
const DNS_TIMEOUT_MS = 15_000;

/** The longest error detail kept, so a server's long reply stays readable. */
const MAX_DETAIL_LENGTH = 300;

/** What stands in for a secret in an error message. */
const REDACTED = "[redacted]";

/** The SMTP server and login that `SMTP_URL` names. */
interface SmtpServer {
    host: string;
    /** Null: the port its scheme implies (465 for smtps, 587 for smtp). */
    port: number | null;
    /** TLS from the start (smtps). */
    secure: boolean;
    /** Null when the URL names no login. */
    auth: { user: string; pass: string } | null;
}

/** What email is set up with. */
interface EmailConfig {
    server: SmtpServer;
    from: string;
    /** `SMTP_URL` and the forms of its password, to keep out of error messages. */
    secrets: string[];
}

/** A variable's value, trimmed, or null when it is not set or blank. */
function readVariable(name: EmailVariable): string | null {
    const value = process.env[name]?.trim() ?? "";
    return value === "" ? null : value;
}

/**
 * The server and login an `SMTP_URL` names, or null when it is not an
 * `smtp://` or `smtps://` URL with a host (or its login has a malformed
 * percent escape). Never throws: the URL parser's error would hold the URL.
 */
function parseSmtpUrl(value: string): SmtpServer | null {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        return null;
    }
    if (url.protocol !== "smtp:" && url.protocol !== "smtps:") {
        return null;
    }
    // An IPv6 host comes in brackets, which the socket does not want.
    const host = url.hostname.replace(/^\[(.*)\]$/, "$1");
    if (host === "") {
        return null;
    }
    let user: string;
    let pass: string;
    try {
        user = decodeURIComponent(url.username);
        pass = decodeURIComponent(url.password);
    } catch {
        return null;
    }
    return {
        host,
        port: url.port === "" ? null : Number(url.port),
        secure: url.protocol === "smtps:",
        auth: user === "" && pass === "" ? null : { user, pass },
    };
}

/**
 * The text an `SMTP_URL` must never be seen in: the URL, its password as
 * written and decoded, and the base64 forms a login sends it in (AUTH LOGIN
 * sends the password alone; AUTH PLAIN, NUL user NUL password), in case a
 * server's reply repeats them.
 */
function secretsOf(smtpUrl: string, server: SmtpServer): string[] {
    const secrets = [smtpUrl];
    if (server.auth) {
        const { user, pass } = server.auth;
        const nul = String.fromCharCode(0);
        secrets.push(
            pass,
            encodeURIComponent(pass),
            Buffer.from(pass).toString("base64"),
            Buffer.from(`${nul}${user}${nul}${pass}`).toString("base64")
        );
    }
    return secrets.filter((secret) => secret !== "");
}

/** What email is set up with, or the variables that are missing or not usable. */
function readEmailConfig():
    | { ok: true; config: EmailConfig }
    | { ok: false; missing: EmailVariable[] } {
    const smtpUrl = readVariable("SMTP_URL");
    const from = readVariable("EMAIL_FROM");
    const server = smtpUrl === null ? null : parseSmtpUrl(smtpUrl);
    const usableFrom = from !== null && from.includes("@") ? from : null;
    if (smtpUrl === null || server === null || usableFrom === null) {
        const missing: EmailVariable[] = [];
        if (server === null) {
            missing.push("SMTP_URL");
        }
        if (usableFrom === null) {
            missing.push("EMAIL_FROM");
        }
        return { ok: false, missing };
    }
    return {
        ok: true,
        config: { server, from: usableFrom, secrets: secretsOf(smtpUrl, server) },
    };
}

/**
 * Whether email is set up: "configured" when `SMTP_URL` and `EMAIL_FROM`
 * are both set and usable, or else which of them are not (see
 * `EmailStatus`). Reads only the environment: it connects to nothing.
 */
export function emailStatus(): EmailStatus {
    const read = readEmailConfig();
    return read.ok ? { configured: true } : { configured: false, missing: read.missing };
}

/** `text` with every secret replaced, on one line, cut short when long. */
function safeDetail(text: string, secrets: readonly string[]): string {
    let detail = text;
    for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
        detail = detail.split(secret).join(REDACTED);
    }
    detail = detail.split(/\s+/).join(" ").trim();
    return detail.length > MAX_DETAIL_LENGTH ? `${detail.slice(0, MAX_DETAIL_LENGTH)}…` : detail;
}

/**
 * An `EmailError` for what Nodemailer (or a stand-in) threw: `prefix`, then
 * its message with every secret taken out, and its code and the server's
 * reply code when they look like ones. Nothing else of it is kept.
 */
function toEmailError(error: unknown, secrets: readonly string[], prefix: string): EmailError {
    const raw = (typeof error === "object" && error !== null ? error : {}) as {
        message?: unknown;
        code?: unknown;
        responseCode?: unknown;
    };
    const detail = typeof raw.message === "string" ? safeDetail(raw.message, secrets) : "";
    const code =
        typeof raw.code === "string" && /^[A-Za-z0-9_]{1,40}$/.test(raw.code) ? raw.code : null;
    const responseCode =
        typeof raw.responseCode === "number" && Number.isInteger(raw.responseCode)
            ? raw.responseCode
            : null;
    return new EmailError(detail === "" ? `${prefix}.` : `${prefix}: ${detail}`, {
        code,
        responseCode,
    });
}

/**
 * An SMTP transport for `server`, which connects only when it sends. An
 * `smtp://` login must switch to TLS first (STARTTLS), so the password never
 * crosses the network in the clear; a server with no login may stay plain.
 */
function smtpTransport(server: SmtpServer): EmailTransport {
    const transporter = createTransport({
        host: server.host,
        ...(server.port === null ? {} : { port: server.port }),
        secure: server.secure,
        requireTLS: !server.secure && server.auth !== null,
        ...(server.auth === null ? {} : { auth: server.auth }),
        connectionTimeout: CONNECTION_TIMEOUT_MS,
        greetingTimeout: GREETING_TIMEOUT_MS,
        socketTimeout: SOCKET_TIMEOUT_MS,
        dnsTimeout: DNS_TIMEOUT_MS,
    });
    return {
        sendMail: (mail) => transporter.sendMail(mail),
        close: () => transporter.close(),
    };
}

/** The addresses a transport reported, as plain addresses. */
function addressesOf(reported: readonly ReportedAddress[] | undefined): string[] {
    return (reported ?? []).map((entry) => (typeof entry === "string" ? entry : entry.address));
}

/**
 * Send `message` from `EMAIL_FROM` through the SMTP server `SMTP_URL` names
 * (or through `transport`), one connection for the one email. Resolves to
 * what the server did with it: its Message-ID, and the recipients it took
 * and refused (it refuses all of them only by failing).
 *
 * Throws an `EmailError`, sending nothing, when `SMTP_URL` or `EMAIL_FROM`
 * is missing or not usable, or the message has no recipients; and an
 * `EmailError` when the send fails (a refused login, a server that cannot
 * be reached or does not answer in time, every recipient refused). Its
 * message never holds `SMTP_URL` or its password.
 */
export async function sendEmail(
    message: EmailMessage,
    { transport }: SendEmailOptions = {}
): Promise<SentEmail> {
    const read = readEmailConfig();
    if (!read.ok) {
        throw new EmailError(
            `Email is not set up: set ${read.missing.join(" and ")} on the server.`,
            { code: "ECONFIG" }
        );
    }
    const { server, from, secrets } = read.config;
    if (message.to.length === 0) {
        throw new EmailError("The email has no recipients, so it was not sent.");
    }
    let sender: EmailTransport;
    try {
        sender = transport ?? smtpTransport(server);
    } catch (error) {
        throw toEmailError(error, secrets, "Could not set up the email transport");
    }
    try {
        const report = await sender.sendMail({
            from,
            to: [...message.to],
            subject: message.subject,
            text: message.text,
        });
        return {
            messageId: report.messageId ?? "",
            accepted: addressesOf(report.accepted),
            rejected: addressesOf(report.rejected),
        };
    } catch (error) {
        throw toEmailError(error, secrets, "Could not send the email");
    } finally {
        try {
            sender.close?.();
        } catch {
            // Nothing to release: the send is over either way.
        }
    }
}
