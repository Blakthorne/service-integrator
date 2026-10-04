import init from "./0001_init";
import catalog from "./0002_catalog";
import pcoSongs from "./0003_pco_songs";
import selections from "./0004_selections";
import creditsTags from "./0005_credits_tags";
import marks from "./0006_marks";

/** A schema change, applied once by `migrate()` and recorded in `schema_migrations`. */
export interface Migration {
    /**
     * `NNNN_name`: the next four-digit number, then a snake_case name, such as
     * `0002_catalog`. Migrations apply in this order and are recorded by id,
     * so an id is never renumbered, renamed or reused.
     */
    id: string;
    /**
     * One or more SQL statements. `migrate()` runs them in one transaction
     * with the row that records them, so they must not BEGIN or COMMIT, and
     * `PRAGMA foreign_keys` has no effect inside them.
     */
    sql: string;
}

/**
 * Every migration, in the order they apply. Append-only: a committed
 * migration is never edited, reordered or removed, because a deployed
 * database has already run it. Change the schema with a new one at the end.
 */
export const MIGRATIONS: readonly Migration[] = [
    init,
    catalog,
    pcoSongs,
    selections,
    creditsTags,
    marks,
];
