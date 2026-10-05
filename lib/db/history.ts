import "server-only";
import type { DatabaseSync, SQLOutputValue } from "node:sqlite";
import { withTransaction } from "./transaction";

/**
 * The history of what was scheduled in Planning Center plans, as the
 * `history` sync mirrors it (lib/queries/history.ts): the plans
 * (`history_plans`) and the song items in them (`plan_occurrences`). The
 * sync's writes are here, with the reads the reports and pages make.
 *
 * A plan's `items_synced_at` is null until its items are read, and again as
 * soon as a listing shows the plan changed since (`upsertListedPlans`), so
 * a plan with none is one whose items must be read. Its occurrences are a
 * mirror, all replaced together (`replacePlanOccurrences`), and they go when
 * their plan does.
 */

type Row = Record<string, SQLOutputValue>;

function nullableText(value: SQLOutputValue): string | null {
    return value === null ? null : String(value);
}

/** A plan of the history. */
export interface HistoryPlan {
    /** Planning Center's id; unique across service types. */
    planId: string;
    serviceTypeId: string;
    /** The plan's calendar date, `YYYY-MM-DD`. */
    planDate: string;
    /** Planning Center's `updated_at` as the latest listing gave it. */
    updatedAt: string;
    /** When its items were last read, ISO 8601 UTC; null when they must be (see above). */
    itemsSyncedAt: string | null;
}

/** A plan as a listing of Planning Center's plans gives it. */
export type ListedPlan = Omit<HistoryPlan, "itemsSyncedAt">;

function toHistoryPlan(row: Row): HistoryPlan {
    return {
        planId: String(row.plan_id),
        serviceTypeId: String(row.service_type_id),
        planDate: String(row.plan_date),
        updatedAt: String(row.updated_at),
        itemsSyncedAt: nullableText(row.items_synced_at),
    };
}

/** Every plan of the history, the latest date first, then by id. */
export function listHistoryPlans(db: DatabaseSync): HistoryPlan[] {
    return db
        .prepare(
            `SELECT plan_id, service_type_id, plan_date, updated_at, items_synced_at
             FROM history_plans
             ORDER BY plan_date DESC, plan_id DESC`
        )
        .all()
        .map(toHistoryPlan);
}

/** What `upsertListedPlans` did, as plan ids. */
export interface PlanListingUpsert {
    /** Plans the history did not have. */
    added: string[];
    /** Plans it had that the listing shows changed: a new `updated_at`, date or service type. */
    changed: string[];
}

/**
 * Store a complete listing of Planning Center's plans: add the plans the
 * history lacks, and give a plan the listing shows changed (a different
 * `updated_at`, date or service type) its new values and no `items_synced_at`,
 * so that its items are read again. A plan that is as it was is left alone,
 * its `items_synced_at` included. One transaction.
 */
export function upsertListedPlans(
    db: DatabaseSync,
    plans: readonly ListedPlan[]
): PlanListingUpsert {
    return withTransaction(db, () => {
        const find = db.prepare(
            "SELECT service_type_id, plan_date, updated_at FROM history_plans WHERE plan_id = ?"
        );
        const insert = db.prepare(
            "INSERT INTO history_plans (plan_id, service_type_id, plan_date, updated_at) VALUES (?, ?, ?, ?)"
        );
        const update = db.prepare(
            `UPDATE history_plans
             SET service_type_id = ?, plan_date = ?, updated_at = ?, items_synced_at = NULL
             WHERE plan_id = ?`
        );
        const added: string[] = [];
        const changed: string[] = [];
        for (const { planId, serviceTypeId, planDate, updatedAt } of plans) {
            const stored = find.get(planId);
            if (!stored) {
                insert.run(planId, serviceTypeId, planDate, updatedAt);
                added.push(planId);
            } else if (
                stored.service_type_id !== serviceTypeId ||
                stored.plan_date !== planDate ||
                stored.updated_at !== updatedAt
            ) {
                update.run(serviceTypeId, planDate, updatedAt, planId);
                changed.push(planId);
            }
        }
        return { added, changed };
    });
}

/**
 * Delete every plan not in `listedIds`, the ids of a *complete* listing:
 * Planning Center no longer has them. Their occurrences go with them. Only
 * call it with a whole listing, never with part of one. Returns the ids
 * deleted.
 */
