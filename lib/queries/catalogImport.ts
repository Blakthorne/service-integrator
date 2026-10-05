import "server-only";
import { parseCatalogId } from "@/lib/catalog/ids";
import { BOOK_CSV_MAX_BYTES, cleanSourceName } from "@/lib/catalog/validation";
import { getDb } from "@/lib/db";
import { applyImportRun, findApplyRefusal, previewBookCsvRun } from "@/lib/db/catalogImport";
import {
    createImportRun,
    discardImportRun,
    findImportRun,
    findImportRunLabel,
    ImportRunError,
    listImportRuns,
    type ImportRunErrorReason,
} from "@/lib/db/importRuns";
import type { ImportCounts, ImportRunDetail, ImportRunSummary } from "@/lib/domain";
import { planHymnsJsonImport } from "@/lib/import/hymnsJson";
import { hymnsJsonRecords } from "@/lib/import/hymnsJsonFile";
import { labelOr } from "./catalog";

/**
 * The catalog's imports, for the Import pages and their actions: preview the
 * seed from hymns.json, or a book's CSV file; review a run, apply or discard
 * it. Synchronous, like the database. A preview, apply and discard return a
 * refusal (a file too large, a run already applied, a catalog that already
 * has books, a book file whose plan changed) rather than throwing, so an
 * action can show it; anything unexpected, such as a database that cannot
 * be opened, still throws.
 *
 * The seed stays until production has applied it; it, its planner and
 * hymns.json can be removed after that. Applying it refuses once the
 * catalog has books, so it can never run twice.
 */

/** What the seed import reads. */
export const SEED_SOURCE_NAME = "hymns.json";

/** Why a run cannot be applied or discarded, with a message fit to show. */
export interface ImportRunRefusal {
    reason: ImportRunErrorReason;
    message: string;
}

function refusalOf(reason: ImportRunErrorReason): ImportRunRefusal {
    return { reason, message: new ImportRunError(reason).message };
}

/**
 * Plan the seed import from hymns.json and store it as a preview, returning
 * the new run's id for its review page. Previewing always works; applying is
 * what refuses once the catalog has books.
 */
export function previewSeedImport(): number {
    const plan = planHymnsJsonImport(hymnsJsonRecords);
    return createImportRun(getDb(), {
        kind: "hymns-json",
        sourceName: SEED_SOURCE_NAME,
        ...plan,
    });
}

/** What previewing a book's CSV file did: the new run's id, or why there is none. */
export type BookCsvPreviewResult =
    | { ok: true; runId: number }
    | { ok: false; reason: "too-large" | "book-not-found"; message: string };

/**
 * Plan importing a CSV file's text into book `bookId` and store it as a
 * preview, returning the new run's id for its review page. The file's
 * problems (not CSV, a header that does not fit, numbers taken, …) are in
 * the run's report, and block applying it; only a file over
 * `BOOK_CSV_MAX_BYTES` (as UTF-8) or a book that is not in the catalog is
 * refused here, storing nothing. `sourceName`, the file's name, is cleaned
 * (`cleanSourceName`).
 */
export function previewBookCsvImport(
    { bookId, sourceName, text }: { bookId: number; sourceName: string; text: string },
    at: Date = new Date()
): BookCsvPreviewResult {
    if (Buffer.byteLength(text, "utf8") > BOOK_CSV_MAX_BYTES) {
        return {
            ok: false,
            reason: "too-large",
            message: "The file is larger than 1 MB. A book's CSV file is much smaller: is it the right file?",
        };
    }
    const runId = previewBookCsvRun(getDb(), { bookId, sourceName: cleanSourceName(sourceName), text }, at);
    return runId === null
        ? { ok: false, reason: "book-not-found", message: "That book is not in the catalog. Choose one from the list." }
        : { ok: true, runId };
}

/** Every import run, newest first: the seed's and the book files'. */
export function getCatalogImportRuns(): ImportRunSummary[] {
    return listImportRuns(getDb());
}

/** What an import run's review page shows. */
export interface ImportRunReview {
    run: ImportRunDetail;
    /**
     * Why applying it would be refused now (it was applied or discarded, or
     * the catalog has books), or null when Apply can be offered.
     */
    applyRefusal: ImportRunRefusal | null;
}

/** An import run's review, or null when there is no such run. */
export function getCatalogImportRun(runId: number): ImportRunReview | null {
    const db = getDb();
    const run = findImportRun(db, runId);
    if (!run) {
        return null;
    }
    const reason = findApplyRefusal(db, runId);
    return { run, applyRefusal: reason === null ? null : refusalOf(reason) };
}

/** What applying a run did: the rows it added, or why it was refused. */
export type ApplyCatalogImportResult =
    | {
          ok: true;
          counts: ImportCounts;
          /** The code of the book a book's file was imported into, to go to; null for the seed, which adds the books. */
          bookCode: string | null;
      }
    | ({ ok: false } & ImportRunRefusal);

/**
 * Apply a previewed run: add every row it planned, in one transaction, and
 * mark it applied. Refused for a run that is not a preview, or whose rows
 * are damaged; the seed while the catalog has books; a book's file when its
 * report has problems, its book is gone, or the catalog has changed so that
 * it would not add what the preview showed.
 */
export function applyCatalogImport(runId: number): ApplyCatalogImportResult {
    const db = getDb();
    try {
        const counts = applyImportRun(db, runId);
        // Read once it is applied, so a run that is refused is never read for nothing.
        const run = findImportRun(db, runId);
        return { ok: true, counts, bookCode: run?.kind === "csv" ? run.report.book.code : null };
    } catch (error) {
        if (error instanceof ImportRunError) {
            return { ok: false, ...refusalOf(error.reason) };
        }
        throw error;
    }
}

/** What discarding a run did. */
export type DiscardCatalogImportResult = { ok: true } | ({ ok: false } & ImportRunRefusal);

/** Discard a previewed run. Refused for a run that does not exist or is not a preview. */
export function discardCatalogImport(runId: number): DiscardCatalogImportResult {
    try {
        discardImportRun(getDb(), runId);
        return { ok: true };
    } catch (error) {
        if (error instanceof ImportRunError) {
            return { ok: false, ...refusalOf(error.reason) };
        }
        throw error;
    }
}

/** An import run page's title, such as "Seed import 3", or "Import run". Never throws. */
export function getCatalogImportRunLabel(runId: string): string {
    return labelOr(
        runId,
        parseCatalogId,
        (id) => findImportRunLabel(getDb(), id),
        "Import run"
    );
}
