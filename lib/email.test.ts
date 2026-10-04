import { inspect } from "node:util";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { createTransport } = vi.hoisted(() => ({ createTransport: vi.fn() }));
vi.mock("nodemailer", () => ({ createTransport }));

import {
    EmailError,
    emailStatus,
    sendEmail,
    type EmailTransport,
    type OutgoingMail,
    type TransportReport,
} from "./email";

/** The login in `SMTP_URL`: the user is office@example.org, the password s3cr:t$pass. */
const USER = "office@example.org";
const PASSWORD = "s3cr:t$pass";
const SMTP_URL = `smtps://office%40example.org:${encodeURIComponent(PASSWORD)}@smtp.example.org`;
const FROM = "Service Integrator <office@example.org>";

/** Every form of the password that must never be seen in an error. */
const SECRETS = [
    SMTP_URL,
    PASSWORD,
    encodeURIComponent(PASSWORD),
    Buffer.from(PASSWORD).toString("base64"),
    Buffer.from(`${String.fromCharCode(0)}${USER}${String.fromCharCode(0)}${PASSWORD}`).toString(
        "base64"
    ),
];

const MESSAGE = {
    to: ["pastor@example.org", "music@example.org"],
    subject: "Songs for 10/4/26 · Sunday Morning",
    text: "October 4, 2026 · Sunday Morning\n",
};

beforeEach(() => {
    // Whatever the shell has, each test starts with email not set up.
    vi.stubEnv("SMTP_URL", "");
    vi.stubEnv("EMAIL_FROM", "");
});

afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    createTransport.mockReset();
});

function configure(smtpUrl = SMTP_URL, from = FROM) {
    vi.stubEnv("SMTP_URL", smtpUrl);
    vi.stubEnv("EMAIL_FROM", from);
}

/** A stand-in transport that reports `report`, or fails with `failure`. */
function stubTransport(
    report: TransportReport = {
        messageId: "<1@example.org>",
        accepted: [...MESSAGE.to],
        rejected: [],
    },
    failure?: unknown
) {
    const sendMail = vi.fn(async (mail: OutgoingMail) => {
        void mail;
        if (failure !== undefined) {
            throw failure;
        }
        return report;
    });
    const close = vi.fn();
    const transport: EmailTransport = { sendMail, close };
    return { transport, sendMail, close };
}

/** Expect `error` to be an EmailError that shows no secret anywhere, and return it. */
function expectSafe(error: unknown): EmailError {
    expect(error).toBeInstanceOf(EmailError);
    const shown = [String((error as Error).message), inspect(error, { depth: 5 }), JSON.stringify(error)];
    for (const text of shown) {
        for (const secret of SECRETS) {
            expect(text).not.toContain(secret);
        }
    }
    expect((error as Error).cause).toBeUndefined();
    return error as EmailError;
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
    try {
        await promise;
    } catch (error) {
        return error;
    }
    throw new Error("expected a rejection");
}

describe("emailStatus", () => {
    test("is configured when SMTP_URL and EMAIL_FROM are set and usable", () => {
        configure();
        expect(emailStatus()).toEqual({ configured: true });
        configure("smtp://localhost:25", "office@example.org");
        expect(emailStatus()).toEqual({ configured: true });
        configure("  smtps://u:p@[2001:db8::1]:465  ", "  office@example.org  ");
        expect(emailStatus()).toEqual({ configured: true });
    });

    test("names every variable that is not set, a blank one included", () => {
        expect(emailStatus()).toEqual({ configured: false, missing: ["SMTP_URL", "EMAIL_FROM"] });
        configure("   ", FROM);
        expect(emailStatus()).toEqual({ configured: false, missing: ["SMTP_URL"] });
        configure(SMTP_URL, "");
        expect(emailStatus()).toEqual({ configured: false, missing: ["EMAIL_FROM"] });
    });

    test.each([
        ["no scheme", "smtp.example.org"],
        ["another scheme", "https://office:pass@smtp.example.org"],
        ["no host", "smtps://"],
        ["no slashes", "smtps:office:pass@smtp.example.org"],
        ["a malformed escape in the password", "smtps://office:%E0%A4%A@smtp.example.org"],
    ])("counts an SMTP_URL with %s as not usable", (_case, smtpUrl) => {
        configure(smtpUrl);
        expect(emailStatus()).toEqual({ configured: false, missing: ["SMTP_URL"] });
    });

    test("counts an EMAIL_FROM with no address in it as not usable", () => {
        configure(SMTP_URL, "Service Integrator");
        expect(emailStatus()).toEqual({ configured: false, missing: ["EMAIL_FROM"] });
    });
});

