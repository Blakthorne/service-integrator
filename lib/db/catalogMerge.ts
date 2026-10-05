import "server-only";
import type { DatabaseSync, SQLOutputValue } from "node:sqlite";
import { formatEntryLabel } from "@/lib/catalog/labels";
import {
    joinNotes,
    planHymnMerge,
    planTuneMerge,
    type MergeEntry,
    type MergeHymn,
    type MergeKind,
    type MergePreview,
    type MergeSong,
    type MergeTune,
} from "@/lib/catalog/merge";
import { normalizeTuneName } from "@/lib/catalog/normalize";
import { normalizeTitle } from "@/lib/normalizeTitle";
import { SONG_MARKS_JSON, songMarksFromJson } from "./marks";
import { withTransaction } from "./transaction";

/**
 * Merging hymns and tunes (see lib/catalog/merge.ts for what a merge does
 * and refuses): read the two and their songs, plan, and either show the
 * plan (`previewHymnMerge`, `previewTuneMerge`) or plan again and write it,
 * all in one transaction (`applyHymnMerge`, `applyTuneMerge`), so what is
 * written is planned from the catalog as it is then, not as the preview
 * saw it. A refused merge writes nothing.
 */

/** A merge's plan, or why it cannot be planned: the hymn (or tune) to merge, or to merge into, is not there. */
export type MergePlanResult =
    | { ok: true; preview: MergePreview }
    | { ok: false; reason: "source-not-found" | "target-not-found"; message: string };

/**
 * What applying a merge did: what changed (the plan it carried out); or why
 * it was refused, with the plan whose refusals say why (nothing was
 * written); or that a hymn (or tune) is not there.
 */
export type MergeApplyResult =
    | { ok: true; preview: MergePreview }
    | { ok: false; reason: "refused"; preview: MergePreview }
    | { ok: false; reason: "source-not-found" | "target-not-found"; message: string };

function nullableText(value: SQLOutputValue): string | null {
    return value === null ? null : String(value);
}

/** How a merge of each kind reads and writes its rows. */
interface Tables {
    kind: MergeKind;
    table: "hymns" | "tunes";
    /** The songs' column that points at the row. */
    songColumn: "hymn_id" | "tune_id";
    aliasTable: "hymn_aliases" | "tune_aliases";
    ownerColumn: "hymn_id" | "tune_id";
    /** A hymn's first line, a tune's meter. */
    detailColumn: "first_line" | "meter";
    normalize: (name: string) => string;
}

const HYMNS: Tables = {
    kind: "hymn",
    table: "hymns",
    songColumn: "hymn_id",
    aliasTable: "hymn_aliases",
    ownerColumn: "hymn_id",
    detailColumn: "first_line",
    normalize: normalizeTitle,
};

const TUNES: Tables = {
    kind: "tune",
    table: "tunes",
    songColumn: "tune_id",
    aliasTable: "tune_aliases",
    ownerColumn: "tune_id",
    detailColumn: "meter",
    normalize: normalizeTuneName,
};

/**
 * The songs of a hymn or tune as a merge sees them: each with its hymn's
 * title, its tune's name, its link (and the linked song's title, from the
 * mirror), its notes, its entries in book order with their books' names
 * and labels, and its marks. Two queries.
 */
function mergeSongs(db: DatabaseSync, tables: Tables, ownerId: number): MergeSong[] {
    const songs = db
        .prepare(
            `SELECT s.id, s.hymn_id, h.title, s.tune_id, t.name AS tune_name, s.pco_song_id,
                    p.title AS pco_title, s.notes, ${SONG_MARKS_JSON} AS marks
             FROM songs s
             JOIN hymns h ON h.id = s.hymn_id
             LEFT JOIN tunes t ON t.id = s.tune_id
             LEFT JOIN pco_songs p ON p.id = s.pco_song_id
             WHERE s.${tables.songColumn} = ?
             ORDER BY s.id`
        )
        .all(ownerId);
    const entries = new Map<number, MergeEntry[]>();
    for (const row of db
        .prepare(
            `SELECT e.id, e.song_id, e.book_id, e.number, e.location_label, e.variant_note,
                    b.name AS book_name, b.numbered, b.label_format
             FROM entries e
             JOIN books b ON b.id = e.book_id
             JOIN songs s ON s.id = e.song_id
             WHERE s.${tables.songColumn} = ?
             ORDER BY b.sort_order, b.code, b.id, e.number IS NULL, e.number, e.position, e.id`
        )
        .all(ownerId)) {
        const songId = Number(row.song_id);
        const list = entries.get(songId) ?? [];
        entries.set(songId, list);
        list.push({
            id: Number(row.id),
            bookId: Number(row.book_id),
            bookName: String(row.book_name),
            label: formatEntryLabel(
                { numbered: row.numbered === 1, labelFormat: String(row.label_format) },
                {
                    number: row.number === null ? null : Number(row.number),
                    locationLabel: nullableText(row.location_label),
                }
            ),
            variantNote: nullableText(row.variant_note),
        });
    }
    return songs.map((row) => ({
        id: Number(row.id),
        hymnId: Number(row.hymn_id),
        title: String(row.title),
        tuneId: row.tune_id === null ? null : Number(row.tune_id),
        tuneName: nullableText(row.tune_name),
        pcoSongId: nullableText(row.pco_song_id),
        pcoTitle: nullableText(row.pco_title),
        notes: nullableText(row.notes),
        entries: entries.get(Number(row.id)) ?? [],
        marks: songMarksFromJson(row.marks),
    }));
}

