import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// vi.hoisted is required: vi.mock is hoisted above const declarations.
const {
    auth,
    revalidatePath,
    linkCatalogSong,
    saveSelection,
    previewHymnNotes,
    syncHymnNotes,
    previewPlanEmail,
    sendPlanEmail,
    reorderItems,
} = vi.hoisted(() => ({
    auth: vi.fn(),
    revalidatePath: vi.fn(),
    linkCatalogSong: vi.fn(),
    saveSelection: vi.fn(),
    previewHymnNotes: vi.fn(),
    syncHymnNotes: vi.fn(),
    previewPlanEmail: vi.fn(),
    sendPlanEmail: vi.fn(),
    reorderItems: vi.fn(),
}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/queries/reconcile", () => ({ linkCatalogSong }));
vi.mock("@/lib/queries/hymnNotes", () => ({ previewHymnNotes, syncHymnNotes }));
vi.mock("@/lib/queries/email", () => ({ previewPlanEmail, sendPlanEmail }));
vi.mock("@/lib/queries/planItems", () => ({ reorderItems }));
// The real module's messages, with only the write mocked.
vi.mock("@/lib/queries/selections", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/queries/selections")>()),
    saveScheduleSelection: saveSelection,
}));

import type { HymnNoteStatus } from "@/lib/hymnNotes";
import type {
    ExpectedPlanEmail,
    PlanEmailPreview,
    SendPlanEmailResult,
} from "@/lib/queries/email";
import type { HymnNotesSyncResult } from "@/lib/queries/hymnNotes";
import { SELECTION_NOT_SAVED_MESSAGE } from "@/lib/queries/selections";
import {
    linkPcoSong,
    previewHymnNotesAction,
    previewPlanEmailAction,
    reorderItemsAction,
    saveScheduleSelection,
    sendPlanEmailAction,
    syncHymnNotesAction,
} from "./actions";

const SESSION = {
    user: { email: "someone@example.com" },
    expires: "2026-11-03T12:00:00.000Z",
};

const ST = "1405391";
const PLAN = "81234567";
const PCO_SONG = "26000001";
const SONG = "42";
const ITEM = "91000001";

/** A refusal as linkCatalogSong returns it. */
const SONG_LINKED = {
    ok: false,
    reason: "song-linked",
    message:
        '"Abide with Me (EVENTIDE)" is already linked to the Planning Center song "Abide with Me". Undo that link first.',
};

beforeEach(() => {
    for (const mock of [
        auth,
        revalidatePath,
        linkCatalogSong,
        saveSelection,
        previewHymnNotes,
        syncHymnNotes,
        previewPlanEmail,
        sendPlanEmail,
        reorderItems,
    ]) {
        mock.mockReset();
    }
    auth.mockResolvedValue(SESSION);
    linkCatalogSong.mockResolvedValue({ ok: true, changed: true });
    saveSelection.mockReturnValue({ ok: true });
    vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
});

/** The action called with the four ids, any of which `overrides` replaces with something else. */
function link(
    overrides: Partial<Record<"serviceTypeId" | "planId" | "pcoSongId" | "songId", unknown>> = {}
) {
    const ids = { serviceTypeId: ST, planId: PLAN, pcoSongId: PCO_SONG, songId: SONG, ...overrides };
    // An action's arguments come from the network, so they may be anything.
    return linkPcoSong(
        ids.serviceTypeId as string,
        ids.planId as string,
        ids.pcoSongId as string,
        ids.songId as string
    );
}

