import { inspect } from "node:util";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
    openTestDb,
    seedBook,
    seedEntry,
    seedHymn,
    seedSetting,
    seedSong,
} from "@/lib/db/testing";
import { recentWrites } from "@/lib/db/writeLog";
import type { EmailTransport, OutgoingMail, TransportReport } from "@/lib/email";
import {
    PCO_BASE,
    calledUrls,
    itemResource,
    json,
    listPage,
    planResource,
    serviceTypeResource,
    songResource,
    stubFetchRoutes,
    stubPcoCredentials,
} from "@/lib/pco/testing";

const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/lib/db", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/db")>()),
    getDb,
}));

import { NO_RECIPIENTS_MESSAGE, previewPlanEmail, sendPlanEmail } from "./email";

const MORNING = "1405391";
const PLAN = "81234567";
const RECIPIENTS = ["pastor@example.org", "music@example.org"];

/** SMTP_URL's password, which must never be seen outside lib/email.ts. */
const PASSWORD = "s3cret-pass";
const SMTP_URL = `smtps://office%40example.org:${PASSWORD}@smtp.example.org`;

const urls = {
    plan: `${PCO_BASE}/service_types/${MORNING}/plans/${PLAN}`,
    serviceType: `${PCO_BASE}/service_types/${MORNING}`,
    items: `${PCO_BASE}/service_types/${MORNING}/plans/${PLAN}/items?include=song,item_notes&per_page=100`,
    categories: `${PCO_BASE}/service_types/${MORNING}/item_note_categories?per_page=100`,
};

const songLink = (id: string) => ({ song: { data: { type: "Song" as const, id } } });

/** Plan 81234567 on October 4, 2026 in Sunday Morning, whose one song item has the title `title`. */
function stubPlan(title = "Amazing Grace") {
    return stubFetchRoutes({
        [urls.plan]: { data: planResource({ id: PLAN }, { dates: "October 4, 2026" }) },
        [urls.serviceType]: { data: serviceTypeResource({ name: "Sunday Morning" }, MORNING) },
        [urls.items]: listPage([itemResource("1", { title, sequence: 1 }, songLink("1001"))], {
            included: [
                songResource("1001", {
                    title: "Amazing Grace",
                    author: "John Newton",
                    copyright: "Public Domain",
                    admin: null,
                }),
            ],
        }),
        [urls.categories]: listPage([]),
    });
}

/** What the email's text is for the plan `stubPlan` stubs, with the song linked to R-396. */
function expectedText(title = "Amazing Grace"): string {
    return [
        "October 4, 2026 · Sunday Morning",
        "",
        "Sunday AM 10/4/26",
        "",
        `${title} (R-396)`,
        "",
        '"Amazing Grace" Words and Music by John Newton.',
        "Public Domain.",
        "Used by permission. CCLI Streaming License 1564484.",
        "",
    ].join("\n");
}

/** A stand-in for the SMTP transport, which reports `report` or fails with `failure`. */
function stubTransport(report?: TransportReport, failure?: unknown) {
    const sendMail = vi.fn(async (mail: OutgoingMail) => {
        void mail;
        if (failure !== undefined) {
            throw failure;
        }
        return report ?? { messageId: "<1@example.org>", accepted: [...RECIPIENTS], rejected: [] };
    });
    const transport: EmailTransport = { sendMail, close: vi.fn() };
    return { transport, sendMail };
}

let db: DatabaseSync;

beforeEach(() => {
    stubPcoCredentials();
    vi.stubEnv("SMTP_URL", SMTP_URL);
    vi.stubEnv("EMAIL_FROM", "Service Integrator <office@example.org>");
    db = openTestDb();
    getDb.mockReturnValue(db);
    seedSetting(db, "emailRecipients", RECIPIENTS);
    // The song is linked to a catalog song at R-396.
    seedEntry(db, {
        bookId: seedBook(db, { code: "R" }),
        songId: seedSong(db, {
            hymnId: seedHymn(db, { title: "Amazing Grace" }),
            pcoSongId: "1001",
            linkedBy: "manual",
            linkedAt: "2026-10-01T12:00:00.000Z",
        }),
        number: 396,
    });
});

