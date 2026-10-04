import "server-only";
import { parseCatalogId } from "@/lib/catalog/ids";
import { getDb } from "@/lib/db";
import { applyImportRun, findApplyRefusal } from "@/lib/db/catalogImport";
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
import { hymnCatalog } from "@/lib/hymnCatalog";
import { planHymnsJsonImport } from "@/lib/import/hymnsJson";
import { labelOr } from "./catalog";

/**
 * The catalog's imports, for the Import pages and their actions: preview the
 * seed from hymns.json, review a run, apply or discard it. Synchronous, like
 * the database. Apply and discard return a refusal (a run already applied,
 * a catalog that already has books) rather than throwing, so an action can
 * show it; anything unexpected, such as a database that cannot be opened,
 * still throws.
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
    const plan = planHymnsJsonImport(hymnCatalog);
    return createImportRun(getDb(), {
        kind: "hymns-json",
        sourceName: SEED_SOURCE_NAME,
        ...plan,
    });
}

/** Every import run, newest first. */
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
    | { ok: true; counts: ImportCounts }
    | ({ ok: false } & ImportRunRefusal);

/**
 * Apply a previewed run: add every row it planned, in one transaction, and
 * mark it applied. Refused for a run that is not a preview, while the catalog
 * has books, or when its rows are damaged.
 */
export function applyCatalogImport(runId: number): ApplyCatalogImportResult {
    try {
        return { ok: true, counts: applyImportRun(getDb(), runId) };
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
