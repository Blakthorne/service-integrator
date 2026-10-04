import type { Migration } from ".";

/**
 * The Schedule tab's saved choices, and the log of writes to Planning Center.
 *
 * - `schedule_selections`: the choice made for one song item of one plan on
 *   the Schedule tab, so it survives leaving the plan. `plan_id` and
 *   `item_id` are Planning Center ids (a plan's id is unique across service
 *   types), held by a CHECK to what `parsePcoId` accepts: a positive decimal
 *   integer of at most 20 digits, with no leading zero. `option` ('numbers',
 *   'blank' or 'custom') is checked in TypeScript, like every enumeration
 *   (`SCHEDULE_OPTIONS` in lib/db/selections.ts), and readers skip a value a
 *   newer build wrote. `custom_text` is what Custom prints; it is null for
 *   the other options.
 * - `write_log`: one row per write the app sends to Planning Center, made or
 *   refused. `kind` ('item-note', 'song', 'item', 'tags' or 'email') is
 *   checked in TypeScript (`WRITE_LOG_KINDS` in lib/db/writeLog.ts). `target`
 *   names what was written, such as `plan 123 item 456`; `payload` is what
 *   was asked for and `result` what came of it (what changed, or Planning
 *   Center's error), both JSON.
 *
 * Timestamps are ISO 8601 UTC text, which sorts by time.
 */
const migration: Migration = {
    id: "0004_selections",
    sql: `
        CREATE TABLE schedule_selections (
            plan_id TEXT NOT NULL CHECK (
                length(plan_id) BETWEEN 1 AND 20
                AND plan_id GLOB '[1-9]*'
                AND plan_id NOT GLOB '*[^0-9]*'
            ),
            item_id TEXT NOT NULL CHECK (
                length(item_id) BETWEEN 1 AND 20
                AND item_id GLOB '[1-9]*'
                AND item_id NOT GLOB '*[^0-9]*'
            ),
            option TEXT NOT NULL,
            custom_text TEXT,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (plan_id, item_id)
        ) STRICT;

        CREATE TABLE write_log (
            id INTEGER PRIMARY KEY,
            at TEXT NOT NULL,
            kind TEXT NOT NULL,
            target TEXT NOT NULL,
            ok INTEGER NOT NULL CHECK (ok IN (0, 1)),
            payload TEXT NOT NULL CHECK (json_valid(payload)),
            result TEXT NOT NULL CHECK (json_valid(result))
        ) STRICT;
    `,
};

export default migration;
