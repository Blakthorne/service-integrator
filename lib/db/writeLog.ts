import "server-only";
import type { DatabaseSync, SQLOutputValue } from "node:sqlite";

/**
 * The log of writes to Planning Center (`write_log`): one row per write the
 * app sends, made or refused, with what was asked for (`payload`) and what
 * came of it (`result`). The `lib/queries` function that calls a write in
 * `lib/pco/writes.ts` records its row; Settings lists the latest ones.
 */

/**
 * The kinds of write, as stored in `write_log.kind`. They are checked here
 * rather than by a CHECK in the schema, so a new kind needs no migration.
 * Only `item-note` (the hymnal notes) is written so far.
 */
export const WRITE_LOG_KINDS = ["item-note", "song", "item", "tags", "email"] as const;

export type WriteLogKind = (typeof WRITE_LOG_KINDS)[number];

export function isWriteLogKind(value: unknown): value is WriteLogKind {
    return (WRITE_LOG_KINDS as readonly unknown[]).includes(value);
}

/** A write to record. */
export interface NewWriteLogEntry {
    kind: WriteLogKind;
    /** What was written, such as `plan 123 item 456`. */
    target: string;
    /** Whether Planning Center made the change. */
    ok: boolean;
    /** What was asked for. Stored as JSON, so it must be JSON-serializable. */
    payload: unknown;
    /** What came of it: what changed, or Planning Center's error. Stored as JSON. */
    result: unknown;
}

/** A row of `write_log`. */
export interface WriteLogEntry extends NewWriteLogEntry {
    id: number;
    /** When it was written, ISO 8601 UTC. */
    at: string;
}

/** `value` as JSON text; throws for a value JSON cannot hold, such as undefined. */
function toJson(value: unknown, column: string): string {
    const text = JSON.stringify(value);
    if (text === undefined) {
        throw new TypeError(`A write log entry's ${column} must be JSON-serializable`);
    }
    return text;
}

function toWriteLogEntry(row: Record<string, SQLOutputValue>): WriteLogEntry {
    return {
        id: Number(row.id),
        at: String(row.at),
        kind: row.kind as WriteLogKind,
        target: String(row.target),
        ok: row.ok === 1,
        payload: JSON.parse(String(row.payload)),
        result: JSON.parse(String(row.result)),
    };
}

/**
 * Record a write made (or refused) at `at`, and return its row's id. Throws
 * on a kind this build does not know and on a payload or result that JSON
 * cannot hold.
 */
export function recordWrite(
    db: DatabaseSync,
    { kind, target, ok, payload, result }: NewWriteLogEntry,
    at: Date = new Date()
): number {
    if (!isWriteLogKind(kind)) {
        throw new Error(`Unknown write log kind: ${JSON.stringify(String(kind))}`);
    }
    const { lastInsertRowid } = db
        .prepare(
            "INSERT INTO write_log (at, kind, target, ok, payload, result) VALUES (?, ?, ?, ?, ?, ?)"
        )
        .run(
            at.toISOString(),
            kind,
            target,
            ok ? 1 : 0,
            toJson(payload, "payload"),
            toJson(result, "result")
        );
    return Number(lastInsertRowid);
}

/**
 * The `limit` most recent writes of the kinds this build knows, newest
 * first (a newer build's kinds are left out). One query.
 */
export function recentWrites(db: DatabaseSync, limit = 20): WriteLogEntry[] {
    const kinds = WRITE_LOG_KINDS.map(() => "?").join(", ");
    return db
        .prepare(
            `SELECT id, at, kind, target, ok, payload, result
             FROM write_log
             WHERE kind IN (${kinds})
             ORDER BY id DESC
             LIMIT ?`
        )
        .all(...WRITE_LOG_KINDS, limit)
        .map(toWriteLogEntry);
}

/**
 * Which of `noteIds` are item notes the app created: each has a successful
 * `item-note` write in the log whose payload's action is "create" and
 * whose result is the note with that id (what lib/queries/hymnNotes.ts
 * records). These are the only notes the app deletes. A create that failed,
 * timed out, or came back without its note counts for nothing, so a note
 * the log does not vouch for is kept. One query, and none for no ids.
 */
export function findCreatedItemNoteIds(
    db: DatabaseSync,
    noteIds: readonly string[]
): Set<string> {
    if (noteIds.length === 0) {
        return new Set();
    }
    const rows = db
        .prepare(
            `SELECT DISTINCT json_extract(result, '$.note.id') AS note_id
             FROM write_log
             WHERE kind = 'item-note'
               AND ok = 1
               AND json_extract(payload, '$.action') = 'create'
               AND json_extract(result, '$.note.id') IN (SELECT value FROM json_each(?))`
        )
        .all(JSON.stringify([...new Set(noteIds)]));
    return new Set(rows.map((row) => String(row.note_id)));
}
