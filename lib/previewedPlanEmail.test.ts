import { describe, expect, test } from "vitest";
import { readPreviewedPlanEmail } from "./previewedPlanEmail";
import type { PlanEmailPreview } from "./queries/email";
import { EMAIL_RECIPIENTS_MAX } from "./settings";

/** A preview as the dialog has it: set up, with recipients. */
const PREVIEW: PlanEmailPreview = {
    configured: true,
    to: ["pastor@example.org", "music@example.org"],
    subject: "Songs for 10/4/26 - Sunday Morning",
    text: "October 4, 2026 - Sunday Morning\n\nSunday AM\n",
};

/** `n` distinct addresses. */
function addresses(n: number): string[] {
    return Array.from({ length: n }, (_, i) => `staff${i}@example.org`);
}

describe("readPreviewedPlanEmail", () => {
    test("reads the recipients, the subject and the text, and drops anything else sent", () => {
        expect(
            readPreviewedPlanEmail({ ...PREVIEW, missing: ["SMTP_URL"], extra: { nested: true } })
        ).toEqual({ to: PREVIEW.to, subject: PREVIEW.subject, text: PREVIEW.text });
    });

    test("copies the recipients, so a later change to what was sent changes nothing", () => {
        const sent = { to: [...PREVIEW.to], subject: PREVIEW.subject, text: PREVIEW.text };
        const read = readPreviewedPlanEmail(sent);

        sent.to.push("intruder@example.org");
        expect(read?.to).toEqual(PREVIEW.to);
    });

    test("takes the text exactly as sent, spaces and line breaks included", () => {
        const text = "  Line one\r\n\n\tLine two  ";
        expect(readPreviewedPlanEmail({ ...PREVIEW, text })?.text).toBe(text);
        expect(readPreviewedPlanEmail({ ...PREVIEW, subject: "", text: "" })).toEqual({
            to: PREVIEW.to,
            subject: "",
            text: "",
        });
    });

    test("takes no recipients, and as many as the settings may hold", () => {
        expect(readPreviewedPlanEmail({ ...PREVIEW, to: [] })?.to).toEqual([]);
        expect(
            readPreviewedPlanEmail({ ...PREVIEW, to: addresses(EMAIL_RECIPIENTS_MAX) })?.to
        ).toHaveLength(EMAIL_RECIPIENTS_MAX);
    });

    test.each([
        ["nothing", undefined],
        ["null", null],
        ["text", JSON.stringify(PREVIEW)],
        ["a number", 42],
        ["a list", [PREVIEW]],
        ["recipients that are not a list", { ...PREVIEW, to: "pastor@example.org" }],
        ["a recipient that is not text", { ...PREVIEW, to: ["pastor@example.org", 7] }],
        ["a recipient that is null", { ...PREVIEW, to: [null] }],
        [
            "more recipients than the settings may hold",
            { ...PREVIEW, to: addresses(EMAIL_RECIPIENTS_MAX + 1) },
        ],
        ["no recipients field", { subject: PREVIEW.subject, text: PREVIEW.text }],
        ["a subject that is not text", { ...PREVIEW, subject: ["Songs"] }],
        ["no subject", { to: PREVIEW.to, text: PREVIEW.text }],
        ["a text that is not text", { ...PREVIEW, text: null }],
        ["no text", { to: PREVIEW.to, subject: PREVIEW.subject }],
    ])("refuses %s", (_name, value) => {
        expect(readPreviewedPlanEmail(value)).toBeNull();
    });
});