describe("linkPcoSong", () => {
    test("throws without a session, before it links anything", async () => {
        auth.mockResolvedValue(null);

        await expect(link()).rejects.toThrow("Not signed in");
        expect(linkCatalogSong).not.toHaveBeenCalled();
        expect(revalidatePath).not.toHaveBeenCalled();
    });

    test("links the songs, then revalidates the plan's pages and the catalog's", async () => {
        await expect(link()).resolves.toEqual({ ok: true });

        expect(auth).toHaveBeenCalledTimes(1);
        expect(linkCatalogSong).toHaveBeenCalledTimes(1);
        expect(linkCatalogSong).toHaveBeenCalledWith(42, PCO_SONG);
        expect(revalidatePath.mock.calls).toEqual([
            [`/plans/${ST}/${PLAN}`, "layout"],
            ["/catalog", "layout"],
        ]);
    });

    test("revalidates when the two were already linked, so a tab that is out of date catches up", async () => {
        linkCatalogSong.mockResolvedValue({ ok: true, changed: false });

        await expect(link()).resolves.toEqual({ ok: true });
        expect(revalidatePath.mock.calls).toEqual([
            [`/plans/${ST}/${PLAN}`, "layout"],
            ["/catalog", "layout"],
        ]);
    });

    test.each([
        ["service type", "serviceTypeId"],
        ["plan", "planId"],
        ["Planning Center song", "pcoSongId"],
        ["catalog song", "songId"],
    ] as const)("refuses a %s id that is not one, without linking anything", async (_name, field) => {
        for (const value of [
            "",
            "abc",
            "0",
            "01",
            "-1",
            "1.5",
            " 1",
            "../1",
            "1/2",
            "12345678901234567890123",
            42,
            null,
            undefined,
            { id: "1" },
            ["1"],
        ]) {
            await expect(link({ [field]: value })).resolves.toEqual({
                ok: false,
                message: expect.stringContaining("Reload"),
            });
        }
        expect(linkCatalogSong).not.toHaveBeenCalled();
        expect(revalidatePath).not.toHaveBeenCalled();
    });

    test("returns a refusal's message as it is, and changes no page", async () => {
        linkCatalogSong.mockResolvedValue(SONG_LINKED);

        await expect(link()).resolves.toEqual({ ok: false, message: SONG_LINKED.message });
        expect(linkCatalogSong).toHaveBeenCalledWith(42, PCO_SONG);
        expect(revalidatePath).not.toHaveBeenCalled();
    });

    test("returns a message, and logs the cause, when linking throws", async () => {
        const cause = new Error("Could not open the database at /srv/data/x: denied");
        linkCatalogSong.mockRejectedValue(cause);

        await expect(link()).resolves.toEqual({
            ok: false,
            message: expect.stringContaining("nothing was linked"),
        });
        expect(console.error).toHaveBeenCalledWith(
            `Failed to link Planning Center song ${PCO_SONG} to catalog song 42:`,
            cause
        );
        expect(revalidatePath).not.toHaveBeenCalled();
    });
});

/** The save action called with its three ids, any of which `overrides` replaces, and a choice. */
function save(
    overrides: Partial<Record<"serviceTypeId" | "planId" | "itemId", unknown>> = {},
    option: unknown = "numbers",
    customText?: unknown
) {
    const ids = { serviceTypeId: ST, planId: PLAN, itemId: ITEM, ...overrides };
    // An action's arguments come from the network, so they may be anything.
    return saveScheduleSelection(
        ids.serviceTypeId as string,
        ids.planId as string,
        ids.itemId as string,
        option as "numbers",
        customText as string | undefined
    );
}

