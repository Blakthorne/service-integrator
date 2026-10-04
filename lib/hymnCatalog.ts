import "server-only";
import hymnData from "@/hymns.json";
import type { RawHymn } from "@/lib/import/hymnsJson";

/**
 * The hymnbook catalog (Rejoice Hymns + Great Hymns of the Faith). Server-only
 * so its ~150 KB never reaches client bundles.
 */
export const hymnCatalog = hymnData as RawHymn[];