export function deleteUnlistedPlans(db: DatabaseSync, listedIds: readonly string[]): string[] {
    return db
        .prepare(
            `DELETE FROM history_plans
             WHERE plan_id NOT IN (SELECT value FROM json_each(?))
             RETURNING plan_id`
        )
        .all(JSON.stringify([...new Set(listedIds)]))
        .map((row) => String(row.plan_id));
}

/** Delete plan `planId` and its occurrences, because Planning Center has no such plan. Returns whether it was there. */
export function deleteHistoryPlan(db: DatabaseSync, planId: string): boolean {
    const { changes } = db.prepare("DELETE FROM history_plans WHERE plan_id = ?").run(planId);
    return Number(changes) > 0;
}

/** A song item of a plan, as the history keeps it. */
export interface NewOccurrence {
    itemId: string;
    /** The Planning Center song the item schedules. */
    pcoSongId: string;
    /** The item's place in the plan. */
    sequence: number;
}

/**
 * Replace plan `planId`'s occurrences with `occurrences`, read from
 * Planning Center at `at`, and record that its items were read then
 * (`items_synced_at`). Each takes the plan's date and service type. An item
 * given twice is stored once, the first. One transaction, so a plan never
 * holds part of a reading. Returns how many occurrences it now has. Throws
 * when the plan is not in the history, storing nothing.
 */
