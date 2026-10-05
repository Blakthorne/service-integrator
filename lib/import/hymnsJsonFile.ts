import "server-only";
import hymnData from "@/hymns.json";
import type { RawHymn } from "./hymnsJson";

/**
 * The records of `hymns.json`, the input of the seed import
 * (`planHymnsJsonImport`) and nothing else: plan pages and the catalog read
 * the database. This is the only module that imports the file. It is
 * server-only so that its ~150 KB never reaches a client bundle. The seed
 * import, this module and the file stay until production has applied the
 * seed, and can be removed after that.
 */
export const hymnsJsonRecords = hymnData as RawHymn[];