/** A row's other names, as written, in the order they were added. */
function aliasesOf(db: DatabaseSync, tables: Tables, ownerId: number): string[] {
    return db
        .prepare(`SELECT alias FROM ${tables.aliasTable} WHERE ${tables.ownerColumn} = ? ORDER BY id`)
        .all(ownerId)
        .map((row) => String(row.alias));
}

/** Hymn `hymnId` as a merge sees it, or null when there is no such hymn. */
export function readMergeHymn(db: DatabaseSync, hymnId: number): MergeHymn | null {
    const row = db.prepare("SELECT id, title, first_line, notes FROM hymns WHERE id = ?").get(hymnId);
    return row
        ? {
              id: hymnId,
              title: String(row.title),
              firstLine: nullableText(row.first_line),
              notes: nullableText(row.notes),
              aliases: aliasesOf(db, HYMNS, hymnId),
              songs: mergeSongs(db, HYMNS, hymnId),
          }
        : null;
}

/** Tune `tuneId` as a merge sees it, or null when there is no such tune. */
export function readMergeTune(db: DatabaseSync, tuneId: number): MergeTune | null {
    const row = db.prepare("SELECT id, name, meter, notes FROM tunes WHERE id = ?").get(tuneId);
    return row
        ? {
              id: tuneId,
              name: String(row.name),
              meter: nullableText(row.meter),
              notes: nullableText(row.notes),
              aliases: aliasesOf(db, TUNES, tuneId),
              songs: mergeSongs(db, TUNES, tuneId),
          }
        : null;
}

/** Plan a merge from the two rows as they are now, or say which is missing. */
function planMerge<Row>(
    tables: Tables,
    read: (id: number) => Row | null,
    plan: (source: Row, target: Row) => MergePreview,
    sourceId: number,
    targetId: number
): MergePlanResult {
    const source = read(sourceId);
    if (!source) {
        return {
            ok: false,
            reason: "source-not-found",
            message: `That ${tables.kind} is not in the catalog. It may have been merged already.`,
        };
    }
    const target = read(targetId);
    if (!target) {
        return {
            ok: false,
            reason: "target-not-found",
            message: `The ${tables.kind} to merge into is not in the catalog. Choose another.`,
        };
    }
    return { ok: true, preview: plan(source, target) };
}

/**
 * Merge source song `sourceId` into target song `targetId`: its entries
 * move, its marks too (a mark the target has stays the target's, taking the
 * source's note when it has none, and marks this build does not know move
 * as well), its notes are added to the target's, its link moves when the
 * target has none, and it is deleted. The plan has checked that no entry
 * collides and that the two are not linked apart.
 */
function mergeSong(db: DatabaseSync, sourceId: number, targetId: number): void {
    db.prepare("UPDATE entries SET song_id = ? WHERE song_id = ?").run(targetId, sourceId);

    const targetMarks = new Map(
        db
            .prepare("SELECT mark, note FROM song_marks WHERE song_id = ?")
            .all(targetId)
            .map((row) => [String(row.mark), nullableText(row.note)])
    );
    for (const row of db.prepare("SELECT mark, note FROM song_marks WHERE song_id = ?").all(sourceId)) {
        const mark = String(row.mark);
        if (!targetMarks.has(mark)) {
            db.prepare("UPDATE song_marks SET song_id = ? WHERE song_id = ? AND mark = ?").run(
                targetId,
                sourceId,
                mark
            );
        } else if (targetMarks.get(mark) === null && row.note !== null) {
            db.prepare("UPDATE song_marks SET note = ? WHERE song_id = ? AND mark = ?").run(
                row.note,
                targetId,
                mark
            );
        }
    }

    const source = db
        .prepare("SELECT notes, pco_song_id, linked_at, linked_by FROM songs WHERE id = ?")
        .get(sourceId)!;
    const target = db.prepare("SELECT notes, pco_song_id FROM songs WHERE id = ?").get(targetId)!;
    db.prepare("UPDATE songs SET notes = ? WHERE id = ?").run(
        joinNotes(nullableText(target.notes), nullableText(source.notes)),
        targetId
    );
    if (source.pco_song_id !== null && target.pco_song_id === null) {
        // The link moves as it is, with when and how it was made: the song
        // that has it is merged into the one that takes its place, so this
        // is no new link (lib/db/links.ts makes those), and the Planning
        // Center song keeps its numbers on every plan page. pco_song_id is
        // unique, so the source lets go of it first.
        db.prepare(
            "UPDATE songs SET pco_song_id = NULL, linked_at = NULL, linked_by = NULL WHERE id = ?"
        ).run(sourceId);
        db.prepare("UPDATE songs SET pco_song_id = ?, linked_at = ?, linked_by = ? WHERE id = ?").run(
            source.pco_song_id,
            source.linked_at,
            source.linked_by,
            targetId
        );
    }
    db.prepare("DELETE FROM songs WHERE id = ?").run(sourceId);
}