describe("saveScheduleSelection", () => {
    test("throws without a session, before it saves anything", async () => {
        auth.mockResolvedValue(null);

        await expect(save()).rejects.toThrow("Not signed in");
        expect(saveSelection).not.toHaveBeenCalled();
    });

    test("saves the choice for the plan's item, and revalidates nothing", async () => {
        await expect(save({}, "blank")).resolves.toEqual({ ok: true });

        expect(auth).toHaveBeenCalledTimes(1);
        expect(saveSelection).toHaveBeenCalledTimes(1);
        expect(saveSelection).toHaveBeenCalledWith(PLAN, ITEM, "blank", undefined);
        expect(revalidatePath).not.toHaveBeenCalled();
    });

    test("passes Custom's text on as it was typed", async () => {
        await expect(save({}, "custom", "  last verse only ")).resolves.toEqual({ ok: true });

        expect(saveSelection).toHaveBeenCalledWith(PLAN, ITEM, "custom", "  last verse only ");
    });

    test.each([
        ["service type", "serviceTypeId"],
        ["plan", "planId"],
        ["item", "itemId"],
    ] as const)("refuses a %s id that is not one, without saving anything", async (_name, field) => {
        for (const value of ["", "abc", "0", "01", "-1", " 1", "../1", "1/2", 42, null, undefined, ["1"]]) {
            await expect(save({ [field]: value })).resolves.toEqual({
                ok: false,
                message: SELECTION_NOT_SAVED_MESSAGE,
            });
        }
        expect(saveSelection).not.toHaveBeenCalled();
    });

    test("returns a refusal of the option or the text as it is", async () => {
        const refusal = { ok: false, message: "Custom text is at most 500 characters." };
        saveSelection.mockReturnValue(refusal);

        await expect(save({}, "custom", "x".repeat(501))).resolves.toEqual(refusal);
        // The query checks the option and the text, so they reach it as sent.
        await save({}, "verse 2", { text: "x" });
        expect(saveSelection).toHaveBeenLastCalledWith(PLAN, ITEM, "verse 2", { text: "x" });
    });

    test("returns a message, and logs the cause, when the database cannot be written", async () => {
        const cause = new Error("database is locked");
        saveSelection.mockImplementation(() => {
            throw cause;
        });

        await expect(save()).resolves.toEqual({
            ok: false,
            message: "The database could not be written.",
        });
        expect(console.error).toHaveBeenCalledWith(
            `Failed to save the Schedule tab's choice for plan ${ST}/${PLAN} item ${ITEM}:`,
            cause
        );
    });
});

/** A plan's hymnal notes when its category was found: one song to create a note for. */
const READY: HymnNoteStatus = {
    kind: "ready",
    category: { id: "501", name: "Hymnal" },
    items: [
        {
            itemId: ITEM,
            title: "Abide with Me",
            sequence: 2,
            content: "R-517 / G-64",
            current: null,
            action: "create",
            changes: [{ kind: "create", content: "R-517 / G-64" }],
            keep: [],
        },
    ],
};

const NO_CATEGORY: HymnNoteStatus = {
    kind: "no-category",
    categoryName: "Hymnal",
    message: 'Create an item note category named "Hymnal" in Planning Center for Sunday Morning.',
};

/** What a sync that created that note returns. */
const SYNCED: HymnNotesSyncResult = {
    ok: true,
    category: { id: "501", name: "Hymnal" },
    items: [
        {
            itemId: ITEM,
            title: "Abide with Me",
            sequence: 2,
            action: "create",
            outcome: "done",
            made: [{ kind: "create", content: "R-517 / G-64" }],
            keep: [],
            error: null,
        },
    ],
    counts: { created: 1, updated: 0, deleted: 0, unchanged: 0, kept: 0, failed: 0, changed: 0, notAttempted: 0 },
};

/** READY's items as the sync gets them once the action has parsed them: ids, actions and writes alone. */
const PREVIEWED = [
    { itemId: ITEM, action: "create", changes: [{ kind: "create", content: "R-517 / G-64" }] },
];

/** Ids that are not Planning Center ids. */
const NOT_IDS = ["", "abc", "0", "01", " 1", "../1", "1/2", 42, null, undefined, ["1"]];

describe("previewHymnNotesAction", () => {
    function preview(overrides: Partial<Record<"serviceTypeId" | "planId", unknown>> = {}) {
        const ids = { serviceTypeId: ST, planId: PLAN, ...overrides };
        return previewHymnNotesAction(ids.serviceTypeId as string, ids.planId as string);
    }

    test("throws without a session, before it reads anything", async () => {
        auth.mockResolvedValue(null);

        await expect(preview()).rejects.toThrow("Not signed in");
        expect(previewHymnNotes).not.toHaveBeenCalled();
    });

    test("returns what a sync would do, and changes no page", async () => {
        previewHymnNotes.mockResolvedValue(READY);

        await expect(preview()).resolves.toEqual({ ok: true, status: READY });
        expect(auth).toHaveBeenCalledTimes(1);
        expect(previewHymnNotes).toHaveBeenCalledWith(ST, PLAN);
        expect(revalidatePath).not.toHaveBeenCalled();
    });

    test("returns why the notes cannot be synced, such as a missing category", async () => {
        previewHymnNotes.mockResolvedValue(NO_CATEGORY);

        await expect(preview()).resolves.toEqual({ ok: true, status: NO_CATEGORY });
    });

    test.each([
        ["service type", "serviceTypeId"],
        ["plan", "planId"],
    ] as const)("refuses a %s id that is not one, without reading anything", async (_name, field) => {
        for (const value of NOT_IDS) {
            await expect(preview({ [field]: value })).resolves.toEqual({
                ok: false,
                message: expect.stringContaining("Reload"),
            });
        }
        expect(previewHymnNotes).not.toHaveBeenCalled();
    });

    test("returns a message, and logs the cause, when Planning Center cannot be read", async () => {
        const cause = new Error("Planning Center API responded with status: 500");
        previewHymnNotes.mockRejectedValue(cause);

        await expect(preview()).resolves.toEqual({
            ok: false,
            message: expect.stringContaining("could not be compared"),
        });
        expect(console.error).toHaveBeenCalledWith(
            `Failed to preview the hymnal notes of plan ${ST}/${PLAN}:`,
            cause
        );
    });
});

