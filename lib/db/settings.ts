import "server-only";
import type { DatabaseSync } from "node:sqlite";
import type { StoredSetting } from "@/lib/settings";
import { withTransaction } from "./transaction";

/**
 * The stored settings (`settings`): one row per key that has been saved, its
 * value as JSON text. What the keys mean, and whether a value is valid, is
 * lib/settings.ts's business: this module only stores and reads rows, and
 * its callers validate before they save.
 */

/** A row of `settings`. */
export interface StoredSettingRow extends StoredSetting {
    /** When it was last saved, ISO 8601 UTC. */
    updatedAt: string;
}

/** Every stored setting, by key, the keys this build does not know included. One query. */
export function listStoredSettings(db: DatabaseSync): StoredSettingRow[] {
    return db
        .prepare("SELECT key, value, updated_at FROM settings ORDER BY key")
        .all()
        .map((row) => ({
            key: String(row.key),
            value: String(row.value),
            updatedAt: String(row.updated_at),
        }));
}

/**
 * Store each of `values` under its key, as JSON, at `now`, replacing what was
 * stored: all of them or none, in one transaction. Throws for a value JSON
 * cannot hold, such as undefined.
 */
export function writeSettings(
    db: DatabaseSync,
    values: Readonly<Record<string, unknown>>,
    now: Date = new Date()
): void {
    const rows = Object.entries(values).map(([key, value]) => {
        const json = JSON.stringify(value);
        if (json === undefined) {
            throw new TypeError(`Setting ${JSON.stringify(key)} must be JSON-serializable`);
        }
        return [key, json] as const;
    });
    withTransaction(db, () => {
        const upsert = db.prepare(
            `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
             ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
        );
        for (const [key, json] of rows) {
            upsert.run(key, json, now.toISOString());
        }
    });
}