afterEach(() => {
    db.close();
    getDb.mockReset();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

describe("previewPlanEmail", () => {
    test("gives the email as it would be sent now, to the recipients in the settings", async () => {
        const fetchMock = stubPlan();
        await expect(previewPlanEmail(MORNING, PLAN)).resolves.toEqual({
            configured: true,
            to: RECIPIENTS,
            subject: "Songs for 10/4/26 · Sunday Morning",
            text: expectedText(),
        });
        expect(calledUrls(fetchMock).sort()).toEqual(Object.values(urls).sort());
    });

    test("follows the subject template in the settings", async () => {
        stubPlan();
        seedSetting(db, "emailSubjectTemplate", "{service} songs, {date}");
        await expect(previewPlanEmail(MORNING, PLAN)).resolves.toMatchObject({
            subject: "Sunday Morning songs, 10/4/26",
        });
    });

    test("says which variables email lacks, and gives the email all the same", async () => {
        stubPlan();
        vi.stubEnv("SMTP_URL", "");
        vi.stubEnv("EMAIL_FROM", "");
        await expect(previewPlanEmail(MORNING, PLAN)).resolves.toEqual({
            configured: false,
            missing: ["SMTP_URL", "EMAIL_FROM"],
            to: RECIPIENTS,
            subject: "Songs for 10/4/26 · Sunday Morning",
            text: expectedText(),
        });
    });

    test("gives no recipients until some are saved", async () => {
        stubPlan();
        db.prepare("DELETE FROM settings").run();
        await expect(previewPlanEmail(MORNING, PLAN)).resolves.toMatchObject({ to: [] });
    });

    test("lets a plan Planning Center cannot find throw, as the plan's pages do", async () => {
        stubPlan();
        stubFetchRoutes({
            [urls.plan]: () => json({ errors: [] }, { status: 404 }),
            [urls.serviceType]: { data: serviceTypeResource({ name: "Sunday Morning" }, MORNING) },
            [urls.items]: () => json({ errors: [] }, { status: 404 }),
            [urls.categories]: listPage([]),
        });
        await expect(previewPlanEmail(MORNING, PLAN)).rejects.toMatchObject({
            name: "PcoError",
            status: 404,
        });
    });
});

describe("sendPlanEmail", () => {
    test("sends the plan's email to the recipients, and logs the recipients and subject, not the text", async () => {
        stubPlan();
        const { transport, sendMail } = stubTransport({
            messageId: "<1@example.org>",
            accepted: ["pastor@example.org"],
            rejected: ["music@example.org"],
        });

        await expect(sendPlanEmail(MORNING, PLAN, { transport })).resolves.toEqual({
            ok: true,
            to: RECIPIENTS,
            subject: "Songs for 10/4/26 · Sunday Morning",
            accepted: ["pastor@example.org"],
            rejected: ["music@example.org"],
        });
        expect(sendMail).toHaveBeenCalledWith({
            from: "Service Integrator <office@example.org>",
            to: RECIPIENTS,
            subject: "Songs for 10/4/26 · Sunday Morning",
            text: expectedText(),
        });
        const [write] = recentWrites(db);
        expect(write).toMatchObject({
            kind: "email",
            target: `plan ${PLAN}`,
            ok: true,
            payload: { to: RECIPIENTS, subject: "Songs for 10/4/26 · Sunday Morning" },
            result: {
                messageId: "<1@example.org>",
                accepted: ["pastor@example.org"],
                rejected: ["music@example.org"],
            },
        });
        expect(Object.keys(write.payload as object).sort()).toEqual(["subject", "to"]);
        expect(JSON.stringify(write)).not.toContain("Words and Music");
    });

    test("reads the plan afresh and builds the email from it, not from a preview", async () => {
        stubPlan();
        await previewPlanEmail(MORNING, PLAN);
        const fetchMock = stubPlan("Amazing Grace (Acoustic)");
        const { transport, sendMail } = stubTransport();

        await sendPlanEmail(MORNING, PLAN, { transport });
        expect(calledUrls(fetchMock)).toEqual(expect.arrayContaining([urls.plan, urls.items]));
        expect(sendMail.mock.calls[0][0].text).toBe(expectedText("Amazing Grace (Acoustic)"));
    });

    test("refuses, reading and sending nothing, when email is not set up", async () => {
        const fetchMock = stubPlan();
        vi.stubEnv("EMAIL_FROM", "");
        const { transport, sendMail } = stubTransport();

        await expect(sendPlanEmail(MORNING, PLAN, { transport })).resolves.toEqual({
            ok: false,
            kind: "not-configured",
            missing: ["EMAIL_FROM"],
            message: "Email is not set up: set EMAIL_FROM on the server.",
        });
        expect(fetchMock).not.toHaveBeenCalled();
        expect(sendMail).not.toHaveBeenCalled();
        expect(recentWrites(db)).toEqual([]);
    });

    test("refuses, reading and sending nothing, when there are no recipients", async () => {
        const fetchMock = stubPlan();
        db.prepare("DELETE FROM settings").run();
        const { transport, sendMail } = stubTransport();

        await expect(sendPlanEmail(MORNING, PLAN, { transport })).resolves.toEqual({
            ok: false,
            kind: "no-recipients",
            message: NO_RECIPIENTS_MESSAGE,
        });
        expect(fetchMock).not.toHaveBeenCalled();
        expect(sendMail).not.toHaveBeenCalled();
        expect(recentWrites(db)).toEqual([]);
    });

    test("refuses when the settings cannot be read, rather than guess the recipients", async () => {
        const fetchMock = stubPlan();
        vi.spyOn(console, "error").mockImplementation(() => {});
        getDb.mockImplementation(() => {
            throw new Error("Could not open the database");
        });
        const { transport, sendMail } = stubTransport();

        await expect(sendPlanEmail(MORNING, PLAN, { transport })).resolves.toEqual({
            ok: false,
            kind: "unavailable",
            message:
                "The settings could not be read, so the email was not sent: Could not open the database",
        });
        expect(fetchMock).not.toHaveBeenCalled();
        expect(sendMail).not.toHaveBeenCalled();
    });

    test("gives a failed send as a value, logs it, and never shows the SMTP password", async () => {
        stubPlan();
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        const failure = Object.assign(
            new Error(`Invalid login: 535 5.7.8 rejected for ${SMTP_URL} (${PASSWORD})`),
            { code: "EAUTH", responseCode: 535 }
        );
        const { transport } = stubTransport(undefined, failure);

        const result = await sendPlanEmail(MORNING, PLAN, { transport });
        expect(result).toEqual({
            ok: false,
            kind: "failed",
            message: "Could not send the email: Invalid login: 535 5.7.8 rejected for [redacted] ([redacted])",
        });
        expect(recentWrites(db)).toMatchObject([
            {
                kind: "email",
                target: `plan ${PLAN}`,
                ok: false,
                payload: { to: RECIPIENTS, subject: "Songs for 10/4/26 · Sunday Morning" },
                result: {
                    error: "Could not send the email: Invalid login: 535 5.7.8 rejected for [redacted] ([redacted])",
                    code: "EAUTH",
                    responseCode: 535,
                },
            },
        ]);
        expect(consoleError).toHaveBeenCalledWith(`Failed to email plan ${MORNING}/${PLAN}:`, expect.any(Error));
        const shown = [
            JSON.stringify(result),
            JSON.stringify(recentWrites(db)),
            inspect(consoleError.mock.calls, { depth: 10 }),
        ];
        for (const text of shown) {
            expect(text).not.toContain(PASSWORD);
            expect(text).not.toContain(SMTP_URL);
        }
    });

    test("still says the email was sent when the write log cannot record it", async () => {
        stubPlan();
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        db.exec(
            "CREATE TRIGGER full BEFORE INSERT ON write_log BEGIN SELECT RAISE(ABORT, 'database or disk is full'); END"
        );
        const { transport } = stubTransport();

        await expect(sendPlanEmail(MORNING, PLAN, { transport })).resolves.toMatchObject({ ok: true });
        expect(consoleError).toHaveBeenCalledWith(
            `Failed to record an email (plan ${PLAN}):`,
            expect.any(Error)
        );
    });

    test("refuses an id that is not a Planning Center id before anything else", async () => {
        const fetchMock = stubPlan();
        const { transport, sendMail } = stubTransport();
        await expect(sendPlanEmail("../people", PLAN, { transport })).rejects.toMatchObject({
            name: "InvalidPcoIdError",
        });
        await expect(sendPlanEmail(MORNING, "1 OR 1", { transport })).rejects.toMatchObject({
            name: "InvalidPcoIdError",
        });
        expect(fetchMock).not.toHaveBeenCalled();
        expect(sendMail).not.toHaveBeenCalled();
    });
});
