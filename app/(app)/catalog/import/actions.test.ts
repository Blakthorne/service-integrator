import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// vi.hoisted is required: vi.mock is hoisted above const declarations. The
// destructuring must be part of the same statement, so it is hoisted with it.
const {
    Redirected,
    auth,
    revalidatePath,
    redirect,
    previewSeedImport,
    previewBookCsvImport,
    applyCatalogImport,
    discardCatalogImport,
} = vi.hoisted(() => {
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
        previewSeedImport: vi.fn(),
        previewBookCsvImport: vi.fn(),
        applyCatalogImport: vi.fn(),
        discardCatalogImport: vi.fn(),
    };
});
vi.mock("@/auth", () => ({ auth }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/queries/catalogImport", () => ({
    previewSeedImport,
    previewBookCsvImport,
    applyCatalogImport,
    discardCatalogImport,
}));

import { NOT_UTF8_MESSAGE } from "@/lib/catalog/csvUpload";
import { CSV_FIX_FIELDS_MESSAGE } from "@/lib/catalog/importText";
import { FORM_FAILURE_MESSAGE } from "@/lib/forms";
import {
    applyImportAction,
    discardImportAction,
    previewBookCsvAction,
    previewSeedImportAction,
} from "./actions";

const SESSION = {
    user: { email: "someone@example.com" },
    expires: "2026-11-03T12:00:00.000Z",
};

const COUNTS = {
    books: 2,
    hymns: 895,
    hymnAliases: 4,
    tunes: 768,
    tuneAliases: 1,
    songs: 921,
    songsWithoutTune: 107,
    entries: 1247,
};

const CATALOG_NOT_EMPTY = {
    ok: false,
    reason: "catalog-not-empty",
    message: "The catalog already has books, so the seed import cannot run again.",
};

const NOT_A_PREVIEW = {
    ok: false,
    reason: "not-preview",
    message: "The import run has already been applied or discarded.",
};

