import { describe, expect, test } from "vitest";
import type { PlanEmailPreview, SendPlanEmailResult } from "./queries/email";
import {
    EMAIL_DIALOG_DESCRIPTION,
    EMAIL_PENDING_TEXT,
    NO_RECIPIENTS_NOTICE,
    describeEmailSetup,
    describeEmailTransport,
    planEmailOutcomeView,
    planEmailPreviewView,
    recipientCount,
    sendButtonLabel,
} from "./planEmailText";

const RECIPIENTS = ["pastor@example.org", "music@example.org"];

/** A preview of an email that can go. */
function preview(fields: Partial<PlanEmailPreview> = {}): PlanEmailPreview {
    return {
        configured: true,
        to: RECIPIENTS,
        subject: "Songs for 10/4/26 · Sunday Morning",
        text: "October 4, 2026 · Sunday Morning\n",
        ...fields,
    };
}

describe("the dialog's static words", () => {
    test("say what the dialog does and what it is waiting for", () => {
        expect(EMAIL_DIALOG_DESCRIPTION).toContain("plain text");
        expect(EMAIL_DIALOG_DESCRIPTION).toContain("recipients in Settings");
        expect(EMAIL_PENDING_TEXT.previewing).toMatch(/Planning Center/);
        expect(EMAIL_PENDING_TEXT.sending).toMatch(/Sending/);
    });
});

describe("describeEmailSetup", () => {
    test("names both variables, what each holds, and where they go", () => {
        const setup = describeEmailSetup(["SMTP_URL", "EMAIL_FROM"]);
        expect(setup.headline).toBe("Email is not set up on the server, so nothing can be sent.");
        expect(setup.variables.map(({ name }) => name)).toEqual(["SMTP_URL", "EMAIL_FROM"]);
        expect(setup.variables[0].help).toContain("smtps://");
        expect(setup.variables[0].help).toContain("%40");
        expect(setup.variables[1].help).toContain("Name <address>");
        expect(setup.howTo).toBe(
            "Add SMTP_URL and EMAIL_FROM to the server's .env.production file (a deploy writes that file from the secrets of the same names) and restart the app."
        );
    });

    test("names only the variable that is missing", () => {
        const setup = describeEmailSetup(["EMAIL_FROM"]);
        expect(setup.variables).toEqual([
            { name: "EMAIL_FROM", help: expect.stringContaining("Name <address>") },
        ]);
        expect(setup.howTo).toContain("Add EMAIL_FROM to the server's .env.production");
        expect(setup.howTo).not.toContain("SMTP_URL");
    });

    test("still says what to check when no variable is named", () => {
        const setup = describeEmailSetup([]);
        expect(setup.variables).toEqual([]);
        expect(setup.howTo).toContain(".env.production");
    });

    test("never has a secret's value to show: only the variables' names and what they hold", () => {
        const setup = describeEmailSetup(["SMTP_URL", "EMAIL_FROM"]);
        expect(JSON.stringify(setup)).not.toMatch(/password@smtp\.example\.org\/|s3cret/);
    });
});

describe("recipientCount and sendButtonLabel", () => {
    test("pluralize", () => {
        expect(recipientCount(0)).toBe("0 recipients");
        expect(recipientCount(1)).toBe("1 recipient");
        expect(recipientCount(2)).toBe("2 recipients");
        expect(sendButtonLabel(1)).toBe("Send to 1 recipient");
        expect(sendButtonLabel(12)).toBe("Send to 12 recipients");
    });
});

describe("planEmailPreviewView", () => {
    test("offers Send for an email that is set up and has recipients", () => {
        expect(planEmailPreviewView(preview())).toEqual({
            headline: "Check the email below, then send it.",
            notices: [],
            canSend: true,
            sendLabel: "Send to 2 recipients",
            recipients: RECIPIENTS,
            subject: "Songs for 10/4/26 · Sunday Morning",
            text: "October 4, 2026 · Sunday Morning\n",
        });
    });

    test("explains email that is not set up, with what is missing, and offers no Send", () => {
        const view = planEmailPreviewView(
            preview({ configured: false, missing: ["SMTP_URL", "EMAIL_FROM"] })
        );
        expect(view.canSend).toBe(false);
        expect(view.headline).toBe("This email cannot be sent yet.");
        expect(view.notices).toEqual([
            { kind: "not-configured", setup: describeEmailSetup(["SMTP_URL", "EMAIL_FROM"]) },
        ]);
        // The email is still shown, as it would read.
        expect(view.recipients).toEqual(RECIPIENTS);
        expect(view.text).not.toBe("");
    });

    test("explains that there are no recipients, and offers no Send", () => {
        const view = planEmailPreviewView(preview({ to: [] }));
        expect(view.canSend).toBe(false);
        expect(view.notices).toEqual([{ kind: "no-recipients", message: NO_RECIPIENTS_NOTICE }]);
        expect(view.recipients).toEqual([]);
        expect(view.sendLabel).toBe("Send to 0 recipients");
    });

    test("gives both reasons when both hold, set-up first", () => {
        const view = planEmailPreviewView(preview({ configured: false, missing: ["EMAIL_FROM"], to: [] }));
        expect(view.notices.map(({ kind }) => kind)).toEqual(["not-configured", "no-recipients"]);
        expect(view.canSend).toBe(false);
    });

    test("takes a missing list that is absent, as a not-configured preview with nothing named", () => {
        const view = planEmailPreviewView(preview({ configured: false }));
        expect(view.notices).toEqual([{ kind: "not-configured", setup: describeEmailSetup([]) }]);
    });

    test("copies the recipients, so the view is its own", () => {
        const source = preview();
        const view = planEmailPreviewView(source);
        view.recipients.push("x@example.org");
        expect(source.to).toEqual(RECIPIENTS);
    });
});