describe("syncHymnNotesAction", () => {
    /** The action called with the plan's ids, any of which `overrides` replaces, and the preview the dialog sends: READY's items. */
    function sync(
        overrides: Partial<Record<"serviceTypeId" | "planId", unknown>> = {},
        previewed: unknown = READY.kind === "ready" ? READY.items : []
    ) {
        const ids = { serviceTypeId: ST, planId: PLAN, ...overrides };
        // An action's arguments come from the network, so they may be anything.
        return syncHymnNotesAction(
            ids.serviceTypeId as string,
            ids.planId as string,
            previewed as Parameters<typeof syncHymnNotesAction>[2]
        );
    }

    test("throws without a session, before it writes anything", async () => {
        auth.mockResolvedValue(null);

        await expect(sync()).rejects.toThrow("Not signed in");
        expect(syncHymnNotes).not.toHaveBeenCalled();
        expect(revalidatePath).not.toHaveBeenCalled();
    });

    test("syncs the notes, returns what became of each, and revalidates the plan's pages", async () => {
        syncHymnNotes.mockResolvedValue(SYNCED);

        await expect(sync()).resolves.toEqual(SYNCED);
        expect(auth).toHaveBeenCalledTimes(1);
        expect(syncHymnNotes).toHaveBeenCalledWith(ST, PLAN, PREVIEWED);
        expect(revalidatePath.mock.calls).toEqual([[`/plans/${ST}/${PLAN}`, "layout"]]);
    });

    test("returns a refusal as it is, and changes no page: nothing was written", async () => {
        const refusal = { ok: false, kind: "no-category", message: NO_CATEGORY.message };
        syncHymnNotes.mockResolvedValue(refusal);

        await expect(sync()).resolves.toEqual(refusal);
        expect(revalidatePath).not.toHaveBeenCalled();
    });

    test.each([
        ["service type", "serviceTypeId"],
        ["plan", "planId"],
    ] as const)("refuses a %s id that is not one, without syncing", async (_name, field) => {
        for (const value of NOT_IDS) {
            await expect(sync({ [field]: value })).resolves.toEqual({
                ok: false,
                kind: "failed",
                message: expect.stringContaining("Reload"),
            });
        }
        expect(syncHymnNotes).not.toHaveBeenCalled();
        expect(revalidatePath).not.toHaveBeenCalled();
    });

    test("holds the sync to the preview it was sent, parsed down to ids, actions and writes", async () => {
        syncHymnNotes.mockResolvedValue(SYNCED);

        await sync();
        // The titles, contents and notes left alone the dialog sent are dropped.
        expect(syncHymnNotes.mock.calls[0][2]).toEqual(PREVIEWED);
    });

    test("refuses a preview that is not one, before it reads or writes anything", async () => {
        const item = READY.kind === "ready" ? READY.items[0] : null;
        for (const previewed of [
            undefined,
            null,
            "[]",
            { 0: item },
            [{ ...item, itemId: "../1" }],
            [{ ...item, action: "rewrite" }],
            [{ ...item, changes: [{ kind: "update", noteId: "01", from: "x", content: "y" }] }],
            Array.from({ length: 201 }, (_, i) => ({ ...item, itemId: String(1000 + i) })),
        ]) {
            // Called directly: the helper's default would stand in for undefined.
            await expect(
                syncHymnNotesAction(ST, PLAN, previewed as Parameters<typeof syncHymnNotesAction>[2])
            ).resolves.toEqual({
                ok: false,
                kind: "failed",
                message: expect.stringContaining("Preview again"),
            });
        }
        expect(syncHymnNotes).not.toHaveBeenCalled();
        expect(revalidatePath).not.toHaveBeenCalled();
    });

    test("returns items that changed since the preview, written or not, and revalidates", async () => {
        const changed: HymnNotesSyncResult = {
            ...SYNCED,
            items: [{ ...(SYNCED.ok ? SYNCED.items[0] : ({} as never)), outcome: "changed", made: [] }],
            counts: { created: 0, updated: 0, deleted: 0, unchanged: 0, kept: 0, failed: 0, changed: 1, notAttempted: 0 },
        };
        syncHymnNotes.mockResolvedValue(changed);

        await expect(sync()).resolves.toEqual(changed);
        expect(revalidatePath.mock.calls).toEqual([[`/plans/${ST}/${PLAN}`, "layout"]]);
    });

    test("returns a sync of the plan already running as a refusal, and changes no page", async () => {
        const busy = { ok: false, kind: "busy", message: "A sync of this plan's hymnal notes is already running." };
        syncHymnNotes.mockResolvedValue(busy);

        await expect(sync()).resolves.toEqual(busy);
        expect(revalidatePath).not.toHaveBeenCalled();
    });

    test("returns a message, and logs the cause, when the sync fails before writing", async () => {
        const cause = new Error("Could not open the database");
        syncHymnNotes.mockRejectedValue(cause);

        await expect(sync()).resolves.toEqual({
            ok: false,
            kind: "failed",
            message: expect.stringContaining("no note was written"),
        });
        expect(console.error).toHaveBeenCalledWith(
            `Failed to sync the hymnal notes of plan ${ST}/${PLAN}:`,
            cause
        );
        expect(revalidatePath).not.toHaveBeenCalled();
    });
});

