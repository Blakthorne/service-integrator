import "server-only";
import type { DatabaseSync, SQLOutputValue } from "node:sqlite";
import type { CreditLabelSong } from "@/lib/creditLabels";
import type { CreditLabelOutcome, CreditLabelRequest, CreditLabelSource } from "@/lib/domain";
import { withTransaction } from "./transaction";

/**
 * The requests to label songs' authors (`credit_label_requests`, migration
 * 0008_credit_labels): queued by the Credits page or by the app for a new
 * song, written in order by the credit labels job, then ended with an
 * outcome and kept. A song has at most one request waiting.
 */

/**
 * Who may ask, as `credit_label_requests.source`. Checked here rather than
 * by a CHECK, so a new one needs no migration; readers skip a request whose
 * source a newer build wrote.
 */
export const CREDIT_LABEL_SOURCES = ["review", "auto"] as const satisfies readonly CreditLabelSource[];

/** How a request may end, as `credit_label_requests.outcome`; checked the same way. */
export const CREDIT_LABEL_OUTCOMES = [
    "labelled",
    "unchanged",
    "changed",
    "refused",
    "failed",
    "gone",
    "cancelled",
] as const satisfies readonly CreditLabelOutcome[];

export function isCreditLabelSource(value: unknown): value is CreditLabelSource {
    return (CREDIT_LABEL_SOURCES as readonly unknown[]).includes(value);
}

export function isCreditLabelOutcome(value: unknown): value is CreditLabelOutcome {
    return (CREDIT_LABEL_OUTCOMES as readonly unknown[]).includes(value);
}

type Row = Record<string, SQLOutputValue>;

const COLUMNS =
    "id, pco_song_id, source, shown_author, author, requested_at, attempts, finished_at, outcome, message";

/** A row as a request, or null when its source or outcome is one this build does not know. */
function toCreditLabelRequest(row: Row): CreditLabelRequest | null {
    const source = row.source;
    const outcome = row.outcome === null ? null : row.outcome;
    if (!isCreditLabelSource(source) || (outcome !== null && !isCreditLabelOutcome(outcome))) {
        return null;
    }
    return {
        id: Number(row.id),
        pcoSongId: String(row.pco_song_id),
        source,
        shownAuthor: String(row.shown_author),
        author: String(row.author),
        requestedAt: String(row.requested_at),
        attempts: Number(row.attempts),
        finishedAt: row.finished_at === null ? null : String(row.finished_at),
        outcome,
        message: row.message === null ? null : String(row.message),
    };
}

function toRequests(rows: Row[]): CreditLabelRequest[] {
    return rows.flatMap((row) => {
        const request = toCreditLabelRequest(row);
        return request ? [request] : [];
    });
}

/** A request to queue. */
export interface NewCreditLabelRequest {
    pcoSongId: string;
    source: CreditLabelSource;
    /** The author the label was made from; "" for none. */
    shownAuthor: string;
    /** The label to write. */
    author: string;
}

/** What `queueCreditLabels` did: the songs it queued, and those it left because a request for them waits already. */
export interface QueuedCreditLabels {
    queued: string[];
    waiting: string[];
}

/**
 * Queue `requests` at `now`, in order, in one transaction. A song that has a
 * request waiting already keeps it, and a second request for one song in
 * `requests` is left out the same way. Throws, queuing nothing, for a song
 * the mirror does not have (the foreign key), an empty label or a source
 * this build does not know.
 */
export function queueCreditLabels(
    db: DatabaseSync,
    requests: readonly NewCreditLabelRequest[],
    now: Date = new Date()
): QueuedCreditLabels {
    for (const { source } of requests) {
        if (!isCreditLabelSource(source)) {
            throw new Error(`Unknown credit label source: ${String(source)}`);
        }
    }
    return withTransaction(db, () => {
        const isWaiting = db.prepare(
            "SELECT 1 FROM credit_label_requests WHERE pco_song_id = ? AND finished_at IS NULL"
        );
        const insert = db.prepare(
            `INSERT INTO credit_label_requests (pco_song_id, source, shown_author, author, requested_at)
             VALUES (?, ?, ?, ?, ?)`
        );
        const queued: string[] = [];
        const waiting: string[] = [];
        for (const request of requests) {
            if (isWaiting.get(request.pcoSongId) !== undefined) {
                waiting.push(request.pcoSongId);
                continue;
            }
            insert.run(
                request.pcoSongId,
                request.source,
                request.shownAuthor,
                request.author,
                now.toISOString()
            );
            queued.push(request.pcoSongId);
        }
        return { queued, waiting };
    });
}