beforeEach(() => {
    for (const mock of [
        auth,
        revalidatePath,
        redirect,
        previewSeedImport,
        previewBookCsvImport,
        applyCatalogImport,
        discardCatalogImport,
    ]) {
        mock.mockReset();
    }
    auth.mockResolvedValue(SESSION);
    redirect.mockImplementation((url: string) => {
        throw new Redirected(url);
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
});

/** A form with these fields, as the browser would post it. */
function formWith(fields: Record<string, string> = {}): FormData {
    const formData = new FormData();
    for (const [name, value] of Object.entries(fields)) {
        formData.set(name, value);
    }
    return formData;
}

/** The Import a book from CSV form as posted: a book, and a file with this text (a test sets over either). */
function csvForm(over: { bookId?: string; file?: File | null } = {}): FormData {
    const formData = new FormData();
    formData.set("bookId", over.bookId ?? "3");
    const file = over.file === undefined ? new File(["number,title\n12,Amazing Grace\n"], "chorus.csv") : over.file;
    if (file !== null) {
        formData.set("file", file);
    }
    return formData;
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

describe("every import action", () => {
    const actions = [
        ["previewSeedImportAction", () => previewSeedImportAction()],
        ["previewBookCsvAction", () => previewBookCsvAction(csvForm())],
        ["applyImportAction", () => applyImportAction(null, formWith({ runId: "7" }))],
        ["discardImportAction", () => discardImportAction(null, formWith({ runId: "7" }))],
    ] as const;

    test.each(actions)(
        "%s throws without a session, before it touches the catalog",
        async (_name, run) => {
            auth.mockResolvedValue(null);

            await expect(run()).rejects.toThrow("Not signed in");
            expect(previewSeedImport).not.toHaveBeenCalled();
            expect(previewBookCsvImport).not.toHaveBeenCalled();
            expect(applyCatalogImport).not.toHaveBeenCalled();
            expect(discardCatalogImport).not.toHaveBeenCalled();
            expect(revalidatePath).not.toHaveBeenCalled();
            expect(redirect).not.toHaveBeenCalled();
        }
    );
});

describe("previewSeedImportAction", () => {
    test("stores a preview, then goes to the run's review page", async () => {
        previewSeedImport.mockReturnValue(7);

        expect(await redirectedTo(previewSeedImportAction())).toBe("/catalog/import/7");
        expect(previewSeedImport).toHaveBeenCalledTimes(1);
        expect(revalidatePath).toHaveBeenCalledWith("/catalog/import", "layout");
    });

    test("returns a message, and logs the cause, when the preview fails", async () => {
        const cause = new Error("hymns.json is damaged");
        previewSeedImport.mockImplementation(() => {
            throw cause;
        });

        await expect(previewSeedImportAction()).resolves.toEqual({
            error: expect.stringContaining("nothing was changed"),
        });
        expect(console.error).toHaveBeenCalledWith(
            "Failed to preview the seed import:",
            cause
        );
        expect(revalidatePath).not.toHaveBeenCalled();
        expect(redirect).not.toHaveBeenCalled();
    });
});

describe("previewBookCsvAction", () => {
    test("reads the file, previews it for the book and returns the run, revalidating the import pages", async () => {
        previewBookCsvImport.mockReturnValue({ ok: true, runId: 9 });

        await expect(previewBookCsvAction(csvForm())).resolves.toEqual({ status: "previewed", runId: 9 });

        expect(previewBookCsvImport).toHaveBeenCalledWith({
            bookId: 3,
            sourceName: "chorus.csv",
            text: "number,title\n12,Amazing Grace\n",
        });
        expect(revalidatePath.mock.calls).toEqual([["/catalog/import", "layout"]]);
        // The form goes to the run itself: the action does not redirect.
        expect(redirect).not.toHaveBeenCalled();
    });

    test.each([
        ["no book", { bookId: "" }],
        ["a book id that is not an id", { bookId: "3; DROP TABLE books" }],
        ["a zero", { bookId: "0" }],
    ])("marks the book field for %s, previewing nothing", async (_name, over) => {
        const state = await previewBookCsvAction(csvForm(over));

        expect(state).toEqual({
            status: "error",
            message: CSV_FIX_FIELDS_MESSAGE,
            fieldErrors: { book: { message: "Choose the book to import into." } },
            values: {},
        });
        expect(previewBookCsvImport).not.toHaveBeenCalled();
        expect(revalidatePath).not.toHaveBeenCalled();
    });

    test("marks the file field when none was chosen, or the file is empty", async () => {
        await expect(previewBookCsvAction(csvForm({ file: null }))).resolves.toMatchObject({
            status: "error",
            fieldErrors: { file: { message: "Choose a CSV file." } },
        });
        await expect(previewBookCsvAction(csvForm({ file: new File([], "") }))).resolves.toMatchObject({
            fieldErrors: { file: { message: "Choose a CSV file." } },
        });
        await expect(previewBookCsvAction(csvForm({ file: new File([], "empty.csv") }))).resolves.toMatchObject({
            fieldErrors: { file: { message: "empty.csv is empty." } },
        });
        expect(previewBookCsvImport).not.toHaveBeenCalled();
    });

    test("marks the file field for a file over 1 MB, without reading it", async () => {
        const big = new File([new Uint8Array(1024 * 1024 + 1)], "big.csv");

        await expect(previewBookCsvAction(csvForm({ file: big }))).resolves.toMatchObject({
            status: "error",
            fieldErrors: { file: { message: expect.stringContaining("larger than 1 MB") } },
        });
        expect(previewBookCsvImport).not.toHaveBeenCalled();
    });

    test("refuses a file that is not UTF-8, saying how to save it again, and previews nothing", async () => {
        const text = `number,title\n1,Jesus${String.fromCharCode(0xfffd)}s Name\n`;

        await expect(previewBookCsvAction(csvForm({ file: new File([text], "jesus.csv") }))).resolves.toMatchObject({
            status: "error",
            message: CSV_FIX_FIELDS_MESSAGE,
            fieldErrors: { file: { message: NOT_UTF8_MESSAGE } },
        });
        expect(previewBookCsvImport).not.toHaveBeenCalled();
    });

    test("marks the book field when the catalog has no such book", async () => {
        previewBookCsvImport.mockReturnValue({
            ok: false,
            reason: "book-not-found",
            message: "That book is not in the catalog. Choose one from the list.",
        });

        await expect(previewBookCsvAction(csvForm({ bookId: "99" }))).resolves.toMatchObject({
            status: "error",
            fieldErrors: { book: { message: "That book is not in the catalog. Choose one from the list." } },
        });
        expect(revalidatePath).not.toHaveBeenCalled();
    });

    test("marks the file field when the catalog finds it too large", async () => {
        previewBookCsvImport.mockReturnValue({ ok: false, reason: "too-large", message: "The file is larger than 1 MB." });

        await expect(previewBookCsvAction(csvForm())).resolves.toMatchObject({
            fieldErrors: { file: { message: "The file is larger than 1 MB." } },
        });
    });

    test("returns a message, and logs the cause, when the preview fails", async () => {
        const cause = new Error("database is locked");
        previewBookCsvImport.mockImplementation(() => {
            throw cause;
        });

        await expect(previewBookCsvAction(csvForm())).resolves.toMatchObject({
            status: "error",
            message: FORM_FAILURE_MESSAGE,
        });
        expect(console.error).toHaveBeenCalledWith("Failed to preview the CSV file chorus.csv for book 3:", cause);
        expect(revalidatePath).not.toHaveBeenCalled();
    });
});

describe("applyImportAction", () => {
    test("applies the seed, revalidates what shows the catalog and goes to the songs list", async () => {
        applyCatalogImport.mockReturnValue({ ok: true, counts: COUNTS, bookCode: null });

        const url = await redirectedTo(
            applyImportAction(null, formWith({ runId: "7" }))
        );

        expect(url).toBe("/catalog");
        expect(auth).toHaveBeenCalledTimes(1);
        expect(applyCatalogImport).toHaveBeenCalledWith(7);
        // The catalog, the plans' pages and the dashboard show a book's entries as numbers.
        expect(revalidatePath.mock.calls).toEqual([["/catalog", "layout"], ["/plans", "layout"], ["/"]]);
    });

    test("applies a book's file and goes to the book it was imported into", async () => {
        applyCatalogImport.mockReturnValue({ ok: true, counts: COUNTS, bookCode: "CB" });

        await expect(redirectedTo(applyImportAction(null, formWith({ runId: "7" })))).resolves.toBe(
            "/catalog/books/CB"
        );
        expect(revalidatePath.mock.calls).toEqual([["/catalog", "layout"], ["/plans", "layout"], ["/"]]);
    });

    test("never goes to a book code that is not one, but to the songs list", async () => {
        applyCatalogImport.mockReturnValue({ ok: true, counts: COUNTS, bookCode: "../settings" });

        await expect(redirectedTo(applyImportAction(null, formWith({ runId: "7" })))).resolves.toBe("/catalog");
    });

    test.each([
        ["no run id", {}],
        ["an empty run id", { runId: "" }],
        ["a word", { runId: "abc" }],
        ["zero", { runId: "0" }],
        ["a negative number", { runId: "-1" }],
        ["a decimal", { runId: "1.5" }],
        ["a leading zero", { runId: "07" }],
        ["more than ten digits", { runId: "12345678901" }],
    ])("refuses %s without applying anything", async (_name, fields) => {
        await expect(applyImportAction(null, formWith(fields))).resolves.toEqual({
            error: "There is no such import run.",
        });
        expect(applyCatalogImport).not.toHaveBeenCalled();
        expect(revalidatePath).not.toHaveBeenCalled();
        expect(redirect).not.toHaveBeenCalled();
    });

    test("refuses a file where the run id should be", async () => {
        const formData = new FormData();
        formData.set("runId", new File(["7"], "7.txt"));

        await expect(applyImportAction(null, formData)).resolves.toEqual({
            error: "There is no such import run.",
        });
        expect(applyCatalogImport).not.toHaveBeenCalled();
    });

    test.each([
        ["a catalog that already has books", CATALOG_NOT_EMPTY],
        ["a run that is no longer a preview", NOT_A_PREVIEW],
    ])(
        "returns the refusal for %s as it is, and revalidates the import pages behind it",
        async (_name, refusal) => {
            applyCatalogImport.mockReturnValue(refusal);

            await expect(
                applyImportAction(null, formWith({ runId: "7" }))
            ).resolves.toEqual({ error: refusal.message });
            expect(applyCatalogImport).toHaveBeenCalledWith(7);
            expect(revalidatePath).toHaveBeenCalledTimes(1);
            expect(revalidatePath).toHaveBeenCalledWith("/catalog/import", "layout");
            expect(redirect).not.toHaveBeenCalled();
        }
    );

    test("returns a message, and logs the cause, when applying throws", async () => {
        const cause = new Error("disk full");
        applyCatalogImport.mockImplementation(() => {
            throw cause;
        });

        await expect(
            applyImportAction(null, formWith({ runId: "7" }))
        ).resolves.toEqual({ error: expect.stringContaining("nothing was changed") });
        expect(console.error).toHaveBeenCalledWith(
            "Failed to apply import run 7:",
            cause
        );
        expect(revalidatePath).not.toHaveBeenCalled();
        expect(redirect).not.toHaveBeenCalled();
    });
});

describe("discardImportAction", () => {
    test("discards the run, then goes back to the list of runs", async () => {
        discardCatalogImport.mockReturnValue({ ok: true });

        const url = await redirectedTo(
            discardImportAction(null, formWith({ runId: "12" }))
        );

        expect(url).toBe("/catalog/import");
        expect(auth).toHaveBeenCalledTimes(1);
        expect(discardCatalogImport).toHaveBeenCalledWith(12);
        expect(revalidatePath).toHaveBeenCalledWith("/catalog/import", "layout");
    });

    test.each([
        ["no run id", {}],
        ["a word", { runId: "abc" }],
        ["zero", { runId: "0" }],
        ["a leading zero", { runId: "07" }],
    ])("refuses %s without discarding anything", async (_name, fields) => {
        await expect(discardImportAction(null, formWith(fields))).resolves.toEqual({
            error: "There is no such import run.",
        });
        expect(discardCatalogImport).not.toHaveBeenCalled();
        expect(revalidatePath).not.toHaveBeenCalled();
        expect(redirect).not.toHaveBeenCalled();
    });

    test("returns the refusal for a run that is no longer a preview, and revalidates the import pages behind it", async () => {
        discardCatalogImport.mockReturnValue(NOT_A_PREVIEW);

        await expect(
            discardImportAction(null, formWith({ runId: "7" }))
        ).resolves.toEqual({ error: NOT_A_PREVIEW.message });
        expect(revalidatePath).toHaveBeenCalledTimes(1);
        expect(revalidatePath).toHaveBeenCalledWith("/catalog/import", "layout");
        expect(redirect).not.toHaveBeenCalled();
    });

    test("returns a message, and logs the cause, when discarding throws", async () => {
        const cause = new Error("database is locked");
        discardCatalogImport.mockImplementation(() => {
            throw cause;
        });

        await expect(
            discardImportAction(null, formWith({ runId: "7" }))
        ).resolves.toEqual({ error: expect.stringContaining("nothing was changed") });
        expect(console.error).toHaveBeenCalledWith(
            "Failed to discard import run 7:",
            cause
        );
        expect(redirect).not.toHaveBeenCalled();
    });
});
