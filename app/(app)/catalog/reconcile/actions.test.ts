import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// vi.hoisted is required: vi.mock is hoisted above const declarations.
const {
    auth,
    revalidatePath,
    linkCatalogSong,
    undoAutoLink,
    ignorePcoSong,
    unignorePcoSong,
    unlinkCatalogSong,
} = vi.hoisted(() => ({
    auth: vi.fn(),
    revalidatePath: vi.fn(),
    linkCatalogSong: vi.fn(),
    undoAutoLink: vi.fn(),
    ignorePcoSong: vi.fn(),
    unignorePcoSong: vi.fn(),
    unlinkCatalogSong: vi.fn(),
}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/queries/reconcile", () => ({
    linkCatalogSong,
    undoAutoLink,
    ignorePcoSong,
    unignorePcoSong,
}));
vi.mock("@/lib/queries/catalogEdit", () => ({ unlinkCatalogSong }));

import { FORM_FAILURE_MESSAGE, IDLE_FORM } from "@/lib/forms";
import {
    ignorePcoSongAction,
    linkSongAction,
    undoAutoLinkAction,
    unignorePcoSongAction,
    unlinkSongAction,
} from "./actions";

const SESSION = {
    user: { email: "someone@example.com" },
    expires: "2026-11-03T12:00:00.000Z",
};

const QUERIES = [
    linkCatalogSong,
    undoAutoLink,
    ignorePcoSong,
    unignorePcoSong,
    unlinkCatalogSong,
];

const NOT_AN_ID =
    "This page asked for a change that cannot be made. Reload it and try again.";

beforeEach(() => {
    for (const mock of [auth, revalidatePath, ...QUERIES]) {
        mock.mockReset();
    }
    auth.mockResolvedValue(SESSION);
    linkCatalogSong.mockResolvedValue({ ok: true, changed: true });
    undoAutoLink.mockReturnValue({ ok: true, pcoSongId: "1001" });
    unlinkCatalogSong.mockReturnValue({ ok: true, pcoSongId: "1001" });
    ignorePcoSong.mockReturnValue({ ok: true });
    unignorePcoSong.mockReturnValue({ ok: true });
    vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
});

/** A form with these fields, as the browser would post it. */
function formWith(fields: Record<string, string>): FormData {
    const formData = new FormData();
    for (const [name, value] of Object.entries(fields)) {
        formData.set(name, value);
    }
    return formData;
}

const BOTH_IDS = { songId: "42", pcoSongId: "1001" };

/** The pages a change to a link revalidates. */
const LINK_PAGES = [
    ["/catalog", "layout"],
    ["/plans", "layout"],
];

describe("every link action", () => {
    const actions = [
        ["linkSongAction", () => linkSongAction(IDLE_FORM, formWith(BOTH_IDS))],
        ["undoAutoLinkAction", () => undoAutoLinkAction(IDLE_FORM, formWith(BOTH_IDS))],
        ["unlinkSongAction", () => unlinkSongAction(IDLE_FORM, formWith(BOTH_IDS))],
        ["ignorePcoSongAction", () => ignorePcoSongAction(IDLE_FORM, formWith(BOTH_IDS))],
        ["unignorePcoSongAction", () => unignorePcoSongAction(IDLE_FORM, formWith(BOTH_IDS))],
    ] as const;

    test.each(actions)(
        "%s throws without a session, before it changes anything",
        async (_name, run) => {
            auth.mockResolvedValue(null);

            await expect(run()).rejects.toThrow("Not signed in");
            for (const query of QUERIES) {
                expect(query).not.toHaveBeenCalled();
            }
            expect(revalidatePath).not.toHaveBeenCalled();
        }
    );
});

