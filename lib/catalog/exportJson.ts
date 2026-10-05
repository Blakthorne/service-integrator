/**
 * The catalog as a JSON document, the human-readable backup to keep in
 * git: its books, hymns and tunes with their other names, songs with their
 * Planning Center links, entries and marks. The document is deterministic,
 * so two exports of the same catalog are the same text, and an edit
 * changes only its own lines:
 *
 * - every object's keys are sorted;
 * - rows are sorted by id (marks by song, then mark; other names by their
 *   normalized form, which is unique), and keep their ids;
 * - it is pretty-printed with two spaces, and ends with a line break;
 * - it says nothing about when it was made: the file's name does.
 *
 * Pure and safe on both sides: lib/db/export.ts reads the rows, and the
 * browser names the download (`catalogExportFileName`).
 */

/** What the document says it is, so a reader can tell it from other JSON. */
export const CATALOG_EXPORT_FORMAT = "service-integrator-catalog";

/** The document's version: a change to its shape is a new one. */
export const CATALOG_EXPORT_VERSION = 1;

/** Another name of a hymn or tune, with the form it is matched by. */
export interface ExportAlias {
    alias: string;
    normalized: string;
}

export interface ExportBook {
    id: number;
    code: string;
    name: string;
    shortName: string;
    numbered: boolean;
    labelFormat: string;
    sortOrder: number;
    active: boolean;
}

export interface ExportHymn {
    id: number;
    title: string;
    firstLine: string | null;
    notes: string | null;
    aliases: ExportAlias[];
}

export interface ExportTune {
    id: number;
    name: string;
    meter: string | null;
    notes: string | null;
    aliases: ExportAlias[];
}

export interface ExportSong {
    id: number;
    hymnId: number;
    tuneId: number | null;
    /** The Planning Center song it is linked to, with when and how; all null when it is not linked. */
    pcoSongId: string | null;
    linkedAt: string | null;
    linkedBy: string | null;
    notes: string | null;
}

export interface ExportEntry {
    id: number;
    bookId: number;
    songId: number;
    number: number | null;
    position: number | null;
    locationLabel: string | null;
    variantNote: string | null;
}

export interface ExportMark {
    songId: number;
    /** As stored, such as "to-learn": a backup keeps a mark a newer build wrote too. */
    mark: string;
    note: string | null;
    createdAt: string;
}

/** Everything the document holds, in any order: `buildCatalogExport` sorts it. */
export interface CatalogExportData {
    books: ExportBook[];
    hymns: ExportHymn[];
    tunes: ExportTune[];
    songs: ExportSong[];
    entries: ExportEntry[];
    marks: ExportMark[];
}

/** A copy of a JSON value with every object's keys sorted, at every depth. */
function sortKeys(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(sortKeys);
    }
    if (typeof value === "object" && value !== null) {
        return Object.fromEntries(
            Object.keys(value)
                .sort()
                .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])])
        );
    }
    return value;
}

function byId<T extends { id: number }>(rows: readonly T[]): T[] {
    return [...rows].sort((a, b) => a.id - b.id);
}

/** Compare by a key; equal keys give 0. */
function compare<T>(a: T, b: T): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

function withSortedAliases<T extends { aliases: ExportAlias[] }>(row: T): T {
    return { ...row, aliases: [...row.aliases].sort((a, b) => compare(a.normalized, b.normalized)) };
}

/**
 * The catalog as its JSON document (see the module's comment): the same
 * data, in any order, always gives the same text.
 */
export function buildCatalogExport(data: CatalogExportData): string {
    const document = {
        format: CATALOG_EXPORT_FORMAT,
        version: CATALOG_EXPORT_VERSION,
        books: byId(data.books),
        hymns: byId(data.hymns).map(withSortedAliases),
        tunes: byId(data.tunes).map(withSortedAliases),
        songs: byId(data.songs),
        entries: byId(data.entries),
        marks: [...data.marks].sort((a, b) => a.songId - b.songId || compare(a.mark, b.mark)),
    };
    return `${JSON.stringify(sortKeys(document), null, 2)}\n`;
}

/** Two digits: 4 is "04". */
function twoDigits(value: number): string {
    return String(value).padStart(2, "0");
}

/** The name the browser saves an export as on `date`, by its own calendar: "catalog-2026-10-04.json". */
export function catalogExportFileName(date: Date): string {
    return `catalog-${date.getFullYear()}-${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())}.json`;
}

/** The media type of the download. */
export const CATALOG_EXPORT_MIME_TYPE = "application/json;charset=utf-8";