/** A plan's email as the preview gives it: set up, with recipients. */
const EMAIL_PREVIEW: PlanEmailPreview = {
    configured: true,
    to: ["pastor@example.org", "music@example.org"],
    subject: "Songs for 10/4/26 \u00b7 Sunday Morning",
    text: "October 4, 2026 \u00b7 Sunday Morning\n",
};

/** What a send that the mail server took for both recipients, as previewed, returns. */
const EMAIL_SENT: SendPlanEmailResult = {
    ok: true,
    to: EMAIL_PREVIEW.to,
    subject: EMAIL_PREVIEW.subject,
    accepted: EMAIL_PREVIEW.to,
    rejected: [],
    textChanged: false,
};

/** What the dialog sends back with Send: the email its preview showed. */
const EMAIL_PREVIEWED: ExpectedPlanEmail = {
    to: EMAIL_PREVIEW.to,
    subject: EMAIL_PREVIEW.subject,
    text: EMAIL_PREVIEW.text,
};

describe("previewPlanEmailAction", () => {
    function preview(overrides: Partial<Record<"serviceTypeId" | "planId", unknown>> = {}) {
        const ids = { serviceTypeId: ST, planId: PLAN, ...overrides };
        return previewPlanEmailAction(ids.serviceTypeId as string, ids.planId as string);
    }

    test("throws without a session, before it reads anything", async () => {
        auth.mockResolvedValue(null);

        await expect(preview()).rejects.toThrow("Not signed in");
        expect(previewPlanEmail).not.toHaveBeenCalled();
    });

    test("returns the email as it would be sent, and changes no page", async () => {
        previewPlanEmail.mockResolvedValue(EMAIL_PREVIEW);

        await expect(preview()).resolves.toEqual({ ok: true, preview: EMAIL_PREVIEW });
        expect(auth).toHaveBeenCalledTimes(1);
        expect(previewPlanEmail).toHaveBeenCalledWith(ST, PLAN);
        expect(revalidatePath).not.toHaveBeenCalled();
    });

    test("returns a preview that cannot be sent as it is: it says why itself", async () => {
        const notSetUp: PlanEmailPreview = {
            ...EMAIL_PREVIEW,
            configured: false,
            missing: ["SMTP_URL", "EMAIL_FROM"],
            to: [],
        };
        previewPlanEmail.mockResolvedValue(notSetUp);

        await expect(preview()).resolves.toEqual({ ok: true, preview: notSetUp });
    });

    test.each([
        ["service type", "serviceTypeId"],
        ["plan", "planId"],
    ] as const)("refuses a %s id that is not one, without reading anything", async (_name, field) => {
        for (const value of NOT_IDS) {
            await expect(preview({ [field]: value })).resolves.toEqual({
                ok: false,
                message: expect.stringContaining("Reload"),
            });
        }
        expect(previewPlanEmail).not.toHaveBeenCalled();
    });

    test("returns a message, and logs the cause, when the plan cannot be read", async () => {
        const cause = new Error("Planning Center API responded with status: 500");
        previewPlanEmail.mockRejectedValue(cause);

        await expect(preview()).resolves.toEqual({
            ok: false,
            message: expect.stringContaining("could not be prepared"),
        });
        expect(console.error).toHaveBeenCalledWith(
            `Failed to preview the email of plan ${ST}/${PLAN}:`,
            cause
        );
    });
});