describe.each([
    ["linkSongAction", linkSongAction, linkCatalogSong, "Linked."],
    [
        "undoAutoLinkAction",
        undoAutoLinkAction,
        undoAutoLink,
        "Unlinked. The next sync will not link them again.",
    ],
    ["unlinkSongAction", unlinkSongAction, unlinkCatalogSong, "Unlinked from Planning Center."],
] as const)("%s", (_name, action, query, done) => {
    test("changes the link, then revalidates every page that shows links", async () => {
        await expect(action(IDLE_FORM, formWith(BOTH_IDS))).resolves.toEqual({
            status: "success",
            message: done,
            values: {},
        });
        expect(query).toHaveBeenCalledWith(42, "1001");
        expect(revalidatePath.mock.calls).toEqual(LINK_PAGES);
    });

    test.each([
        ["no song id", { pcoSongId: "1001" }],
        ["a song id that is not one", { songId: "042", pcoSongId: "1001" }],
        ["no Planning Center song id", { songId: "42" }],
        ["a Planning Center song id that is not one", { songId: "42", pcoSongId: "../1001" }],
    ])("refuses %s without changing anything", async (_case, fields) => {
        await expect(action(IDLE_FORM, formWith(fields))).resolves.toEqual({
            status: "error",
            message: NOT_AN_ID,
            fieldErrors: {},
            values: {},
        });
        expect(query).not.toHaveBeenCalled();
        expect(revalidatePath).not.toHaveBeenCalled();
    });

    test("returns a refusal's message, and changes no page", async () => {
        const refusal = {
            ok: false,
            reason: "song-linked",
            message:
                '"Amazing Grace (NEW BRITAIN)" is already linked to the Planning Center song "Amazing Grace". Undo that link first.',
        };
        query.mockReturnValue(refusal);
        // linkCatalogSong is async: give it a promise of the refusal.
        if (query === linkCatalogSong) {
            query.mockResolvedValue(refusal);
        }

        await expect(action(IDLE_FORM, formWith(BOTH_IDS))).resolves.toMatchObject({
            status: "error",
            message: refusal.message,
        });
        expect(revalidatePath).not.toHaveBeenCalled();
    });

    test("returns a message, and logs the cause, when the change throws", async () => {
        const cause = new Error("database is locked");
        query.mockImplementation(() => {
            throw cause;
        });

        await expect(action(IDLE_FORM, formWith(BOTH_IDS))).resolves.toMatchObject({
            status: "error",
            message: FORM_FAILURE_MESSAGE,
        });
        expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/^Failed to /), cause);
        expect(revalidatePath).not.toHaveBeenCalled();
    });
});

describe.each([
    ["ignorePcoSongAction", ignorePcoSongAction, ignorePcoSong, "Ignored."],
    ["unignorePcoSongAction", unignorePcoSongAction, unignorePcoSong, "Back on the list."],
] as const)("%s", (_name, action, query, done) => {
    test("changes the Planning Center song, then revalidates every page that shows links", async () => {
        await expect(action(IDLE_FORM, formWith({ pcoSongId: "1001" }))).resolves.toEqual({
            status: "success",
            message: done,
            values: {},
        });
        expect(query).toHaveBeenCalledWith("1001");
        expect(revalidatePath.mock.calls).toEqual(LINK_PAGES);
    });

    test.each([
        ["no id", {}],
        ["an id that is not one", { pcoSongId: "0" }],
    ])("refuses %s without changing anything", async (_case, fields) => {
        await expect(action(IDLE_FORM, formWith(fields))).resolves.toMatchObject({
            status: "error",
            message: NOT_AN_ID,
        });
        expect(query).not.toHaveBeenCalled();
    });

    test("returns a refusal's message, and changes no page", async () => {
        query.mockReturnValue({
            ok: false,
            reason: "pco-song-linked",
            message: "It is linked.",
        });

        await expect(action(IDLE_FORM, formWith({ pcoSongId: "1001" }))).resolves.toMatchObject({
            status: "error",
            message: "It is linked.",
        });
        expect(revalidatePath).not.toHaveBeenCalled();
    });

    test("returns a message, and logs the cause, when the change throws", async () => {
        const cause = new Error("disk I/O error");
        query.mockImplementation(() => {
            throw cause;
        });

        await expect(action(IDLE_FORM, formWith({ pcoSongId: "1001" }))).resolves.toMatchObject({
            message: FORM_FAILURE_MESSAGE,
        });
        expect(console.error).toHaveBeenCalledWith(
            expect.stringContaining("Planning Center song 1001"),
            cause
        );
    });
});