/** Write a merge that has no refusals: every song merge, every move, the names and fields, then delete the source. */
function writeMerge(db: DatabaseSync, tables: Tables, preview: MergePreview): void {
    const { source, target } = preview;
    for (const step of preview.merges) {
        mergeSong(db, step.sourceSongId, step.targetSongId);
    }
    const move = db.prepare(`UPDATE songs SET ${tables.songColumn} = ? WHERE id = ?`);
    for (const { songId } of preview.moves) {
        move.run(target.id, songId);
    }

    // The source's other names go with it, and the target takes the names
    // the plan gives it (the source's name and other names, but its own).
    db.prepare(`DELETE FROM ${tables.aliasTable} WHERE ${tables.ownerColumn} = ?`).run(source.id);
    const addAlias = db.prepare(
        `INSERT INTO ${tables.aliasTable} (${tables.ownerColumn}, alias, normalized) VALUES (?, ?, ?)`
    );
    for (const alias of preview.aliasesAdded) {
        addAlias.run(target.id, alias, tables.normalize(alias));
    }

    const sourceRow = db
        .prepare(`SELECT ${tables.detailColumn} AS detail, notes FROM ${tables.table} WHERE id = ?`)
        .get(source.id)!;
    const targetRow = db
        .prepare(`SELECT ${tables.detailColumn} AS detail, notes FROM ${tables.table} WHERE id = ?`)
        .get(target.id)!;
    db.prepare(`UPDATE ${tables.table} SET ${tables.detailColumn} = ?, notes = ? WHERE id = ?`).run(
        targetRow.detail ?? sourceRow.detail,
        joinNotes(nullableText(targetRow.notes), nullableText(sourceRow.notes)),
        target.id
    );
    db.prepare(`DELETE FROM ${tables.table} WHERE id = ?`).run(source.id);
}

/** Plan a merge afresh and, unless it is refused, write it, in one transaction. */
function applyMerge(
    db: DatabaseSync,
    tables: Tables,
    planNow: () => MergePlanResult
): MergeApplyResult {
    return withTransaction(db, (): MergeApplyResult => {
        const planned = planNow();
        if (!planned.ok) {
            return planned;
        }
        if (planned.preview.refusals.length > 0) {
            return { ok: false, reason: "refused", preview: planned.preview };
        }
        writeMerge(db, tables, planned.preview);
        return planned;
    });
}

/**
 * What merging hymn `sourceId` into hymn `targetId` would do (see
 * `planHymnMerge`), from the catalog as it is now; nothing is written.
 */
export function previewHymnMerge(db: DatabaseSync, sourceId: number, targetId: number): MergePlanResult {
    return planMerge(HYMNS, (id) => readMergeHymn(db, id), planHymnMerge, sourceId, targetId);
}

/**
 * Merge hymn `sourceId` into hymn `targetId`, planned afresh and written in
 * one transaction: its songs move or merge, its title and other titles
 * become the target's other titles, the target takes its first line when it
 * has none and its notes after its own, and it is deleted. A refused merge
 * writes nothing and comes back with the plan that says why.
 */
export function applyHymnMerge(db: DatabaseSync, sourceId: number, targetId: number): MergeApplyResult {
    return applyMerge(db, HYMNS, () => previewHymnMerge(db, sourceId, targetId));
}

/** What merging tune `sourceId` into tune `targetId` would do (`planTuneMerge`); nothing is written. */
export function previewTuneMerge(db: DatabaseSync, sourceId: number, targetId: number): MergePlanResult {
    return planMerge(TUNES, (id) => readMergeTune(db, id), planTuneMerge, sourceId, targetId);
}

/**
 * Merge tune `sourceId` into tune `targetId`, as `applyHymnMerge` merges
 * hymns: songs keyed by hymn, other names by `normalizeTuneName`, and the
 * meter in place of the first line.
 */
export function applyTuneMerge(db: DatabaseSync, sourceId: number, targetId: number): MergeApplyResult {
    return applyMerge(db, TUNES, () => previewTuneMerge(db, sourceId, targetId));
}
