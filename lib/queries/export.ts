import "server-only";
import { buildCatalogExport } from "@/lib/catalog/exportJson";
import { getDb } from "@/lib/db";
import { readCatalogExport } from "@/lib/db/export";

/**
 * Settings › Data › "Export catalog (JSON)": the whole catalog as its
 * deterministic JSON document (lib/catalog/exportJson.ts), read in one go,
 * for the browser to download (`catalogExportFileName` names it). Throws
 * when the database cannot be read.
 */
export function exportCatalogJson(): string {
    return buildCatalogExport(readCatalogExport(getDb()));
}