/** The requests waiting, oldest first, those of a source this build does not know left out. */
export function listWaitingCreditLabels(db: DatabaseSync): CreditLabelRequest[] {
    return toRequests(
        db
            .prepare(
                `SELECT ${COLUMNS} FROM credit_label_requests WHERE finished_at IS NULL ORDER BY id`
            )
            .all()
    );
}

/** The oldest request waiting that this build can read, or null. */
export function nextWaitingCreditLabel(db: DatabaseSync): CreditLabelRequest | null {
    return listWaitingCreditLabels(db)[0] ?? null;
}

/**
 * End request `id` at `now` with `outcome` and `message`. Only a request
 * still waiting ends: false when it had ended already (a person cancelled
 * it while it was written).
 */
export function finishCreditLabel(
    db: DatabaseSync,
    id: number,
    outcome: CreditLabelOutcome,
    message: string | null,
    now: Date = new Date()
): boolean {
    if (!isCreditLabelOutcome(outcome)) {
        throw new Error(`Unknown credit label outcome: ${String(outcome)}`);
    }
    const { changes } = db
        .prepare(
            `UPDATE credit_label_requests SET finished_at = ?, outcome = ?, message = ?
             WHERE id = ? AND finished_at IS NULL`
        )
        .run(now.toISOString(), outcome, message, id);
    return Number(changes) > 0;
}

/**
 * Put request `id` off after a write that failed: count the attempt and
 * keep why, leaving it waiting. Gives its attempts now, or null when it
 * was not waiting.
 */
export function putOffCreditLabel(db: DatabaseSync, id: number, message: string): number | null {
    const row = db
        .prepare(
            `UPDATE credit_label_requests SET attempts = attempts + 1, message = ?
             WHERE id = ? AND finished_at IS NULL RETURNING attempts`
        )
        .get(message, id);
    return row === undefined ? null : Number(row.attempts);
}

/** End every request waiting as "cancelled", at `now`. Gives how many. */
export function cancelWaitingCreditLabels(db: DatabaseSync, now: Date = new Date()): number {
    const { changes } = db
        .prepare(
            `UPDATE credit_label_requests SET finished_at = ?, outcome = 'cancelled', message = NULL
             WHERE finished_at IS NULL`
        )
        .run(now.toISOString());
    return Number(changes);
}

/** The songs the app has ever asked to label by itself, waiting or ended. */
export function listAutoRequestedSongIds(db: DatabaseSync): Set<string> {
    return new Set(
        db
            .prepare("SELECT DISTINCT pco_song_id FROM credit_label_requests WHERE source = 'auto'")
            .all()
            .map((row) => String(row.pco_song_id))
    );
}

/** The `limit` requests that ended last, newest first. */
export function recentCreditLabels(db: DatabaseSync, limit: number): CreditLabelRequest[] {
    return toRequests(
        db
            .prepare(
                `SELECT ${COLUMNS} FROM credit_label_requests WHERE finished_at IS NOT NULL
                 ORDER BY finished_at DESC, id DESC LIMIT ?`
            )
            .all(limit)
    );
}

/**
 * The mirrored songs still in Planning Center, as the Credits page reads
 * them: each one's title, its author, and the catalog song linked to it,
 * by title. One query.
 */
export function listCreditLabelSongs(db: DatabaseSync): CreditLabelSong[] {
    return db
        .prepare(
            `SELECT p.id, p.title, p.author, s.id AS catalog_song_id
             FROM pco_songs p LEFT JOIN songs s ON s.pco_song_id = p.id
             WHERE p.removed_at IS NULL
             ORDER BY p.title, p.id`
        )
        .all()
        .map((row) => ({
            pcoSongId: String(row.id),
            title: String(row.title),
            author: row.author === null ? null : String(row.author),
            catalogSongId: row.catalog_song_id === null ? null : Number(row.catalog_song_id),
        }));
}