export function replacePlanOccurrences(
    db: DatabaseSync,
    planId: string,
    occurrences: readonly NewOccurrence[],
    at: Date = new Date()
): number {
    return withTransaction(db, () => {
        const plan = db
            .prepare("SELECT plan_date, service_type_id FROM history_plans WHERE plan_id = ?")
            .get(planId);
        if (!plan) {
            throw new Error(`Plan ${planId} is not in the history`);
        }
        const syncedAt = at.toISOString();
        db.prepare("DELETE FROM plan_occurrences WHERE plan_id = ?").run(planId);
        const insert = db.prepare(
            `INSERT INTO plan_occurrences
                 (plan_id, item_id, pco_song_id, sequence, plan_date, service_type_id, synced_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
        );
        const items = new Map<string, NewOccurrence>();
        for (const occurrence of occurrences) {
            if (!items.has(occurrence.itemId)) {
                items.set(occurrence.itemId, occurrence);
            }
        }
        for (const { itemId, pcoSongId, sequence } of items.values()) {
            insert.run(
                planId,
                itemId,
                pcoSongId,
                sequence,
                String(plan.plan_date),
                String(plan.service_type_id),
                syncedAt
            );
        }
        db.prepare("UPDATE history_plans SET items_synced_at = ? WHERE plan_id = ?").run(
            syncedAt,
            planId
        );
        return items.size;
    });
}

/** A song item of a plan, as the reports read it. */
export interface HistoryOccurrence {
    planId: string;
    itemId: string;
    /** The Planning Center song the item schedules. */
    pcoSongId: string;
    /** The item's place in the plan. */
    sequence: number;
    /** The plan's date, `YYYY-MM-DD`. */
    planDate: string;
    serviceTypeId: string;
}

const OCCURRENCE_COLUMNS = "plan_id, item_id, pco_song_id, sequence, plan_date, service_type_id";

/** The latest plan first; within a plan, in the order of its items. */
const OCCURRENCE_ORDER = "plan_date DESC, plan_id DESC, sequence, item_id";

function toOccurrence(row: Row): HistoryOccurrence {
    return {
        planId: String(row.plan_id),
        itemId: String(row.item_id),
        pcoSongId: String(row.pco_song_id),
        sequence: Number(row.sequence),
        planDate: String(row.plan_date),
        serviceTypeId: String(row.service_type_id),
    };
}

/**
 * Every song item of every plan, the latest plan first, upcoming plans
 * included (the reports tell them apart by date). One query; about as many
 * rows as the church has sung songs, a few thousand.
 */
export function listOccurrences(db: DatabaseSync): HistoryOccurrence[] {
    return db
        .prepare(`SELECT ${OCCURRENCE_COLUMNS} FROM plan_occurrences ORDER BY ${OCCURRENCE_ORDER}`)
        .all()
        .map(toOccurrence);
}

/** Every plan Planning Center song `pcoSongId` is in, the latest plan first, upcoming plans included. */
export function listSongOccurrences(db: DatabaseSync, pcoSongId: string): HistoryOccurrence[] {
    return db
        .prepare(
            `SELECT ${OCCURRENCE_COLUMNS} FROM plan_occurrences
             WHERE pco_song_id = ?
             ORDER BY ${OCCURRENCE_ORDER}`
        )
        .all(pcoSongId)
        .map(toOccurrence);
}

/** How many of an active book's entries have a song that was sung. */
export interface BookCoverage {
    bookId: number;
    code: string;
    name: string;
    shortName: string;
    /** How many entries the book has, a song's variants counted each. */
    entries: number;
    /** Of them, those whose song was sung in a past plan within the period asked for. */
    sungRecently: number;
    /** Of them, those whose song was ever sung in a past plan. */
    sungEver: number;
}

/**
 * The coverage of every active book, in book order: how many of its entries
 * have a catalog song linked to a Planning Center song that was sung in a
 * past plan, dated from `since` (inclusive) to before `today` (`sungRecently`),
 * and in any plan before `today` (`sungEver`). Entries whose song is not
 * linked, or was never sung, count in `entries` only. A book with no
 * entries has none of any. One query.
 */
export function bookCoverage(db: DatabaseSync, since: string, today: string): BookCoverage[] {
    return db
        .prepare(
            `SELECT b.id, b.code, b.name, b.short_name, count(e.id) AS entries,
                    coalesce(sum(EXISTS (
                        SELECT 1 FROM plan_occurrences o
                        WHERE o.pco_song_id = s.pco_song_id AND o.plan_date >= ?1 AND o.plan_date < ?2
                    )), 0) AS recently,
                    coalesce(sum(EXISTS (
                        SELECT 1 FROM plan_occurrences o
                        WHERE o.pco_song_id = s.pco_song_id AND o.plan_date < ?2
                    )), 0) AS ever
             FROM books b
             LEFT JOIN entries e ON e.book_id = b.id
             LEFT JOIN songs s ON s.id = e.song_id
             WHERE b.active = 1
             GROUP BY b.id
             ORDER BY b.sort_order, b.code, b.id`
        )
        .all(since, today)
        .map((row) => ({
            bookId: Number(row.id),
            code: String(row.code),
            name: String(row.name),
            shortName: String(row.short_name),
            entries: Number(row.entries),
            sungRecently: Number(row.recently),
            sungEver: Number(row.ever),
        }));
}

/**
 * How many different Planning Center songs were sung in past plans dated
 * from `from` (inclusive) to before `today`, `YYYY-MM-DD`: in the catalog or
 * not. One query.
 */
export function countSongsSung(db: DatabaseSync, from: string, today: string): number {
    const row = db
        .prepare(
            `SELECT count(DISTINCT pco_song_id) AS n FROM plan_occurrences
             WHERE plan_date >= ? AND plan_date < ?`
        )
        .get(from, today);
    return Number(row?.n);
}

/** How much the history holds. */
export interface HistoryCounts {
    /** Plans listed. */
    plans: number;
    /** Of them, plans whose items have been read and not changed since. */
    plansRead: number;
    /** Song items in all the plans. */
    occurrences: number;
    /** The earliest and the latest date of a plan; null with none. */
    firstPlanDate: string | null;
    lastPlanDate: string | null;
}

/** How many plans and song items the history holds, and the dates it spans. Two queries. */
export function countHistory(db: DatabaseSync): HistoryCounts {
    const plans = db
        .prepare(
            `SELECT count(*) AS plans, count(items_synced_at) AS plans_read,
                    min(plan_date) AS first_date, max(plan_date) AS last_date
             FROM history_plans`
        )
        .get();
    const occurrences = db.prepare("SELECT count(*) AS n FROM plan_occurrences").get();
    return {
        plans: Number(plans?.plans),
        plansRead: Number(plans?.plans_read),
        occurrences: Number(occurrences?.n),
        firstPlanDate: nullableText(plans?.first_date ?? null),
        lastPlanDate: nullableText(plans?.last_date ?? null),
    };
}
