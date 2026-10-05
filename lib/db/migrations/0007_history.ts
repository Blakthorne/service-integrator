import type { Migration } from ".";

/**
 * The history of what the church sang: a mirror of the song items of every
 * Planning Center plan, refreshed by the `history` sync
 * (lib/queries/history.ts), which the reports, the song page, the songs
 * list's last-sung date, the dashboard's coverage and the plan page's repeat
 * warnings read.
 *
 * - `history_plans`: each plan Planning Center lists, with its service type,
 *   its calendar date (`plan_date`, `YYYY-MM-DD`: the date part of
 *   `sort_date`, which is the church's local date) and Planning Center's
 *   `updated_at` as the latest listing gave it. `items_synced_at` is when
 *   the plan's items were last read: null until they are, and again as soon
 *   as a listing shows the plan changed since (a new `updated_at`, a moved
 *   date or service type), so a plan with a null `items_synced_at` is one
 *   whose items must be read, and a read that failed is retried by the next
 *   sync. Rows of plans Planning Center no longer lists are deleted.
 * - `plan_occurrences`: a song item of a plan, with the plan's date and
 *   service type copied from it, so a song's history is one indexed read.
 *   `pco_song_id` is the Planning Center song the item schedules. It has no
 *   foreign key: the song mirror (`pco_songs`) may not have a song that was
 *   added to a plan since its last sync, and a catalog song reaches its
 *   occurrences through `songs.pco_song_id`, which has none either. A plan's
 *   rows are a mirror: they are all replaced whenever its items are read
 *   again, and they go when their plan does.
 *
 * Ids are Planning Center's: a CHECK holds each to what `parsePcoId`
 * accepts, a positive decimal integer of at most 20 digits with no leading
 * zero, as for `schedule_selections`. Timestamps are ISO 8601 UTC text,
 * which sorts by time; dates are `YYYY-MM-DD`, which sorts by day.
 */
const migration: Migration = {
    id: "0007_history",
    sql: `
        CREATE TABLE history_plans (
            plan_id TEXT PRIMARY KEY CHECK (
                length(plan_id) BETWEEN 1 AND 20
                AND plan_id GLOB '[1-9]*'
                AND plan_id NOT GLOB '*[^0-9]*'
            ),
            service_type_id TEXT NOT NULL CHECK (
                length(service_type_id) BETWEEN 1 AND 20
                AND service_type_id GLOB '[1-9]*'
                AND service_type_id NOT GLOB '*[^0-9]*'
            ),
            plan_date TEXT NOT NULL CHECK (
                plan_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
            ),
            updated_at TEXT NOT NULL,
            items_synced_at TEXT
        ) STRICT;

        CREATE TABLE plan_occurrences (
            plan_id TEXT NOT NULL REFERENCES history_plans (plan_id) ON DELETE CASCADE,
            item_id TEXT NOT NULL CHECK (
                length(item_id) BETWEEN 1 AND 20
                AND item_id GLOB '[1-9]*'
                AND item_id NOT GLOB '*[^0-9]*'
            ),
            pco_song_id TEXT NOT NULL CHECK (
                length(pco_song_id) BETWEEN 1 AND 20
                AND pco_song_id GLOB '[1-9]*'
                AND pco_song_id NOT GLOB '*[^0-9]*'
            ),
            sequence INTEGER NOT NULL,
            plan_date TEXT NOT NULL CHECK (
                plan_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
            ),
            service_type_id TEXT NOT NULL CHECK (
                length(service_type_id) BETWEEN 1 AND 20
                AND service_type_id GLOB '[1-9]*'
                AND service_type_id NOT GLOB '*[^0-9]*'
            ),
            synced_at TEXT NOT NULL,
            PRIMARY KEY (plan_id, item_id)
        ) STRICT;

        CREATE INDEX plan_occurrences_pco_song_id ON plan_occurrences (pco_song_id);
        CREATE INDEX plan_occurrences_plan_date ON plan_occurrences (plan_date);
    `,
};

export default migration;