describe("sendPlanEmailAction", () => {
    function send(
        overrides: Partial<Record<"serviceTypeId" | "planId", unknown>> = {},
        previewed: unknown = EMAIL_PREVIEWED
    ) {
        const ids = { serviceTypeId: ST, planId: PLAN, ...overrides };
        // An action's arguments come from the network, so they may be anything.
        return sendPlanEmailAction(
            ids.serviceTypeId as string,
            ids.planId as string,
            previewed as ExpectedPlanEmail
        );
    }

    test("throws without a session, before it sends anything", async () => {
        auth.mockResolvedValue(null);

        await expect(send()).rejects.toThrow("Not signed in");
        expect(sendPlanEmail).not.toHaveBeenCalled();
        expect(revalidatePath).not.toHaveBeenCalled();
    });

    test("sends the plan's email as previewed and returns who got it, revalidating nothing", async () => {
        sendPlanEmail.mockResolvedValue(EMAIL_SENT);

        await expect(send()).resolves.toEqual(EMAIL_SENT);
        expect(auth).toHaveBeenCalledTimes(1);
        expect(sendPlanEmail).toHaveBeenCalledTimes(1);
        expect(sendPlanEmail).toHaveBeenCalledWith(ST, PLAN, EMAIL_PREVIEWED);
        expect(revalidatePath).not.toHaveBeenCalled();
    });

    test("holds the send to the preview it was sent, read down to its recipients, subject and text", async () => {
        sendPlanEmail.mockResolvedValue(EMAIL_SENT);

        // The dialog has the whole preview; whatever else comes with it is dropped.
        await send({}, { ...EMAIL_PREVIEW, missing: ["SMTP_URL"], to: [...EMAIL_PREVIEW.to] });
        expect(sendPlanEmail.mock.calls[0][2]).toStrictEqual(EMAIL_PREVIEWED);
    });

    test("returns a send whose text changed since the preview as it is: it says so itself", async () => {
        const rebuilt: SendPlanEmailResult = { ...EMAIL_SENT, textChanged: true };
        sendPlanEmail.mockResolvedValue(rebuilt);

        await expect(send()).resolves.toEqual(rebuilt);
        expect(revalidatePath).not.toHaveBeenCalled();
    });

    test("refuses a preview that is not one, before it reads or sends anything", async () => {
        for (const previewed of [
            undefined,
            null,
            JSON.stringify(EMAIL_PREVIEWED),
            [EMAIL_PREVIEWED],
            { ...EMAIL_PREVIEWED, to: "pastor@example.org" },
            { ...EMAIL_PREVIEWED, to: [42] },
            { ...EMAIL_PREVIEWED, to: Array.from({ length: 26 }, (_, i) => `staff${i}@example.org`) },
            { ...EMAIL_PREVIEWED, subject: undefined },
            { ...EMAIL_PREVIEWED, text: null },
        ]) {
            // Called directly: the helper's default would stand in for undefined.
            await expect(
                sendPlanEmailAction(ST, PLAN, previewed as ExpectedPlanEmail)
            ).resolves.toEqual({
                ok: false,
                kind: "failed",
                message: expect.stringContaining("Preview again"),
            });
        }
        expect(sendPlanEmail).not.toHaveBeenCalled();
        expect(revalidatePath).not.toHaveBeenCalled();
    });

    test.each([
        [
            "email that is not set up",
            {
                ok: false,
                kind: "not-configured",
                missing: ["SMTP_URL"],
                message: "Email is not set up: set SMTP_URL on the server.",
            },
        ],
        [
            "no recipients",
            {
                ok: false,
                kind: "no-recipients",
                message: "No one would get this email: add its recipients in Settings first.",
            },
        ],
        [
            "settings that cannot be read",
            {
                ok: false,
                kind: "unavailable",
                message: "The settings could not be read, so the email was not sent: denied",
            },
        ],
        [
            "a send of the plan's email already under way",
            {
                ok: false,
                kind: "busy",
                message:
                    "This plan's email is being sent already, so it was not sent again. Look at the recent writes in Settings to see how that send went.",
            },
        ],
        [
            "recipients that are not the preview's",
            {
                ok: false,
                kind: "changed",
                message:
                    "The recipients have changed since the preview, so the email was not sent. Preview it again to see who it would go to now.",
            },
        ],
        [
            "a failed send",
            { ok: false, kind: "failed", message: "Could not send the email: Invalid login." },
        ],
    ])("returns the refusal of %s as it is", async (_name, refusal) => {
        sendPlanEmail.mockResolvedValue(refusal);

        await expect(send()).resolves.toEqual(refusal);
        expect(revalidatePath).not.toHaveBeenCalled();
    });

    test.each([
        ["service type", "serviceTypeId"],
        ["plan", "planId"],
    ] as const)("refuses a %s id that is not one, without sending", async (_name, field) => {
        for (const value of NOT_IDS) {
            await expect(send({ [field]: value })).resolves.toEqual({
                ok: false,
                kind: "failed",
                message: expect.stringContaining("Reload"),
            });
        }
        expect(sendPlanEmail).not.toHaveBeenCalled();
    });

    test("returns a message, and logs the cause, when the plan cannot be read: nothing was sent", async () => {
        const cause = new Error("Planning Center API responded with status: 500");
        sendPlanEmail.mockRejectedValue(cause);

        await expect(send()).resolves.toEqual({
            ok: false,
            kind: "failed",
            message: expect.stringContaining("the email was not sent"),
        });
        expect(console.error).toHaveBeenCalledWith(`Failed to email plan ${ST}/${PLAN}:`, cause);
        expect(revalidatePath).not.toHaveBeenCalled();
    });
});

