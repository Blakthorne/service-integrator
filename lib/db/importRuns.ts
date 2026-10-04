import "server-only";
import type { DatabaseSync, SQLOutputValue } from "node:sqlite";
import type {
    ImportCounts,
    ImportRunDetail,
    ImportRunKind,
    ImportRunStatus,
    ImportRunSummary,
    SeedImportReport,
} from "@/lib/domain";
import type { PlannedCatalogRows } from "@/lib/import/rows";

/**
 * The kinds of import, as stored in `import_runs.kind`. They are checked
 * here rather than by a CHECK in the schema, so a new kind needs no
 * migration; readers skip runs of a kind this build does not know.
 */
export const IMPORT_RUN_KINDS: readonly ImportRunKind[] = ["hymns-json"];

/** The statuses of a run: previewed, then applied or discarded, once. */
export const IMPORT_RUN_STATUSES: readonly ImportRunStatus[] = [
    "preview",
    "applied",
    "discarded",
];

/** What a run of each kind is called, as in "Seed import 3". */
const KIND_NAMES: Record<ImportRunKind, string> = { "hymns-json": "Seed import" };

export function isImportRunKind(value: unknown): value is ImportRunKind {
    return (IMPORT_RUN_KINDS as readonly unknown[]).includes(value);
}

function isStatus(value: unknown): value is ImportRunStatus {
    return (IMPORT_RUN_STATUSES as readonly unknown[]).includes(value);
}

/** Why a run cannot be applied or discarded. */
export type ImportRunErrorReason =
    | "not-found"
    | "not-preview"
    | "catalog-not-empty"
    | "invalid-rows";

const REASON_MESSAGES: Record<ImportRunErrorReason, string> = {
    "not-found": "There is no such import run.",
    "not-preview": "The import run has already been applied or discarded.",
    "catalog-not-empty":
        "The catalog already has books, so the seed import cannot run again.",
    "invalid-rows":
        "The import run's planned rows are damaged. Discard it and preview again.",
};

/**
 * Thrown when an import run cannot be applied or discarded, with a reason
 * and a message fit to show.
 */
export class ImportRunError extends Error {
    readonly reason: ImportRunErrorReason;

    constructor(reason: ImportRunErrorReason, options?: ErrorOptions) {
        super(REASON_MESSAGES[reason], options);
        this.name = "ImportRunError";
        this.reason = reason;
    }
}

/** What a preview stores. */
export interface NewImportRun {
    kind: ImportRunKind;
    /** What it read, such as "hymns.json". */
    sourceName: string;
    /** The book it imports into; null for the seed. */
    bookId?: number | null;
    report: SeedImportReport;
    rows: PlannedCatalogRows;
}

/** Store a previewed import, at `at`. Returns its id. */
export function createImportRun(
    db: DatabaseSync,
    { kind, sourceName, bookId = null, report, rows }: NewImportRun,
    at: Date = new Date()
): number {
    if (!isImportRunKind(kind)) {
        throw new Error(`Unknown import run kind: ${String(kind)}`);
    }
    const { lastInsertRowid } = db
        .prepare(
            "INSERT INTO import_runs (at, kind, book_id, status, source_name, report, rows) VALUES (?, ?, ?, 'preview', ?, ?, ?)"
        )
        .run(
            at.toISOString(),
            kind,
            bookId,
            sourceName,
            JSON.stringify(report),
            JSON.stringify(rows)
        );
    return Number(lastInsertRowid);
}

const NO_COUNTS: ImportCounts = {
    books: 0,
    hymns: 0,
    hymnAliases: 0,
    tunes: 0,
    tuneAliases: 0,
    songs: 0,
    songsWithoutTune: 0,
    entries: 0,
};

/** The counts of a report's `planned` JSON; a count it lacks is 0. */
function toCounts(json: SQLOutputValue): ImportCounts {
    const parsed: unknown = typeof json === "string" ? JSON.parse(json) : null;
    const counts = { ...NO_COUNTS };
    if (typeof parsed === "object" && parsed !== null) {
        for (const key of Object.keys(NO_COUNTS) as (keyof ImportCounts)[]) {
            const value = (parsed as Record<string, unknown>)[key];
            if (typeof value === "number") {
                counts[key] = value;
            }
        }
    }
    return counts;
}

/** The summary columns, with the report's planned counts pulled out by SQLite. */
const SUMMARY_COLUMNS =
    "id, at, kind, status, source_name, book_id, json_extract(report, '$.planned') AS planned";

/** A row of a kind and status this build knows, as a summary; null otherwise. */
function toSummary(row: Record<string, SQLOutputValue>): ImportRunSummary | null {
    if (!isImportRunKind(row.kind) || !isStatus(row.status)) {
        return null;
    }
    return {
        id: Number(row.id),
        at: String(row.at),
        kind: row.kind,
        status: row.status,
        sourceName: String(row.source_name),
        bookId: row.book_id === null ? null : Number(row.book_id),
        planned: toCounts(row.planned),
    };
}

/** Every run this build knows, newest first. */
export function listImportRuns(db: DatabaseSync): ImportRunSummary[] {
    return db
        .prepare(`SELECT ${SUMMARY_COLUMNS} FROM import_runs ORDER BY id DESC`)
        .all()
        .flatMap((row) => toSummary(row) ?? []);
}

/** One run with its report, or null when there is none (or it is of a kind this build does not know). */
export function findImportRun(db: DatabaseSync, id: number): ImportRunDetail | null {
    const row = db
        .prepare(`SELECT ${SUMMARY_COLUMNS}, report FROM import_runs WHERE id = ?`)
        .get(id);
    const summary = row ? toSummary(row) : null;
    if (!row || !summary) {
        return null;
    }
    return { ...summary, report: JSON.parse(String(row.report)) as SeedImportReport };
}

/** A run's page title, such as "Seed import 3", or null when there is no such run (of a kind this build knows). */
export function findImportRunLabel(db: DatabaseSync, id: number): string | null {
    const row = db.prepare("SELECT kind FROM import_runs WHERE id = ?").get(id);
    return row && isImportRunKind(row.kind) ? `${KIND_NAMES[row.kind]} ${id}` : null;
}

/**
 * Move a run on from preview to `status`, as one statement, so two requests
 * cannot both do it. Throws `ImportRunError` when the run does not exist or
 * is not a preview.
 */
export function finishImportRun(
    db: DatabaseSync,
    id: number,
    status: Exclude<ImportRunStatus, "preview">
): void {
    const { changes } = db
        .prepare("UPDATE import_runs SET status = ? WHERE id = ? AND status = 'preview'")
        .run(status, id);
    if (Number(changes) === 0) {
        const exists = db.prepare("SELECT 1 FROM import_runs WHERE id = ?").get(id);
        throw new ImportRunError(exists ? "not-preview" : "not-found");
    }
}

/** Discard a preview. Throws `ImportRunError` when it does not exist or is not a preview. */
export function discardImportRun(db: DatabaseSync, id: number): void {
    finishImportRun(db, id, "discarded");
}
