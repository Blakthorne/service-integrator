import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { openDatabase } from "./connection";
import { withTransaction } from "./transaction";

let db: DatabaseSync;

beforeEach(() => {
    db = openDatabase(":memory:");
    db.exec("CREATE TABLE t (v INTEGER NOT NULL) STRICT");
});

afterEach(() => {
    db.close();
});

function insert(value: number): void {
    db.prepare("INSERT INTO t (v) VALUES (?)").run(value);
}

function values(): number[] {
    return db
        .prepare("SELECT v FROM t ORDER BY v")
        .all()
        .map((row) => Number(row.v));
}

/** Whether a transaction is open on `db`: BEGIN fails inside one. */
function inTransaction(): boolean {
    try {
        db.exec("BEGIN");
    } catch {
        return true;
    }
    db.exec("ROLLBACK");
    return false;
}

describe("withTransaction", () => {
    test("runs fn in a transaction, commits, and returns its result", () => {
        const result = withTransaction(db, () => {
            expect(inTransaction()).toBe(true);
            insert(1);
            insert(2);
            return "done";
        });
        expect(result).toBe("done");
        expect(values()).toEqual([1, 2]);
        expect(inTransaction()).toBe(false);
    });

    test("rolls back and rethrows the same error when fn throws", () => {
        const failure = new Error("boom");
        expect(() =>
            withTransaction(db, () => {
                insert(1);
                throw failure;
            })
        ).toThrow(failure);
        expect(values()).toEqual([]);
        expect(inTransaction()).toBe(false);
    });

    test("rolls back when the commit fails", () => {
        db.exec(`
            CREATE TABLE parent (id INTEGER PRIMARY KEY) STRICT;
            CREATE TABLE child (parent_id INTEGER NOT NULL REFERENCES parent (id)) STRICT;
        `);
        expect(() =>
            withTransaction(db, () => {
                // Deferred, so the missing parent is reported only by COMMIT.
                db.exec("PRAGMA defer_foreign_keys = ON");
                insert(1);
                db.exec("INSERT INTO child VALUES (99)");
            })
        ).toThrow(/FOREIGN KEY constraint failed/);
        expect(values()).toEqual([]);
        expect(inTransaction()).toBe(false);
    });

    test("refuses a function that returns a promise, and rolls back its writes", () => {
        expect(() =>
            withTransaction(db, async () => {
                insert(1);
            })
        ).toThrow(TypeError);
        expect(() => withTransaction(db, () => Promise.resolve(1))).toThrow(
            /needs a synchronous function/
        );
        expect(values()).toEqual([]);
        expect(inTransaction()).toBe(false);
    });

    test("rethrows the original error when SQLite has already rolled back", () => {
        db.exec("CREATE TABLE u (v INTEGER UNIQUE ON CONFLICT ROLLBACK) STRICT");
        expect(() =>
            withTransaction(db, () => {
                insert(1);
                withTransaction(db, () => {
                    db.exec("INSERT INTO u VALUES (1)");
                    // Rolls the whole transaction back, savepoints included.
                    db.exec("INSERT INTO u VALUES (1)");
                });
            })
        ).toThrow(/UNIQUE constraint failed/);
        expect(values()).toEqual([]);
        expect(inTransaction()).toBe(false);

        withTransaction(db, () => insert(5));
        expect(values()).toEqual([5]);
    });

    describe("nested", () => {
        test("an inner call commits with the outer one", () => {
            withTransaction(db, () => {
                insert(1);
                withTransaction(db, () => {
                    insert(2);
                    withTransaction(db, () => insert(3));
                });
            });
            expect(values()).toEqual([1, 2, 3]);
            expect(inTransaction()).toBe(false);
        });

        test("an outer failure undoes the inner call's writes", () => {
            expect(() =>
                withTransaction(db, () => {
                    withTransaction(db, () => insert(1));
                    throw new Error("outer");
                })
            ).toThrow("outer");
            expect(values()).toEqual([]);
            expect(inTransaction()).toBe(false);
        });

        test("an inner failure the outer fn catches undoes only the inner writes", () => {
            withTransaction(db, () => {
                insert(1);
                expect(() =>
                    withTransaction(db, () => {
                        insert(2);
                        throw new Error("inner");
                    })
                ).toThrow("inner");
                insert(3);
            });
            expect(values()).toEqual([1, 3]);
            expect(inTransaction()).toBe(false);
        });

        test("a later top-level call starts a fresh transaction", () => {
            expect(() =>
                withTransaction(db, () => {
                    withTransaction(db, () => {
                        throw new Error("inner");
                    });
                })
            ).toThrow("inner");
            withTransaction(db, () => {
                insert(1);
                expect(inTransaction()).toBe(true);
            });
            expect(values()).toEqual([1]);
            expect(inTransaction()).toBe(false);
        });
    });
});