describe("sendEmail", () => {
    test("sends the message from EMAIL_FROM, says what the server did, and closes the transport", async () => {
        configure();
        const { transport, sendMail, close } = stubTransport({
            messageId: "<1@example.org>",
            accepted: ["pastor@example.org"],
            rejected: [{ address: "music@example.org" }],
        });

        await expect(sendEmail(MESSAGE, { transport })).resolves.toEqual({
            messageId: "<1@example.org>",
            accepted: ["pastor@example.org"],
            rejected: ["music@example.org"],
        });
        expect(sendMail).toHaveBeenCalledWith({
            from: FROM,
            to: ["pastor@example.org", "music@example.org"],
            subject: MESSAGE.subject,
            text: MESSAGE.text,
        });
        expect(close).toHaveBeenCalledOnce();
        expect(createTransport).not.toHaveBeenCalled();
    });

    test("gives what a transport leaves out as empty", async () => {
        configure();
        const { transport } = stubTransport({});
        await expect(sendEmail(MESSAGE, { transport })).resolves.toEqual({
            messageId: "",
            accepted: [],
            rejected: [],
        });
    });

    test("refuses, sending nothing, when email is not set up", async () => {
        vi.stubEnv("SMTP_URL", SMTP_URL);
        const { transport, sendMail } = stubTransport();
        const error = expectSafe(await caught(sendEmail(MESSAGE, { transport })));
        expect(error.message).toBe("Email is not set up: set EMAIL_FROM on the server.");
        expect(error.code).toBe("ECONFIG");

        vi.stubEnv("SMTP_URL", "https://office:pass@smtp.example.org");
        expect((await caught(sendEmail(MESSAGE, { transport })) as Error).message).toBe(
            "Email is not set up: set SMTP_URL and EMAIL_FROM on the server."
        );
        expect(sendMail).not.toHaveBeenCalled();
    });

    test("refuses a message with no recipients, sending nothing", async () => {
        configure();
        const { transport, sendMail } = stubTransport();
        const error = await caught(sendEmail({ ...MESSAGE, to: [] }, { transport }));
        expect(error).toBeInstanceOf(EmailError);
        expect((error as Error).message).toBe("The email has no recipients, so it was not sent.");
        expect(sendMail).not.toHaveBeenCalled();
    });

    test("fails with what went wrong, its code and the server's reply code, never the password", async () => {
        configure();
        const failure = Object.assign(
            new Error(
                `Invalid login: 535-5.7.8 Username and Password not accepted for ${USER}\r\n` +
                    `535 5.7.8 AUTH PLAIN ${SECRETS[4]} (${PASSWORD}, ${encodeURIComponent(PASSWORD)}, ${SECRETS[3]})`
            ),
            { code: "EAUTH", responseCode: 535, command: "AUTH PLAIN", input: SMTP_URL }
        );
        const { transport, close } = stubTransport(undefined, failure);

        const error = expectSafe(await caught(sendEmail(MESSAGE, { transport })));
        expect(error.message).toBe(
            "Could not send the email: Invalid login: 535-5.7.8 Username and Password not accepted for office@example.org " +
                "535 5.7.8 AUTH PLAIN [redacted] ([redacted], [redacted], [redacted])"
        );
        expect(error).toMatchObject({ name: "EmailError", code: "EAUTH", responseCode: 535 });
        expect(close).toHaveBeenCalledOnce();
    });

    test("never shows the URL, even in a message that holds it", async () => {
        configure();
        const { transport } = stubTransport(
            undefined,
            Object.assign(new TypeError(`Invalid URL: ${SMTP_URL}`), { code: "ERR_INVALID_URL" })
        );
        const error = expectSafe(await caught(sendEmail(MESSAGE, { transport })));
        expect(error.message).toBe("Could not send the email: Invalid URL: [redacted]");
        expect(error.code).toBe("ERR_INVALID_URL");
    });

    test("keeps a failure's detail to one short line, and leaves out a code that is not one", async () => {
        configure();
        const { transport } = stubTransport(
            undefined,
            Object.assign(new Error(`Greeting never received\n${"x".repeat(400)}`), {
                code: "E BAD\nCODE",
                responseCode: "421",
            })
        );
        const error = expectSafe(await caught(sendEmail(MESSAGE, { transport })));
        // 300 characters of detail, then an ellipsis.
        const detail = `Greeting never received ${"x".repeat(276)}`;
        expect(detail).toHaveLength(300);
        expect(error.message).toBe(`Could not send the email: ${detail}…`);
        expect(error).toMatchObject({ code: null, responseCode: null });
    });

    test("fails with a plain message for a failure that is not an Error", async () => {
        configure();
        const { transport } = stubTransport(undefined, `connect ECONNREFUSED ${SMTP_URL}`);
        const error = expectSafe(await caught(sendEmail(MESSAGE, { transport })));
        expect(error.message).toBe("Could not send the email.");
    });
});

