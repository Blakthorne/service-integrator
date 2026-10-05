import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { parseBookCode } from "@/lib/catalog/ids";
import { openTestDb } from "../testing";

let db: DatabaseSync;

beforeEach(() => {
    db = openTestDb();
});

afterEach(() => {
    db.close();
});

function columns(table: string): string[] {
    return db
        .prepare("SELECT name FROM pragma_table_info(?) ORDER BY cid")
        .all(table)
        .map((row) => String(row.name));
}

/** Run an INSERT and return the new row's id. */
function insert(sql: string, ...params: SQLInputValue[]): number {
    return Number(db.prepare(sql).run(...params).lastInsertRowid);
}

function book(code: string, numbered = 1): number {
    return insert(
        "INSERT INTO books (code, name, short_name, numbered, label_format, sort_order) VALUES (?, ?, ?, ?, ?, 1)",
        code,
        `Book ${code}`,
        code,
        numbered,
        `${code}-{n}`
    );
}

function hymn(title = "Amazing Grace"): number {
    return insert("INSERT INTO hymns (title) VALUES (?)", title);
}

function tune(name = "NEW BRITAIN"): number {
    return insert("INSERT INTO tunes (name) VALUES (?)", name);
}

function song(hymnId: number, tuneId: number | null, pcoSongId: string | null = null): number {
    return insert(
        "INSERT INTO songs (hymn_id, tune_id, pco_song_id) VALUES (?, ?, ?)",
        hymnId,
        tuneId,
        pcoSongId
    );
}

function entry(
    bookId: number,
    songId: number,
    number: number | null,
    variantNote: string | null = null
): number {
    return insert(
        "INSERT INTO entries (book_id, song_id, number, variant_note) VALUES (?, ?, ?, ?)",
        bookId,
        songId,
        number,
        variantNote
    );
}

function count(table: string): number {
    return Number(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n);
}