describe("reorderItemsAction", () => {
    const SHOWN = ["91000001", "91000002", "91000003", "91000004"];
    const ORDER = ["91000003", "91000001", "91000002", "91000004"];
    const PREVIEWED = { shown: SHOWN, order: ORDER };

    beforeEach(() => {
        reorderItems.mockResolvedValue({ ok: true, itemIds: ORDER, moved: 3 });
    });

    test("throws without a session, before it reads or writes anything", async () => {
        auth.mockResolvedValue(null);

        await expect(reorderItemsAction(ST, PLAN, PREVIEWED)).rejects.toThrow("Not signed in");
        expect(reorderItems).not.toHaveBeenCalled();
        expect(revalidatePath).not.toHaveBeenCalled();
    });

    test("puts the items in the order sent, held to the order the page showed, and revalidates the plan's pages", async () => {
        await expect(reorderItemsAction(ST, PLAN, PREVIEWED)).resolves.toEqual({ ok: true, moved: 3 });

        expect(reorderItems).toHaveBeenCalledTimes(1);
        expect(reorderItems).toHaveBeenCalledWith(ST, PLAN, { shown: SHOWN, order: ORDER });
        expect(revalidatePath.mock.calls).toEqual([[`/plans/${ST}/${PLAN}`, "layout"]]);
    });

    test("sends the query only the two lists, rebuilt from their checked ids", async () => {
        const forged = { shown: SHOWN, order: ORDER, extra: "x", __proto__: { admin: true } };
        await reorderItemsAction(ST, PLAN, forged);

        expect(reorderItems.mock.calls[0][2]).toStrictEqual({ shown: SHOWN, order: ORDER });
    });

    test("answers an order that was the order shown as made, and revalidates nothing: nothing was written", async () => {
        reorderItems.mockResolvedValue({ ok: true, itemIds: SHOWN, moved: 0 });

        await expect(reorderItemsAction(ST, PLAN, { shown: SHOWN, order: SHOWN })).resolves.toEqual({
            ok: true,
            moved: 0,
        });
        expect(revalidatePath).not.toHaveBeenCalled();
    });

    test("returns a plan that changed as it is, and revalidates, so the page shows what Planning Center has now", async () => {
        reorderItems.mockResolvedValue({ ok: false, reason: "changed", message: "Items were added." });

        await expect(reorderItemsAction(ST, PLAN, PREVIEWED)).resolves.toEqual({
            ok: false,
            reason: "changed",
            message: "Items were added.",
        });
        expect(revalidatePath.mock.calls).toEqual([[`/plans/${ST}/${PLAN}`, "layout"]]);
    });

    test.each(["busy", "refused"] as const)("returns a %s refusal as it is, and changes no page", async (reason) => {
        reorderItems.mockResolvedValue({ ok: false, reason, message: "Not now." });

        await expect(reorderItemsAction(ST, PLAN, PREVIEWED)).resolves.toEqual({
            ok: false,
            reason,
            message: "Not now.",
        });
        expect(revalidatePath).not.toHaveBeenCalled();
    });

    test.each(["invalid", "not-found"] as const)(
        "returns a %s refusal as a failure with its message, and changes no page",
        async (reason) => {
            reorderItems.mockResolvedValue({ ok: false, reason, message: "There is no such plan." });

            await expect(reorderItemsAction(ST, PLAN, PREVIEWED)).resolves.toEqual({
                ok: false,
                reason: "failed",
                message: "There is no such plan.",
            });
            expect(revalidatePath).not.toHaveBeenCalled();
        }
    );

    test("answers ids that are not ids with a message, before it reads anything", async () => {
        for (const [st, plan] of [
            ["abc", PLAN],
            [ST, "../etc"],
            ["", PLAN],
        ]) {
            await expect(reorderItemsAction(st, plan, PREVIEWED)).resolves.toMatchObject({
                ok: false,
                reason: "failed",
                message: expect.stringContaining("plan that cannot be found"),
            });
        }
        expect(reorderItems).not.toHaveBeenCalled();
    });

    test.each([
        ["no body", undefined],
        ["not an object", "shown"],
        ["lists of other items", { shown: SHOWN, order: ["91000001", "91000002", "91000003", "91000009"] }],
        ["an id that is not an id", { shown: ["a", "b"], order: ["b", "a"] }],
        ["an item twice", { shown: ["1", "2"], order: ["1", "1"] }],
        ["no items", { shown: [], order: [] }],
        ["one list", { shown: SHOWN }],
    ])("refuses %s before it reads or writes anything", async (_name, previewed) => {
        await expect(
            reorderItemsAction(ST, PLAN, previewed as unknown as { shown: string[]; order: string[] })
        ).resolves.toMatchObject({
            ok: false,
            reason: "failed",
            message: expect.stringContaining("could not check"),
        });
        expect(reorderItems).not.toHaveBeenCalled();
        expect(revalidatePath).not.toHaveBeenCalled();
    });

    test("returns a message, and logs the cause, when the reorder throws: it may or may not have been written", async () => {
        const cause = new Error("PCO request failed (status: 500)");
        reorderItems.mockRejectedValue(cause);

        await expect(reorderItemsAction(ST, PLAN, PREVIEWED)).resolves.toEqual({
            ok: false,
            reason: "failed",
            message: expect.stringContaining("may not have been put in order"),
        });
        expect(console.error).toHaveBeenCalledWith(`Failed to reorder the items of plan ${ST}/${PLAN}:`, cause);
        expect(revalidatePath).not.toHaveBeenCalled();
    });
});
