import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// vi.hoisted is required: vi.mock is hoisted above const declarations. The
// destructuring must be part of the same statement, so it is hoisted with it.
const { Redirected, auth, revalidatePath, redirect, createSong, getNewSongBooks } =
    vi.hoisted(() => {
        /** What the mocked redirect() throws, as the real one does, so nothing after it runs. */
        class Redirected extends Error {
            constructor(readonly url: string) {
                super(`redirected to ${url}`);
            }
        }
        return {
            Redirected,
            auth: vi.fn(),
            revalidatePath: vi.fn(),
            redirect: vi.fn(),
            createSong: vi.fn(),
            getNewSongBooks: vi.fn(),
        };
    });
vi.mock("@/auth", () => ({ auth }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/queries/catalogEdit", () => ({ createSong, getNewSongBooks }));

import { IDLE_FORM, FORM_FAILURE_MESSAGE } from "@/lib/forms";
import { createSongAction } from "./actions";

const SESSION = {
    user: { email: "someone@example.com" },
    expires: "2026-11-03T12:00:00.000Z",
};

const BOOKS = [
    { id: 1, name: "Rejoice Hymns", numbered: true },
    { id: 2, name: "Great Hymns of the Faith", numbered: true },
];

/** What the form posts for a new hymn to a new tune at R-396, with these fields changed. */
const FIELDS = {
    hymn: "new",
    hymnId: "",
    hymnTitle: " Be Thou My Vision ",
    tune: "new",
    tuneId: "",
    tuneName: "SLANE",
    bookId: "1",
    placement: "number",
    number: "396",
    location: "",
};

const FIX_FIELDS = "The song was not added. Fix what is marked below, then try again.";

beforeEach(() => {
    for (const mock of [auth, revalidatePath, redirect, createSong, getNewSongBooks]) {
        mock.mockReset();
    }
    auth.mockResolvedValue(SESSION);
    redirect.mockImplementation((url: string) => {
        throw new Redirected(url);
    });
    getNewSongBooks.mockReturnValue(BOOKS);
    createSong.mockResolvedValue({ ok: true, songId: 42 });
    vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
});

/** The form as the browser posts it: `FIELDS`, with these changed or added. */
function formWith(fields: Record<string, string> = {}): FormData {
    const formData = new FormData();
    for (const [name, value] of Object.entries({ ...FIELDS, ...fields })) {
        formData.set(name, value);
    }
    return formData;
}

/** Submit the form. */
function submit(fields: Record<string, string> = {}) {
    return createSongAction(IDLE_FORM, formWith(fields));
}

/** Await an action that must end in `redirect()`, and give the address it redirected to. */
async function redirectedTo(action: Promise<unknown>): Promise<string> {
    try {
        await action;
    } catch (error) {
        if (error instanceof Redirected) {
            return error.url;
        }
        throw error;
    }
    throw new Error("Expected the action to redirect");
}

describe("createSongAction", () => {
    test("throws without a session, before it reads or writes anything", async () => {
        auth.mockResolvedValue(null);

        await expect(submit()).rejects.toThrow("Not signed in");
        expect(getNewSongBooks).not.toHaveBeenCalled();
        expect(createSong).not.toHaveBeenCalled();
        expect(revalidatePath).not.toHaveBeenCalled();
        expect(redirect).not.toHaveBeenCalled();
    });

    test("adds the song, revalidates the catalog and plan pages, and goes to the new song", async () => {
        expect(await redirectedTo(submit())).toBe("/catalog/songs/42");
        expect(createSong).toHaveBeenCalledWith({
            hymn: { kind: "new", title: "Be Thou My Vision" },
            tune: { kind: "new", name: "SLANE" },
            entry: { kind: "number", bookId: 1, number: 396 },
            pcoSongId: null,
        });
        expect(revalidatePath.mock.calls).toEqual([
            ["/catalog", "layout"],
            ["/plans", "layout"],
        ]);
    });

    test("links the form's Planning Center song, and goes back where the form was opened from", async () => {
        const url = await redirectedTo(
            submit({ pcoSongId: "26000001", returnTo: "/catalog/reconcile" })
        );

        expect(url).toBe("/catalog/reconcile");
        expect(createSong).toHaveBeenCalledWith(
            expect.objectContaining({ pcoSongId: "26000001" })
        );
        expect(revalidatePath).toHaveBeenCalledWith("/catalog/reconcile");
    });

    test("revalidates the page it returns to without its query", async () => {
        const url = await redirectedTo(
            submit({ returnTo: "/plans/1405391/81234567/schedule?tab=1#song" })
        );

        expect(url).toBe("/plans/1405391/81234567/schedule?tab=1#song");
        expect(revalidatePath).toHaveBeenCalledWith("/plans/1405391/81234567/schedule");
    });

    test.each([
        ["another site", "https://example.com/catalog"],
        ["a protocol-relative address", "//example.com"],
        ["a backslash address", "/\\example.com"],
        ["the sign-in page", "/auth/signin"],
        ["text that is not a path", "catalog"],
        ["a path a browser resolves to another host", "/.//evil.example/phish"],
        ["a path whose dot-dot segment makes it another host", "/a/..//x"],
        ["a path with a dot segment and a backslash", "/.\\/x"],
        ["a path with an encoded dot segment", "/%2e//evil.example/phish"],
    ])("goes to the new song instead of %s", async (_name, returnTo) => {
        expect(await redirectedTo(submit({ returnTo }))).toBe("/catalog/songs/42");
        expect(revalidatePath).toHaveBeenCalledTimes(2);
    });

    test.each([
        ["a word", "abc"],
        ["zero", "0"],
        ["a leading zero", "026"],
    ])("refuses a Planning Center song id that is %s, without writing", async (_name, pcoSongId) => {
        await expect(submit({ pcoSongId })).resolves.toEqual({
            status: "error",
            message:
                "The song was not added: the Planning Center song this form was opened for does not exist. Open the form again.",
            fieldErrors: {},
            values: FIELDS,
        });
        expect(createSong).not.toHaveBeenCalled();
    });

    test("returns the fields to fix, with what was posted, without writing", async () => {
        await expect(
            submit({ hymnTitle: "  ", tune: "existing", number: "abc" })
        ).resolves.toEqual({
            status: "error",
            message: FIX_FIELDS,
            fieldErrors: {
                hymn: { message: "Type the new hymn's title." },
                tune: { message: "Choose a tune from the list." },
                entry: { message: "A number is a whole number from 1 to 99,999." },
            },
            values: { ...FIELDS, hymnTitle: "  ", tune: "existing", number: "abc" },
        });
        expect(createSong).not.toHaveBeenCalled();
        expect(revalidatePath).not.toHaveBeenCalled();
    });

    test("checks the entry against the catalog's books", async () => {
        await expect(submit({ bookId: "3" })).resolves.toMatchObject({
            fieldErrors: { entry: { message: "Choose a book from the list, or No book." } },
        });
    });

    test("returns the catalog's problems on their parts, linking to what exists", async () => {
        createSong.mockResolvedValue({
            ok: false,
            problems: [
                {
                    reason: "tune-name-taken",
                    part: "tune",
                    message: "The catalog already has the tune SLANE. Choose it from the list instead.",
                    existing: { kind: "tune", tuneId: 3, label: "SLANE" },
                },
                {
                    reason: "number-taken",
                    part: "entry",
                    message: 'R-396 is taken by "Holy, Holy, Holy (NICAEA)".',
                    existing: { kind: "song", songId: 7, label: "Holy, Holy, Holy (NICAEA)" },
                },
            ],
        });

        await expect(submit()).resolves.toEqual({
            status: "error",
            message: FIX_FIELDS,
            fieldErrors: {
                tune: {
                    message: "The catalog already has the tune SLANE. Choose it from the list instead.",
                    link: { href: "/catalog/tunes/3", label: "SLANE" },
                },
                entry: {
                    message: 'R-396 is taken by "Holy, Holy, Holy (NICAEA)".',
                    link: { href: "/catalog/songs/7", label: "Holy, Holy, Holy (NICAEA)" },
                },
            },
            values: FIELDS,
        });
        expect(revalidatePath).not.toHaveBeenCalled();
        expect(redirect).not.toHaveBeenCalled();
    });

    test("returns a refused link as the link's error", async () => {
        createSong.mockResolvedValue({
            ok: false,
            problems: [
                {
                    reason: "pco-song-linked",
                    part: null,
                    message:
                        'The Planning Center song "Be Thou My Vision" is already linked to "Be Thou My Vision (SLANE)". Undo that link first.',
                    existing: { kind: "song", songId: 9, label: "Be Thou My Vision (SLANE)" },
                },
            ],
        });

        await expect(submit({ pcoSongId: "26000001" })).resolves.toMatchObject({
            status: "error",
            fieldErrors: {
                link: {
                    message: expect.stringContaining("Undo that link first."),
                    link: { href: "/catalog/songs/9", label: "Be Thou My Vision (SLANE)" },
                },
            },
        });
    });

    test("keeps the first problem of each part", async () => {
        createSong.mockResolvedValue({
            ok: false,
            problems: [
                { reason: "book-not-found", part: "entry", message: "First.", existing: null },
                { reason: "number-taken", part: "entry", message: "Second.", existing: null },
            ],
        });

        await expect(submit()).resolves.toMatchObject({
            fieldErrors: { entry: { message: "First." } },
        });
    });

    test("returns a message, and logs the cause, when adding the song throws", async () => {
        const cause = new Error("database is locked");
        createSong.mockRejectedValue(cause);

        await expect(submit()).resolves.toEqual({
            status: "error",
            message: FORM_FAILURE_MESSAGE,
            fieldErrors: {},
            values: FIELDS,
        });
        expect(console.error).toHaveBeenCalledWith("Failed to add a catalog song:", cause);
        expect(revalidatePath).not.toHaveBeenCalled();
        expect(redirect).not.toHaveBeenCalled();
    });

    test("returns a message when the books cannot be read", async () => {
        getNewSongBooks.mockImplementation(() => {
            throw new Error("no such table: books");
        });

        await expect(submit()).resolves.toMatchObject({ message: FORM_FAILURE_MESSAGE });
        expect(createSong).not.toHaveBeenCalled();
    });
});
