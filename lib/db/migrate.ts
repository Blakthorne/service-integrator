import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { errorMessage } from "./errors";
import { MIGRATIONS, type Migration } from "./migrations";
import { withTransaction } from "./transaction";

/** A row of `schema_migrations`. */
export interface AppliedMigration {
    id: string;
    /** When it was applied, as ISO 8601 UTC. */
    appliedAt: string;
}

/** What `migrate()` did. */
export interface MigrateResult {
    /** The ids it applied, in order. Empty when the schema was up to date. */
    applied: string[];
    /** Ids the database records that `migrations` lacks: a newer build applied them. */
    unknown: string[];
}

/** The migrations the database records, in id order. */
export function appliedMigrations(db: DatabaseSync): AppliedMigration[] {
    return db
        .prepare("SELECT id, applied_at FROM schema_migrations ORDER BY id")
        .all()
        .map((row) => ({ id: String(row.id), appliedAt: String(row.applied_at) }));
}

/** Apply one migration with its schema_migrations row. False if another connection got there first. */
function applyMigration(
    db: DatabaseSync,
    migration: Migration,
    now: () => Date
): boolean {
    try {
        return withTransaction(db, () => {
            const done = db
                .prepare("SELECT 1 FROM schema_migrations WHERE id = ?")
                .get(migration.id);
            if (done) {
                return false;
            }
            db.exec(migration.sql);
            db.prepare(
                "INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)"
            ).run(migration.id, now().toISOString());
            return true;
        });
    } catch (error) {
        throw new Error(
            `Database migration ${migration.id} failed: ${errorMessage(error)}`,
            { cause: error }
        );
    }
}

/**
 * Bring the schema up to date. Creates `schema_migrations` if needed, then
 * applies each migration it does not record, in list order, each in its own
 * transaction together with its `schema_migrations` row, so a failure leaves
 * the database as the previous migration left it. Throws on a failure, naming
 * the migration. Safe to call again: it applies only what is missing.
 *
 * A database that records migrations this build does not know (an older
 * build deployed onto a database a newer one migrated) gets a warning in the
 * log, not an error: the newer tables are left alone and the app carries on.
 *
 * `now` stamps `applied_at`; tests inject a clock.
 */
export function migrate(
    db: DatabaseSync,
    migrations: readonly Migration[] = MIGRATIONS,
    now: () => Date = () => new Date()
): MigrateResult {
    db.exec(
        "CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL) STRICT"
    );
    const recorded = new Set(appliedMigrations(db).map(({ id }) => id));
    const known = new Set(migrations.map(({ id }) => id));
    const unknown = [...recorded].filter((id) => !known.has(id));
    if (unknown.length > 0) {
        console.warn(
            `The database records migrations this build does not know (${unknown.join(", ")}). A newer build probably applied them; carrying on.`
        );
    }

    const applied: string[] = [];
    for (const migration of migrations) {
        if (!recorded.has(migration.id) && applyMigration(db, migration, now)) {
            applied.push(migration.id);
        }
    }
    return { applied, unknown };
}
