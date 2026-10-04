import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// vi.hoisted is required: vi.mock is hoisted above const declarations.
const {
    auth,
    revalidatePath,
    getCatalogBooks,
    addCatalogBook,
    editCatalogBook,
    moveCatalogBook,
    moveCatalogEntry,
} = vi.hoisted(() => ({
    auth: vi.fn(),
    revalidatePath: vi.fn(),
    getCatalogBooks: vi.fn(),
    addCatalogBook: vi.fn(),
    editCatalogBook: vi.fn(),
    moveCatalogBook: vi.fn(),
    moveCatalogEntry: vi.fn(),
}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/queries/catalog", () => ({ getCatalogBooks }));
vi.mock("@/lib/queries/catalogEdit", () => ({
    addCatalogBook,
    editCatalogBook,
    moveCatalogBook,
    moveCatalogEntry,
}));

import { FIX_BOOK_FIELDS_MESSAGE } from "@/lib/catalog/bookForms";
import { FORM_FAILURE_MESSAGE } from "@/lib/forms";
import { addBookAction, moveBookAction, moveEntryAction, saveBookAction } from "./actions";

const SESSION = {
    user: { email: "someone@example.com" },
    expires: "2026-11-03T12:00:00.000Z",
};

beforeEach(() => {
    for (const mock of [
        auth,
        revalidatePath,
        getCatalogBooks,
        addCatalogBook,
        editCatalogBook,
        moveCatalogBook,
        moveCatalogEntry,
    ]) {
        mock.mockReset();
    }
    auth.mockResolvedValue(SESSION);
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

/** The Add a book form as filled in for a numbered book; a test sets over it. */
function newBook(over: Record<string, string> = {}): FormData {
    return formWith({
        code: "CB",
        name: "Chorus Book",
        shortName: "",
        numbered: "yes",
        labelFormat: "",
        ...over,
    });
}

/** A book's Edit form as posted. */
function editBook(over: Record<string, string> = {}): FormData {
    return formWith({
        bookId: "3",
        name: "Chorus Book",
        shortName: "Choruses",
        labelFormat: "Choruses",
        active: "yes",
        ...over,
    });
}

/** The pages a change to a book revalidates. */
const BOOK_PAGES = [["/catalog", "layout"], ["/plans", "layout"], ["/"]];

describe("every books action", () => {
    const actions = [
        ["addBookAction", () => addBookAction(newBook())],
        ["saveBookAction", () => saveBookAction(editBook())],
        ["moveBookAction", () => moveBookAction(formWith({ bookId: "3", direction: "up" }))],
        ["moveEntryAction", () => moveEntryAction(formWith({ entryId: "9", direction: "down" }))],
    ] as const;

    test.each(actions)("%s throws without a session, before it touches the catalog", async (_name, run) => {
        auth.mockResolvedValue(null);

        await expect(run()).rejects.toThrow("Not signed in");
        for (const mock of [getCatalogBooks, addCatalogBook, editCatalogBook, moveCatalogBook, moveCatalogEntry]) {
            expect(mock).not.toHaveBeenCalled();
        }
        expect(revalidatePath).not.toHaveBeenCalled();
    });
});

describe("addBookAction", () => {
    test("adds the book with its defaults filled in, then revalidates the catalog's pages only", async () => {
        addCatalogBook.mockReturnValue({ ok: true, bookId: 3, code: "CB" });

        const state = await addBookAction(newBook());

        expect(addCatalogBook).toHaveBeenCalledWith({
            code: "CB",
            name: "Chorus Book",
            shortName: "Chorus Book",
            numbered: true,
            labelFormat: "CB-{n}",
        });
        expect(revalidatePath.mock.calls).toEqual([["/catalog", "layout"]]);
        // The form comes back empty, a numbered book again, for the next one.
        expect(state).toEqual({
            status: "success",
            message: "Added Chorus Book (CB).",
            values: { code: "", name: "", shortName: "", numbered: "yes", labelFormat: "" },
        });
    });

    test("a book without numbers labels its entries with its short name", async () => {
        addCatalogBook.mockReturnValue({ ok: true, bookId: 4, code: "CH" });

        await addBookAction(newBook({ code: "CH", name: "Choruses", numbered: "no", shortName: "Chorus Book" }));

        expect(addCatalogBook).toHaveBeenCalledWith({
            code: "CH",
            name: "Choruses",
            shortName: "Chorus Book",
            numbered: false,
            labelFormat: "Chorus Book",
        });
    });

    test("marks every field that needs fixing and keeps what was typed, adding nothing", async () => {
        const state = await addBookAction(newBook({ code: "9", name: " ", numbered: "maybe" }));

        expect(addCatalogBook).not.toHaveBeenCalled();
        expect(revalidatePath).not.toHaveBeenCalled();
        expect(state).toMatchObject({
            status: "error",
            message: FIX_BOOK_FIELDS_MESSAGE,
            values: { code: "9", name: " ", numbered: "maybe" },
        });
        expect(Object.keys(state.status === "error" ? state.fieldErrors : {}).sort()).toEqual([
            "code",
            "name",
            "numbered",
        ]);
    });

    test("marks the code another book has, with a link to that book, and revalidates nothing", async () => {
        addCatalogBook.mockReturnValue({
            ok: false,
            problems: [
                {
                    reason: "code-taken",
                    part: "code",
                    message: "The code cb is taken by Chorus Book. Choose another.",
                    existing: { kind: "book", code: "cb", label: "Chorus Book" },
                },
            ],
        });

        const state = await addBookAction(newBook({ code: "CB" }));

        expect(state).toEqual({
            status: "error",
            message: FIX_BOOK_FIELDS_MESSAGE,
            fieldErrors: {
                code: {
                    message: "The code cb is taken by Chorus Book. Choose another.",
                    link: { href: "/catalog/books/cb", label: "Chorus Book" },
                },
            },
            values: expect.objectContaining({ code: "CB", name: "Chorus Book" }),
        });
        expect(revalidatePath).not.toHaveBeenCalled();
    });

    test("returns a message, and logs the cause, when the write fails", async () => {
        const cause = new Error("database is locked");
        addCatalogBook.mockImplementation(() => {
            throw cause;
        });

        const state = await addBookAction(newBook());

        expect(state).toMatchObject({ status: "error", message: FORM_FAILURE_MESSAGE });
        expect(console.error).toHaveBeenCalledWith("Failed to add a book:", cause);
        expect(revalidatePath).not.toHaveBeenCalled();
    });
});

describe("saveBookAction", () => {
    test("saves the book and revalidates every page that shows its labels", async () => {
        editCatalogBook.mockReturnValue({ ok: true, bookId: 3, code: "CB" });
        getCatalogBooks.mockReturnValue([
            { id: 2, name: "Other", shortName: "Other", labelFormat: "O-{n}", active: true },
            { id: 3, name: "Chorus Book", shortName: "Choruses", labelFormat: "Choruses", active: false },
        ]);

        const state = await saveBookAction(editBook({ active: "no" }));

        expect(editCatalogBook).toHaveBeenCalledWith({
            bookId: 3,
            name: "Chorus Book",
            shortName: "Choruses",
            labelFormat: "Choruses",
            active: false,
        });
        expect(revalidatePath.mock.calls).toEqual(BOOK_PAGES);
        expect(state).toEqual({
            status: "success",
            message: "Saved.",
            values: {
                bookId: "3",
                name: "Chorus Book",
                shortName: "Choruses",
                labelFormat: "Choruses",
                active: "no",
            },
        });
    });

    test("comes back with the book as stored: a blank short name is the name now", async () => {
        editCatalogBook.mockReturnValue({ ok: true, bookId: 3, code: "CB" });
        getCatalogBooks.mockReturnValue([
            { id: 3, name: "Chorus Book", shortName: "Chorus Book", labelFormat: "Chorus Book", active: true },
        ]);

        const state = await saveBookAction(editBook({ shortName: "", labelFormat: "" }));

        expect(editCatalogBook).toHaveBeenCalledWith(expect.objectContaining({ shortName: null, labelFormat: null }));
        expect(state).toMatchObject({
            status: "success",
            values: { shortName: "Chorus Book", labelFormat: "Chorus Book" },
        });
    });

    test("is saved all the same when the book cannot be read back, showing what was posted", async () => {
        editCatalogBook.mockReturnValue({ ok: true, bookId: 3, code: "CB" });
        const cause = new Error("database is locked");
        getCatalogBooks.mockImplementation(() => {
            throw cause;
        });

        const state = await saveBookAction(editBook());

        expect(state).toMatchObject({ status: "success", message: "Saved.", values: { shortName: "Choruses" } });
        expect(revalidatePath.mock.calls).toEqual(BOOK_PAGES);
        expect(console.error).toHaveBeenCalledWith("Failed to read book 3 after saving it:", cause);
    });

    test("refuses an id that is not a book's, with a message of its own and nothing saved", async () => {
        const state = await saveBookAction(editBook({ bookId: "../3" }));

        expect(editCatalogBook).not.toHaveBeenCalled();
        expect(state).toMatchObject({
            status: "error",
            message: "That book is not in the catalog.",
            fieldErrors: {},
        });
    });

    test("marks a label format that does not suit the book, keeping what was typed", async () => {
        editCatalogBook.mockReturnValue({
            ok: false,
            problems: [
                {
                    reason: "label-format",
                    part: "labelFormat",
                    message: "A numbered book's label needs {n} where the number goes, such as R-{n}.",
                    existing: null,
                },
            ],
        });

        const state = await saveBookAction(editBook({ labelFormat: "Chorus" }));

        expect(state).toMatchObject({
            status: "error",
            message: FIX_BOOK_FIELDS_MESSAGE,
            fieldErrors: { labelFormat: { message: expect.stringContaining("{n}") } },
            values: { labelFormat: "Chorus" },
        });
        expect(revalidatePath).not.toHaveBeenCalled();
    });

    test("says a book that is gone is not in the catalog, as the form's message", async () => {
        editCatalogBook.mockReturnValue({
            ok: false,
            problems: [
                { reason: "book-not-found", part: "book", message: "That book is not in the catalog.", existing: null },
            ],
        });

        await expect(saveBookAction(editBook())).resolves.toMatchObject({
            status: "error",
            message: "That book is not in the catalog.",
            fieldErrors: {},
        });
    });

    test("returns a message, and logs the cause, when the write fails", async () => {
        const cause = new Error("database is locked");
        editCatalogBook.mockImplementation(() => {
            throw cause;
        });

        await expect(saveBookAction(editBook())).resolves.toMatchObject({
            status: "error",
            message: FORM_FAILURE_MESSAGE,
        });
        expect(console.error).toHaveBeenCalledWith("Failed to save book 3:", cause);
        expect(revalidatePath).not.toHaveBeenCalled();
    });
});

describe("moveBookAction", () => {
    test("moves the book, says where it is now and revalidates the pages that print its labels", async () => {
        moveCatalogBook.mockReturnValue({ ok: true, changed: true, sortOrder: 1 });

        const outcome = await moveBookAction(formWith({ bookId: "3", direction: "up" }));

        expect(moveCatalogBook).toHaveBeenCalledWith(3, "up");
        expect(outcome).toEqual({ ok: true, changed: true, place: 1 });
        expect(revalidatePath.mock.calls).toEqual(BOOK_PAGES);
    });

    test("a book already at the edge changes nothing, so revalidates nothing", async () => {
        moveCatalogBook.mockReturnValue({ ok: true, changed: false, sortOrder: 1 });

        await expect(moveBookAction(formWith({ bookId: "3", direction: "up" }))).resolves.toEqual({
            ok: true,
            changed: false,
            place: 1,
        });
        expect(revalidatePath).not.toHaveBeenCalled();
    });

    test.each([
        ["an id that is not an id", { bookId: "3; DROP TABLE books", direction: "up" }],
        ["no id", { direction: "up" }],
        ["a direction that is neither", { bookId: "3", direction: "sideways" }],
    ])("refuses %s as a value, before it touches the catalog", async (_what, fields) => {
        const outcome = await moveBookAction(formWith(fields));

        expect(outcome).toMatchObject({ ok: false, message: expect.any(String) });
        expect(moveCatalogBook).not.toHaveBeenCalled();
        expect(revalidatePath).not.toHaveBeenCalled();
    });

    test("passes the catalog's refusal on as its message", async () => {
        moveCatalogBook.mockReturnValue({
            ok: false,
            problems: [{ reason: "book-not-found", part: "book", message: "That book is not in the catalog.", existing: null }],
        });

        await expect(moveBookAction(formWith({ bookId: "3", direction: "down" }))).resolves.toEqual({
            ok: false,
            message: "That book is not in the catalog.",
        });
    });

    test("returns a message, and logs the cause, when the move fails", async () => {
        const cause = new Error("database is locked");
        moveCatalogBook.mockImplementation(() => {
            throw cause;
        });

        await expect(moveBookAction(formWith({ bookId: "3", direction: "down" }))).resolves.toEqual({
            ok: false,
            message: FORM_FAILURE_MESSAGE,
        });
        expect(console.error).toHaveBeenCalledWith("Failed to move book 3:", cause);
    });
});

describe("moveEntryAction", () => {
    test("moves the entry, says its position and revalidates the catalog's pages only", async () => {
        moveCatalogEntry.mockReturnValue({ ok: true, changed: true, position: 4 });

        const outcome = await moveEntryAction(formWith({ entryId: "9", direction: "down" }));

        expect(moveCatalogEntry).toHaveBeenCalledWith(9, "down");
        expect(outcome).toEqual({ ok: true, changed: true, place: 4 });
        expect(revalidatePath.mock.calls).toEqual([["/catalog", "layout"]]);
    });

    test("an entry already at the edge changes nothing, so revalidates nothing", async () => {
        moveCatalogEntry.mockReturnValue({ ok: true, changed: false, position: 1 });

        await expect(moveEntryAction(formWith({ entryId: "9", direction: "up" }))).resolves.toEqual({
            ok: true,
            changed: false,
            place: 1,
        });
        expect(revalidatePath).not.toHaveBeenCalled();
    });

    test.each([
        ["an id that is not an id", { entryId: "0", direction: "up" }],
        ["a direction that is neither", { entryId: "9", direction: "" }],
    ])("refuses %s as a value, before it touches the catalog", async (_what, fields) => {
        const outcome = await moveEntryAction(formWith(fields));

        expect(outcome).toMatchObject({ ok: false });
        expect(moveCatalogEntry).not.toHaveBeenCalled();
    });

    test("passes the catalog's refusal on, such as an entry of a numbered book", async () => {
        moveCatalogEntry.mockReturnValue({
            ok: false,
            problems: [
                {
                    reason: "entry-not-placed",
                    part: "placement",
                    message: "Rejoice Hymns numbers its songs: change the entry's number instead.",
                    existing: null,
                },
            ],
        });

        await expect(moveEntryAction(formWith({ entryId: "9", direction: "up" }))).resolves.toEqual({
            ok: false,
            message: "Rejoice Hymns numbers its songs: change the entry's number instead.",
        });
        expect(revalidatePath).not.toHaveBeenCalled();
    });

    test("returns a message, and logs the cause, when the move fails", async () => {
        const cause = new Error("database is locked");
        moveCatalogEntry.mockImplementation(() => {
            throw cause;
        });

        await expect(moveEntryAction(formWith({ entryId: "9", direction: "up" }))).resolves.toEqual({
            ok: false,
            message: FORM_FAILURE_MESSAGE,
        });
        expect(console.error).toHaveBeenCalledWith("Failed to move entry 9:", cause);
    });
});