describe("sendEmail through SMTP", () => {
    /** Make createTransport give a transporter that sends at once, or fails with `failure`. */
    function stubNodemailer(failure?: unknown) {
        const sendMail = vi.fn(async () => {
            if (failure !== undefined) {
                throw failure;
            }
            return { messageId: "<2@example.org>", accepted: [...MESSAGE.to], rejected: [] };
        });
        const close = vi.fn();
        createTransport.mockReturnValue({ sendMail, close });
        return { sendMail, close };
    }

    const TIMEOUTS = {
        connectionTimeout: 15_000,
        greetingTimeout: 15_000,
        socketTimeout: 30_000,
        dnsTimeout: 15_000,
    };

    test("connects with TLS from the start to an smtps:// server, with its login decoded", async () => {
        configure();
        const { sendMail, close } = stubNodemailer();

        await expect(sendEmail(MESSAGE)).resolves.toMatchObject({ messageId: "<2@example.org>" });
        expect(createTransport).toHaveBeenCalledWith({
            host: "smtp.example.org",
            secure: true,
            requireTLS: false,
            auth: { user: USER, pass: PASSWORD },
            ...TIMEOUTS,
        });
        expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ from: FROM }));
        expect(close).toHaveBeenCalledOnce();
    });

    test("requires STARTTLS before an smtp:// login, on the port the URL names", async () => {
        configure("smtp://office%40example.org:pass@smtp.example.org:587");
        stubNodemailer();
        await sendEmail(MESSAGE);
        expect(createTransport).toHaveBeenCalledWith({
            host: "smtp.example.org",
            port: 587,
            secure: false,
            requireTLS: true,
            auth: { user: USER, pass: "pass" },
            ...TIMEOUTS,
        });
    });

    test("lets a server with no login stay plain, and takes an IPv6 host out of its brackets", async () => {
        configure("smtp://[::1]:2525");
        stubNodemailer();
        await sendEmail(MESSAGE);
        expect(createTransport).toHaveBeenCalledWith({
            host: "::1",
            port: 2525,
            secure: false,
            requireTLS: false,
            ...TIMEOUTS,
        });
    });

    test("fails safely when the transport cannot be made or the send fails", async () => {
        configure();
        createTransport.mockImplementation(() => {
            throw new Error(`Bad options for ${SMTP_URL}`);
        });
        let error = expectSafe(await caught(sendEmail(MESSAGE)));
        expect(error.message).toBe("Could not set up the email transport: Bad options for [redacted]");

        createTransport.mockReset();
        stubNodemailer(Object.assign(new Error("Connection timeout"), { code: "ETIMEDOUT" }));
        error = expectSafe(await caught(sendEmail(MESSAGE)));
        expect(error).toMatchObject({
            message: "Could not send the email: Connection timeout",
            code: "ETIMEDOUT",
        });
    });
});