describe("0002_catalog", () => {
    test("creates the catalog tables", () => {
        expect(columns("books")).toEqual([
            "id",
            "code",
            "name",
            "short_name",
            "numbered",
            "label_format",
            "sort_order",
            "active",
        ]);
        expect(columns("hymns")).toEqual(["id", "title", "first_line", "notes"]);
        expect(columns("hymn_aliases")).toEqual([
            "id",
            "hymn_id",
            "alias",
            "normalized",
        ]);
        expect(columns("tunes")).toEqual(["id", "name", "meter", "notes"]);
        expect(columns("tune_aliases")).toEqual([
            "id",
            "tune_id",
            "alias",
            "normalized",
        ]);
        expect(columns("songs")).toEqual([
            "id",
            "hymn_id",
            "tune_id",
            "pco_song_id",
            "linked_at",
            "linked_by",
            "notes",
        ]);
        expect(columns("entries")).toEqual([
            "id",
            "book_id",
            "song_id",
            "number",
            "position",
            "location_label",
            "variant_note",
        ]);
        expect(columns("import_runs")).toEqual([
            "id",
            "at",
            "kind",
            "book_id",
            "status",
            "source_name",
            "report",
            "rows",
        ]);
    });

    test("indexes entries by song", () => {
        const index = db
            .prepare(
                "SELECT name FROM pragma_index_info('entries_song_id')"
            )
            .all();
        expect(index).toEqual([{ name: "song_id" }]);
    });

    describe("books", () => {
        test("a code is unique without regard to case, and found in any case", () => {
            const id = book("R");
            expect(() => book("r")).toThrow("UNIQUE constraint failed: books.code");
            expect(
                db.prepare("SELECT id FROM books WHERE code = ?").get("r")
            ).toEqual({ id });
        });

        test("a code is exactly what parseBookCode accepts, so it can go into a URL as it is", () => {
            const codes = [
                "R",
                "g",
                "CB",
                "Chorus",
                "R2",
                "Hymns_2",
                "a-b",
                "z-_9",
                "ABCDEFGH",
                "",
                "1",
                "2R",
                "-R",
                "_R",
                "ABCDEFGHI",
                "R G",
                " R",
                "R ",
                "R\n",
                "R\t",
                "R.1",
                "R/1",
                "../R",
                "%52",
                "R*",
                "R?",
                "R[",
                "R]",
                "R^",
                "\u00C9",
                "R\u00E9",
                "\uFF32",
            ];
            for (const code of codes) {
                let accepted = true;
                try {
                    db.prepare("DELETE FROM books").run();
                    book(code);
                } catch (error) {
                    expect(String(error)).toContain("CHECK constraint failed");
                    accepted = false;
                }
                expect({ code, accepted }).toEqual({
                    code,
                    accepted: parseBookCode(code) !== null,
                });
            }
        });

        test("numbered and active are 0 or 1, and a book is active by default", () => {
            const id = book("CB", 0);
            expect(
                db.prepare("SELECT numbered, active FROM books WHERE id = ?").get(id)
            ).toEqual({ numbered: 0, active: 1 });
            expect(() => book("X", 2)).toThrow("CHECK constraint failed");
            expect(() =>
                db.prepare("UPDATE books SET active = 2 WHERE id = ?").run(id)
            ).toThrow("CHECK constraint failed");
        });
    });

    describe("aliases", () => {
        test("a hymn alias's normalized form is unique, and the aliases go with their hymn", () => {
            const first = hymn("Rejoice, the Lord Is King");
            const second = hymn("Another Hymn");
            const add = (hymnId: number, alias: string, normalized: string) =>
                insert(
                    "INSERT INTO hymn_aliases (hymn_id, alias, normalized) VALUES (?, ?, ?)",
                    hymnId,
                    alias,
                    normalized
                );
            add(first, "Rejoice \u2013 the Lord Is King!", "rejoice \u2013 the lord is king");
            expect(() =>
                add(second, "Rejoice \u2013 The Lord Is King", "rejoice \u2013 the lord is king")
            ).toThrow("UNIQUE constraint failed: hymn_aliases.normalized");
            expect(() => add(999, "Missing", "missing")).toThrow(
                "FOREIGN KEY constraint failed"
            );

            db.prepare("DELETE FROM hymns WHERE id = ?").run(first);
            expect(count("hymn_aliases")).toBe(0);
        });

        test("a tune alias's normalized form is unique, and the aliases go with their tune", () => {
            const darwall = tune("DARWALL");
            const add = (tuneId: number, alias: string) =>
                insert(
                    "INSERT INTO tune_aliases (tune_id, alias, normalized) VALUES (?, ?, ?)",
                    tuneId,
                    alias,
                    alias.toUpperCase()
                );
            add(darwall, "DARWAL");
            expect(() => add(tune("OTHER"), "Darwal")).toThrow(
                "UNIQUE constraint failed: tune_aliases.normalized"
            );

            db.prepare("DELETE FROM tunes WHERE id = ?").run(darwall);
            expect(count("tune_aliases")).toBe(0);
        });
    });

    describe("songs", () => {
        test("a hymn has one song per tune", () => {
            const amazingGrace = hymn();
            const newBritain = tune();
            song(amazingGrace, newBritain);
            song(amazingGrace, tune("ST. PETER"));
            song(hymn("Other Hymn"), newBritain);
            expect(() => song(amazingGrace, newBritain)).toThrow(
                "UNIQUE constraint failed: songs.hymn_id, songs.tune_id"
            );
        });

        test("a hymn has at most one song with no tune, beside its songs with tunes", () => {
            const thankYouLord = hymn("Thank You, Lord");
            song(thankYouLord, null);
            song(thankYouLord, tune("LYNCH"));
            song(hymn("Another Hymn"), null);
            // The partial index, not UNIQUE (hymn_id, tune_id): NULLs are distinct there.
            expect(() => song(thankYouLord, null)).toThrow(
                /UNIQUE constraint failed: songs\.hymn_id$/
            );
            expect(count("songs")).toBe(3);
        });

        test("a Planning Center song links to one song at most; unlinked songs are many", () => {
            const amazingGrace = hymn();
            song(amazingGrace, tune("NEW BRITAIN"), "12345");
            song(amazingGrace, tune("ST. PETER"), null);
            song(amazingGrace, tune("AMAZING GRACE"), null);
            expect(() => song(amazingGrace, tune("MCINTOSH"), "12345")).toThrow(
                "UNIQUE constraint failed: songs.pco_song_id"
            );
        });

        test("a song needs an existing hymn, and a tune that exists when it has one", () => {
            expect(() => song(999, null)).toThrow("FOREIGN KEY constraint failed");
            expect(() => song(hymn(), 999)).toThrow("FOREIGN KEY constraint failed");
        });

        test("a hymn or tune with songs cannot be deleted", () => {
            const hymnId = hymn();
            const tuneId = tune();
            song(hymnId, tuneId);
            expect(() =>
                db.prepare("DELETE FROM hymns WHERE id = ?").run(hymnId)
            ).toThrow("FOREIGN KEY constraint failed");
            expect(() =>
                db.prepare("DELETE FROM tunes WHERE id = ?").run(tuneId)
            ).toThrow("FOREIGN KEY constraint failed");
        });
    });

    describe("entries", () => {
        let rejoice: number;
        let great: number;
        let amazingGrace: number;

        beforeEach(() => {
            rejoice = book("R");
            great = book("G");
            amazingGrace = song(hymn(), tune());
        });

        test("a number is above 0, or null", () => {
            entry(rejoice, amazingGrace, 1);
            entry(great, amazingGrace, null);
            expect(() => entry(rejoice, song(hymn("B"), null), 0)).toThrow(
                "CHECK constraint failed"
            );
            expect(() => entry(rejoice, song(hymn("C"), null), -1)).toThrow(
                "CHECK constraint failed"
            );
        });

        test("a number appears once per book, and entries without a number are many", () => {
            entry(rejoice, amazingGrace, 396);
            entry(great, amazingGrace, 396);
            expect(() => entry(rejoice, song(hymn("Other"), null), 396)).toThrow(
                "UNIQUE constraint failed: entries.book_id, entries.number"
            );

            const doxology = song(hymn("Doxology"), null);
            insert(
                "INSERT INTO entries (book_id, song_id, location_label) VALUES (?, ?, 'front cover')",
                great,
                doxology
            );
            insert(
                "INSERT INTO entries (book_id, song_id, location_label) VALUES (?, ?, 'back cover')",
                great,
                song(hymn("Gloria Patri"), null)
            );
            expect(count("entries")).toBe(4);
        });

        test("a song appears once per book for each variant note", () => {
            entry(rejoice, amazingGrace, 227, null);
            entry(rejoice, amazingGrace, 228, "Descant - last stanza only");
            entry(rejoice, amazingGrace, 229, "A Round");
            expect(() =>
                entry(rejoice, amazingGrace, 230, "A Round")
            ).toThrow(
                "UNIQUE constraint failed: entries.book_id, entries.song_id, entries.variant_note"
            );
        });

        test("a song appears once per book with no variant note", () => {
            entry(rejoice, amazingGrace, 45);
            entry(great, amazingGrace, 42);
            // The partial index, not the three-column UNIQUE: NULLs are distinct there.
            const withoutVariant =
                /UNIQUE constraint failed: entries\.book_id, entries\.song_id$/;
            expect(() => entry(rejoice, amazingGrace, 46)).toThrow(withoutVariant);
            expect(() => entry(rejoice, amazingGrace, null)).toThrow(withoutVariant);
        });

        test("an entry needs an existing book and song", () => {
            expect(() => entry(999, amazingGrace, 1)).toThrow(
                "FOREIGN KEY constraint failed"
            );
            expect(() => entry(rejoice, 999, 1)).toThrow(
                "FOREIGN KEY constraint failed"
            );
        });

        test("a song or book with entries cannot be deleted: entries do not cascade", () => {
            entry(rejoice, amazingGrace, 1);
            expect(() =>
                db.prepare("DELETE FROM songs WHERE id = ?").run(amazingGrace)
            ).toThrow("FOREIGN KEY constraint failed");
            expect(() =>
                db.prepare("DELETE FROM books WHERE id = ?").run(rejoice)
            ).toThrow("FOREIGN KEY constraint failed");
            expect(count("entries")).toBe(1);
        });
    });

    describe("import_runs", () => {
        const add = (report: string, rows: string, bookId: number | null = null) =>
            insert(
                "INSERT INTO import_runs (at, kind, book_id, status, source_name, report, rows) VALUES ('2026-10-04T12:00:00.000Z', 'hymns-json', ?, 'preview', 'hymns.json', ?, ?)",
                bookId,
                report,
                rows
            );

        test("the report and rows must be JSON", () => {
            add('{"songs":921}', "[]");
            expect(() => add("{oops", "[]")).toThrow("CHECK constraint failed");
            expect(() => add("{}", "not json")).toThrow("CHECK constraint failed");
        });

        test("a run outlives the book it imported into", () => {
            const bookId = book("CB", 0);
            const id = add("{}", "{}", bookId);
            expect(() => add("{}", "{}", 999)).toThrow("FOREIGN KEY constraint failed");

            db.prepare("DELETE FROM books WHERE id = ?").run(bookId);
            expect(
                db.prepare("SELECT book_id FROM import_runs WHERE id = ?").get(id)
            ).toEqual({ book_id: null });
        });
    });
});
