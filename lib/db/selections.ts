import "server-only";
import type { DatabaseSync, SQLOutputValue } from "node:sqlite";
import type { ScheduleOption } from "@/lib/scheduleSelections";

/**
 * The Schedule tab's saved choices (`schedule_selections`): one row per song
 * item of a plan that has had a choice made for it, keyed by the plan's and
 * the item's Planning Center ids. Callers check those ids with `parsePcoId`
 * first; the table's CHECKs refuse anything else.
 */

/**
 * The options a selection stores, as `schedule_selections.option`. They are
 * checked here rather than by a CHECK in the schema, so a new option needs no
 * migration, and readers skip one a newer build wrote.
 */
export const SCHEDULE_OPTIONS = [
    "numbers",
    "blank",
    "custom",
] as const satisfies readonly ScheduleOption[];

export function isScheduleOption(value: unknown): value is ScheduleOption {
    return (SCHEDULE_OPTIONS as readonly unknown[]).includes(value);
}

/** A row of `schedule_selections`. */
export interface StoredScheduleSelection {
    planId: string;
    itemId: string;
    option: ScheduleOption;
    /** What Custom prints; null for the other options. */
    customText: string | null;
    /** When it was last saved, ISO 8601 UTC. */
    updatedAt: string;
}

/** What `upsertScheduleSelection` saves. */
export type ScheduleSelectionRow = Omit<StoredScheduleSelection, "updatedAt">;

function nullableText(value: SQLOutputValue): string | null {
    return value === null ? null : String(value);
}

/**
 * Save the choice made for item `itemId` of plan `planId`, at `now`,
 * replacing the one saved before. Custom text is kept only with Custom: the
 * other options store null, as choosing them drops what was typed. Throws on
 * an option this build does not know (validate first) and on an id the
 * table's CHECK refuses.
 */
export function upsertScheduleSelection(
    db: DatabaseSync,
    { planId, itemId, option, customText }: ScheduleSelectionRow,
    now: Date = new Date()
): void {
    if (!isScheduleOption(option)) {
        throw new Error(`Unknown schedule option: ${JSON.stringify(String(option))}`);
    }
    db.prepare(
        `INSERT INTO schedule_selections (plan_id, item_id, option, custom_text, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (plan_id, item_id) DO UPDATE SET
             option = excluded.option,
             custom_text = excluded.custom_text,
             updated_at = excluded.updated_at`
    ).run(planId, itemId, option, option === "custom" ? customText : null, now.toISOString());
}

/**
 * The choices saved for plan `planId`, by item id. A row whose option this
 * build does not know (a newer build's) is skipped, never deleted. One query.
 */
export function listScheduleSelections(
    db: DatabaseSync,
    planId: string
): StoredScheduleSelection[] {
    return db
        .prepare(
            `SELECT plan_id, item_id, option, custom_text, updated_at
             FROM schedule_selections
             WHERE plan_id = ?
             ORDER BY item_id`
        )
        .all(planId)
        .flatMap((row) =>
            isScheduleOption(row.option)
                ? [
                      {
                          planId: String(row.plan_id),
                          itemId: String(row.item_id),
                          option: row.option,
                          customText: nullableText(row.custom_text),
                          updatedAt: String(row.updated_at),
                      },
                  ]
                : []
        );
}