describe("planEmailOutcomeView", () => {
    const SENT: SendPlanEmailResult = {
        ok: true,
        to: RECIPIENTS,
        subject: "Songs for 10/4/26 · Sunday Morning",
        accepted: RECIPIENTS,
        rejected: [],
    };

    test("says who the email went to when the server took it for everyone", () => {
        expect(planEmailOutcomeView(SENT)).toEqual({
            tone: "success",
            summary: "Sent to 2 recipients.",
            delivered: RECIPIENTS,
            refused: [],
            subject: "Songs for 10/4/26 · Sunday Morning",
            setup: null,
            settingsLink: false,
        });
        expect(planEmailOutcomeView({ ...SENT, to: [RECIPIENTS[0]], accepted: [RECIPIENTS[0]] }).summary).toBe(
            "Sent to 1 recipient."
        );
    });

    test("names the recipients the server refused, and warns, since the others still got it", () => {
        const view = planEmailOutcomeView({
            ...SENT,
            accepted: ["pastor@example.org"],
            rejected: ["music@example.org"],
        });
        expect(view).toMatchObject({
            tone: "warning",
            summary: "Sent to 1 of 2 recipients: the mail server refused 1.",
            delivered: ["pastor@example.org"],
            refused: ["music@example.org"],
        });
    });

    test("falls back to the recipients asked for when the server reports none either way", () => {
        const view = planEmailOutcomeView({ ...SENT, accepted: [], rejected: [] });
        expect(view).toMatchObject({
            tone: "success",
            summary: "Sent to 2 recipients.",
            delivered: RECIPIENTS,
        });
    });

    test("is an error when the server refused every recipient yet took the email", () => {
        const view = planEmailOutcomeView({ ...SENT, accepted: [], rejected: RECIPIENTS });
        expect(view).toMatchObject({
            tone: "error",
            summary: "The mail server refused every recipient, so no one got the email.",
            delivered: [],
            refused: RECIPIENTS,
        });
    });

    test("explains email that is not set up, with what to do", () => {
        const message = "Email is not set up: set SMTP_URL and EMAIL_FROM on the server.";
        expect(
            planEmailOutcomeView({
                ok: false,
                kind: "not-configured",
                missing: ["SMTP_URL", "EMAIL_FROM"],
                message,
            })
        ).toEqual({
            tone: "error",
            summary: message,
            delivered: [],
            refused: [],
            subject: null,
            setup: describeEmailSetup(["SMTP_URL", "EMAIL_FROM"]),
            settingsLink: false,
        });
    });

    test("points to Settings when there are no recipients", () => {
        const message = "No one would get this email: add its recipients in Settings first.";
        expect(planEmailOutcomeView({ ok: false, kind: "no-recipients", message })).toMatchObject({
            tone: "error",
            summary: message,
            settingsLink: true,
            setup: null,
        });
    });

    test.each(["unavailable", "failed"] as const)(
        "gives the message of a send that %s, as it is",
        (kind) => {
            const message = "Could not send the email: Invalid login.";
            expect(planEmailOutcomeView({ ok: false, kind, message })).toEqual({
                tone: "error",
                summary: message,
                delivered: [],
                refused: [],
                subject: null,
                setup: null,
                settingsLink: false,
            });
        }
    );
});

describe("describeEmailTransport", () => {
    test("says email is set up, without showing any value", () => {
        expect(describeEmailTransport({ configured: true })).toEqual({
            tone: "ok",
            status: "Set up on the server",
            detail:
                "SMTP_URL and EMAIL_FROM are both set, so Email this plan can send. Their values are never shown.",
            setup: null,
        });
    });

    test("says what is missing and how to set it up", () => {
        expect(describeEmailTransport({ configured: false, missing: ["SMTP_URL"] })).toEqual({
            tone: "warning",
            status: "Not set up on the server",
            detail: null,
            setup: describeEmailSetup(["SMTP_URL"]),
        });
    });
});
