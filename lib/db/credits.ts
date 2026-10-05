import "server-only";
import type { DatabaseSync, SQLOutputValue } from "node:sqlite";
import { parseCredits, songCreditsOf } from "@/lib/credits";
import type { Credit, CreditParseStatus, PcoLibrarySong, SongCredits } from "@/lib/domain";
import { withTransaction } from "./transaction";

/**
 * The credits derived from each mirrored Planning Center song's author
 * (`pco_song_credits`): what lib/credits.ts reads the author as, stored so
 * that pages and filters need not read every author again. A song's rows
 * are replaced whole, on every sync and every credit save, and never edited
 * one by one. One row for each name of each role, in order; a song whose
 * author names nobody has a single row with neither role nor name, which
 * holds its parse status.
 */

/**
 * The parse statuses a row stores, as `pco_song_credits.parse_status`. They
 * are checked here rather than by a CHECK in the schema, so a new status
 * needs no migration, and readers skip a song whose status a newer build
 * wrote.
 */
export const CREDIT_PARSE_STATUSES = [
    "ok",
    "legacy",
    "unparsed",
] as const satisfies readonly CreditParseStatus[];

export function isCreditParseStatus(value: unknown): value is CreditParseStatus {
    return (CREDIT_PARSE_STATUSES as readonly unknown[]).includes(value);
}

type Row = Record<string, SQLOutputValue>;

/** True when `text` is empty or only whitespace. */
function isBlank(text: string): boolean {
    return text.trim() === "";
}

/**
 * Replace song `pcoSongId`'s derived credits with `songCredits`, in one
 * transaction: one row for each name of each role, numbered from 0 in
 * order, or, when they name nobody, one row with neither role nor name that
 * holds the status. Throws, writing nothing, on a status this build does not
 * know, on a role with no names, on a blank role or name, and when the
 * mirror lacks the song (its foreign key).
 */
export function replaceSongCredits(
    db: DatabaseSync,
    pcoSongId: string,
    { status, credits }: SongCredits
): void {
    if (!isCreditParseStatus(status)) {
        throw new Error(`Unknown credit parse status: ${JSON.stringify(String(status))}`);
    }
    const rows = credits.flatMap(({ role, names }) => {
        if (isBlank(role)) {
            throw new Error("A credit's role must not be blank");
        }
        if (names.length === 0) {
            throw new Error(`The credit for ${JSON.stringify(role)} names nobody`);
        }
        return names.map((name) => {
            if (isBlank(name)) {
                throw new Error(`A name credited for ${JSON.stringify(role)} is blank`);
            }
            return [role, name] as const;
        });
    });
    withTransaction(db, () => {
        db.prepare("DELETE FROM pco_song_credits WHERE pco_song_id = ?").run(pcoSongId);
        const insert = db.prepare(
            `INSERT INTO pco_song_credits (pco_song_id, role, name, position, parse_status)
             VALUES (?, ?, ?, ?, ?)`
        );
        if (rows.length === 0) {
            insert.run(pcoSongId, null, null, 0, status);
        }
        rows.forEach(([role, name], position) => {
            insert.run(pcoSongId, role, name, position, status);
        });
    });
}

/** How many songs' authors read as each parse status. */
export type CreditStatusCounts = Record<CreditParseStatus, number>;

/**
 * Read each song's author as credits with `roles` (the `creditRoles`
 * setting; see `parseCredits`) and store what it reads as, replacing what
 * the song had, all in one transaction. The songs must be in the mirror.
 * Returns how many read as each status.
 */
export function deriveSongCredits(
    db: DatabaseSync,
    songs: readonly Pick<PcoLibrarySong, "id" | "author">[],
    roles: readonly string[]
): CreditStatusCounts {
    return withTransaction(db, () => {
        const counts: CreditStatusCounts = { ok: 0, legacy: 0, unparsed: 0 };
        for (const { id, author } of songs) {
            const derived = songCreditsOf(parseCredits(author, roles));
            replaceSongCredits(db, id, derived);
            counts[derived.status] += 1;
        }
        return counts;
    });
}

/**
 * One song's rows, in position order, as its credits: each role once, where
 * its first name comes, with its names in order. Null when there are no rows
 * or their status is one this build does not know.
 */
function toSongCredits(rows: readonly Row[]): SongCredits | null {
    const status = rows[0]?.parse_status;
    if (!isCreditParseStatus(status)) {
        return null;
    }
    const credits: Credit[] = [];
    const byRole = new Map<string, Credit>();
    for (const row of rows) {
        if (row.role === null || row.name === null) {
            continue;
        }
        const role = String(row.role);
        let credit = byRole.get(role);
        if (!credit) {
            credit = { role, names: [] };
            byRole.set(role, credit);
            credits.push(credit);
        }
        credit.names.push(String(row.name));
    }
    return { status, credits };
}

/**
 * Song `pcoSongId`'s derived credits, or null when its author has not been
 * read yet (a song mirrored by a link made from a page, until the next sync)
 * or a newer build wrote them. One query.
 */
export function findSongCredits(db: DatabaseSync, pcoSongId: string): SongCredits | null {
    const rows = db
        .prepare(
            `SELECT role, name, parse_status FROM pco_song_credits
             WHERE pco_song_id = ? ORDER BY position`
        )
        .all(pcoSongId);
    return toSongCredits(rows);
}
