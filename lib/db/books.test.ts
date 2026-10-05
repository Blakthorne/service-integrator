import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { NewBookInput } from "@/lib/catalog/validation";
import { addBook, editBook, moveBook } from "./books";
import { listBooks } from "./catalog";
import { openTestDb, seedBook } from "./testing";

let db: DatabaseSync;

beforeEach(() => {
    db = openTestDb();
});

afterEach(() => {
    db.close();
});

function chorusBook(fields: Partial<NewBookInput> = {}): NewBookInput {
    return {
        code: "CB",
        name: "Chorus Book",
        shortName: "Chorus Book",
        numbered: false,
        labelFormat: "Chorus Book",
        ...fields,
    };
}

function bookRow(bookId: number) {
    return db
        .prepare("SELECT code, name, short_name, numbered, label_format, sort_order, active FROM books WHERE id = ?")
        .get(bookId);
}

/** The books' codes and sort orders, in the order they are listed. */
function order(): [string, number][] {
    return listBooks(db).map(({ code, sortOrder }) => [code, sortOrder]);
}

describe("addBook", () => {
    test("adds an unnumbered book last, in use", () => {
        seedBook(db, { code: "R", sortOrder: 1 });
        seedBook(db, { code: "G", sortOrder: 2 });
        const result = addBook(db, chorusBook());
        expect(result).toEqual({ ok: true, bookId: expect.any(Number), code: "CB" });
        expect(bookRow(result.ok ? result.bookId : 0)).toEqual({
            code: "CB",
            name: "Chorus Book",
            short_name: "Chorus Book",
            numbered: 0,
            label_format: "Chorus Book",
            sort_order: 3,
            active: 1,
        });
    });

    test("adds a numbered book to an empty catalog, first", () => {
        const result = addBook(db, {
            code: "hb",
            name: "Hymns of Faith",
            shortName: "Faith",
            numbered: true,
            labelFormat: "hb-{n}",
        });
        expect(result).toMatchObject({ ok: true, code: "hb" });
        expect(bookRow(result.ok ? result.bookId : 0)).toMatchObject({ numbered: 1, sort_order: 1 });
    });

    test("refuses a code another book has, in any case, naming it", () => {
        seedBook(db, { code: "CB", name: "Choruses" });
        expect(addBook(db, chorusBook({ code: "cb" }))).toEqual({
            ok: false,
            problems: [
                {
                    reason: "code-taken",
                    part: "code",
                    message: "The code CB is taken by Choruses. Choose another.",
                    existing: { kind: "book", code: "CB", label: "Choruses" },
                },
            ],
        });
        expect(listBooks(db)).toHaveLength(1);
    });

    test("refuses a code parseBookCode does not accept, before the database's CHECK would", () => {
        for (const code of ["", "1R", "TOOLONGCODE", "C B", "R/1"]) {
            expect(addBook(db, chorusBook({ code }))).toMatchObject({
                ok: false,
                problems: [{ reason: "code-invalid", part: "code" }],
            });
        }
        expect(listBooks(db)).toEqual([]);
    });

    test("refuses a label format that does not suit the book", () => {
        expect(addBook(db, chorusBook({ labelFormat: "CB-{n}" }))).toMatchObject({
            ok: false,
            problems: [{ reason: "label-format", part: "labelFormat" }],
        });
        expect(addBook(db, chorusBook({ numbered: true, labelFormat: "Chorus Book" }))).toMatchObject({
            ok: false,
            problems: [
                {
                    reason: "label-format",
                    message: "A numbered book's label needs {n} where the number goes, such as R-{n}.",
                },
            ],
        });
    });
});

describe("editBook", () => {
    test("changes the name, short name, label format and whether the book is in use", () => {
        const book = seedBook(db, { code: "R", name: "Rejoice", shortName: "Rejoice" });
        expect(
            editBook(db, {
                bookId: book,
                name: "Rejoice Hymns",
                shortName: "Rejoice",
                labelFormat: "RH-{n}",
                active: false,
            })
        ).toEqual({ ok: true, bookId: book, code: "R" });
        expect(bookRow(book)).toMatchObject({
            name: "Rejoice Hymns",
            short_name: "Rejoice",
            label_format: "RH-{n}",
            active: 0,
            numbered: 1,
        });
    });

    test("gives a blank short name the name, and a blank label format the book's default", () => {
        const numbered = seedBook(db, { code: "R" });
        const unnumbered = seedBook(db, { code: "CB", numbered: false });
        editBook(db, { bookId: numbered, name: "Rejoice Hymns", shortName: null, labelFormat: null, active: true });
        editBook(db, { bookId: unnumbered, name: "Chorus Book", shortName: "Choruses", labelFormat: null, active: true });
        expect(bookRow(numbered)).toMatchObject({ short_name: "Rejoice Hymns", label_format: "R-{n}" });
        expect(bookRow(unnumbered)).toMatchObject({ short_name: "Choruses", label_format: "Choruses" });
    });

    test("refuses a label format that does not suit the book, and a book that is not there", () => {
        const book = seedBook(db, { code: "CB", numbered: false, labelFormat: "Chorus Book" });
        expect(
            editBook(db, { bookId: book, name: "Chorus Book", shortName: null, labelFormat: "CB-{n}", active: true })
        ).toMatchObject({ ok: false, problems: [{ reason: "label-format", part: "labelFormat" }] });
        expect(bookRow(book)).toMatchObject({ label_format: "Chorus Book" });
        expect(
            editBook(db, { bookId: 999, name: "X", shortName: null, labelFormat: null, active: true })
        ).toEqual({
            ok: false,
            problems: [{ reason: "book-not-found", part: "book", message: "That book is not in the catalog.", existing: null }],
        });
    });
});

describe("moveBook", () => {
    test("swaps a book with the one before or after it, making the orders 1, 2, 3", () => {
        seedBook(db, { code: "R", sortOrder: 1 });
        const great = seedBook(db, { code: "G", sortOrder: 5 });
        seedBook(db, { code: "CB", sortOrder: 9 });
        expect(moveBook(db, great, "up")).toEqual({ ok: true, changed: true, sortOrder: 1 });
        expect(order()).toEqual([
            ["G", 1],
            ["R", 2],
            ["CB", 3],
        ]);
        expect(moveBook(db, great, "down")).toEqual({ ok: true, changed: true, sortOrder: 2 });
        expect(order()).toEqual([
            ["R", 1],
            ["G", 2],
            ["CB", 3],
        ]);
    });

    test("leaves the first book where it is when moved up, and the last when moved down", () => {
        const first = seedBook(db, { code: "R" });
        const last = seedBook(db, { code: "G" });
        expect(moveBook(db, first, "up")).toEqual({ ok: true, changed: false, sortOrder: 1 });
        expect(moveBook(db, last, "down")).toEqual({ ok: true, changed: false, sortOrder: 2 });
        expect(moveBook(db, 999, "up")).toMatchObject({ ok: false, problems: [{ reason: "book-not-found" }] });
    });
});
