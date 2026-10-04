import "server-only";
import type { DatabaseSync, SQLOutputValue } from "node:sqlite";
import type { CatalogExportData, ExportAlias } from "@/lib/catalog/exportJson";
import { withTransaction } from "./transaction";

/**
 * The catalog's rows for its JSON export (lib/catalog/exportJson.ts), as
 * they are stored: every book, hymn, tune, song, entry and mark, and the
 * hymns' and tunes' other names, marks this build does not know included,
 * since the export is a backup.
 */

function nullableText(value: SQLOutputValue): string | null {
    return value === null ? null : String(value);
}

function nullableInt(value: SQLOutputValue): number | null {
    return value === null ? null : Number(value);
}

/** Other names by the row they belong to, from rows of `owner`, `alias`, `normalized`. */
function aliasesByOwner(db: DatabaseSync, sql: string): Map<number, ExportAlias[]> {
    const aliases = new Map<number, ExportAlias[]>();
    for (const row of db.prepare(sql).all()) {
        const owner = Number(row.owner);
        aliases.set(owner, [
            ...(aliases.get(owner) ?? []),
            { alias: String(row.alias), normalized: String(row.normalized) },
        ]);
    }
    return aliases;
}

/**
 * Every row the export holds, read in one transaction, so the document is
 * of one state of the catalog. Eight queries, however big the catalog.
 */
export function readCatalogExport(db: DatabaseSync): CatalogExportData {
    return withTransaction(db, (): CatalogExportData => {
        const hymnAliases = aliasesByOwner(
            db,
            "SELECT hymn_id AS owner, alias, normalized FROM hymn_aliases ORDER BY id"
        );
        const tuneAliases = aliasesByOwner(
            db,
            "SELECT tune_id AS owner, alias, normalized FROM tune_aliases ORDER BY id"
        );
        return {
            books: db
                .prepare(
                    "SELECT id, code, name, short_name, numbered, label_format, sort_order, active FROM books ORDER BY id"
                )
                .all()
                .map((row) => ({
                    id: Number(row.id),
                    code: String(row.code),
                    name: String(row.name),
                    shortName: String(row.short_name),
                    numbered: row.numbered === 1,
                    labelFormat: String(row.label_format),
                    sortOrder: Number(row.sort_order),
                    active: row.active === 1,
                })),
            hymns: db
                .prepare("SELECT id, title, first_line, notes FROM hymns ORDER BY id")
                .all()
                .map((row) => ({
                    id: Number(row.id),
                    title: String(row.title),
                    firstLine: nullableText(row.first_line),
                    notes: nullableText(row.notes),
                    aliases: hymnAliases.get(Number(row.id)) ?? [],
                })),
            tunes: db
                .prepare("SELECT id, name, meter, notes FROM tunes ORDER BY id")
                .all()
                .map((row) => ({
                    id: Number(row.id),
                    name: String(row.name),
                    meter: nullableText(row.meter),
                    notes: nullableText(row.notes),
                    aliases: tuneAliases.get(Number(row.id)) ?? [],
                })),
            songs: db
                .prepare(
                    "SELECT id, hymn_id, tune_id, pco_song_id, linked_at, linked_by, notes FROM songs ORDER BY id"
                )
                .all()
                .map((row) => ({
                    id: Number(row.id),
                    hymnId: Number(row.hymn_id),
                    tuneId: nullableInt(row.tune_id),
                    pcoSongId: nullableText(row.pco_song_id),
                    linkedAt: nullableText(row.linked_at),
                    linkedBy: nullableText(row.linked_by),
                    notes: nullableText(row.notes),
                })),
            entries: db
                .prepare(
                    "SELECT id, book_id, song_id, number, position, location_label, variant_note FROM entries ORDER BY id"
                )
                .all()
                .map((row) => ({
                    id: Number(row.id),
                    bookId: Number(row.book_id),
                    songId: Number(row.song_id),
                    number: nullableInt(row.number),
                    position: nullableInt(row.position),
                    locationLabel: nullableText(row.location_label),
                    variantNote: nullableText(row.variant_note),
                })),
            marks: db
                .prepare("SELECT song_id, mark, note, created_at FROM song_marks ORDER BY song_id, mark")
                .all()
                .map((row) => ({
                    songId: Number(row.song_id),
                    mark: String(row.mark),
                    note: nullableText(row.note),
                    createdAt: String(row.created_at),
                })),
        };
    });
}
