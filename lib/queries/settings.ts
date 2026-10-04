import "server-only";
import { getDb } from "@/lib/db";
import { errorMessage } from "@/lib/db/errors";
import { listStoredSettings, writeSettings } from "@/lib/db/settings";
import { recentWrites, type WriteLogEntry } from "@/lib/db/writeLog";
import {
    DEFAULT_SETTINGS,
    isSettingKey,
    parseSetting,
    resolveSettings,
    type AppSettings,
    type SettingIssue,
    type SettingKey,
} from "@/lib/settings";

export type { WriteLogEntry, WriteLogKind } from "@/lib/db/writeLog";

/**
 * The settings, for the pages and text that follow them and for the
 * Settings page that edits them. Reads never throw: without a database the
 * app runs on the defaults, which are its text as it was before settings,
 * and says why. Saving validates every value first and returns what it
 * refuses as a value, fit to show beside its field; a database that cannot
 * be written throws.
 */

/** The settings, and whether they could be read. */
export interface SettingsRead {
    /** Every setting: what is stored where it is valid, else the default. */
    settings: AppSettings;
    /** Why the stored settings could not be read (the defaults are in use), or null. */
    error: string | null;
}

/**
 * Every setting: its stored value where that is valid, else its default.
 * Never throws: when the database cannot be read it logs the error and
 * returns the defaults with the reason. One query.
 */
export function getSettings(): SettingsRead {
    try {
        return { settings: resolveSettings(listStoredSettings(getDb())).settings, error: null };
    } catch (error) {
        console.error("Settings unavailable, so the defaults are in use:", error);
        return { settings: { ...DEFAULT_SETTINGS }, error: errorMessage(error) };
    }
}

/**
 * The stored settings whose values no longer parse (their defaults are in
 * use), for the Settings page to point out. Never throws: when the database
 * cannot be read it logs the error and returns none (`getSettings` says
 * why). One query.
 */
export function getSettingsIssues(): SettingIssue[] {
    try {
        return resolveSettings(listStoredSettings(getDb())).issues;
    } catch (error) {
        console.error("Settings issues unavailable:", error);
        return [];
    }
}

/** What `saveSettings` did. */
export type SaveSettingsResult =
    /** Every value was valid and is saved; `saved` lists their keys. */
    | { ok: true; saved: SettingKey[] }
    /**
     * Nothing was saved. `fieldErrors` says what is wrong with each invalid
     * value, by key; `message` says it for the whole form.
     */
    | { ok: false; message: string; fieldErrors: Partial<Record<SettingKey, string>> };

/** What `saveSettings` says when some values are invalid. */
export const INVALID_SETTINGS_MESSAGE = "Nothing was saved: fix the settings marked below.";

/**
 * Save settings, each by its key, at `now`: all or none. Each value is
 * parsed first (`parseSetting`: a CCLI number is trimmed, a separator kept
 * as typed), and the parsed values are what is stored. A key that is not a
 * setting, or any invalid value, refuses the whole save with a message and
 * writes nothing. Throws when the database cannot be written.
 */
export function saveSettings(
    values: Readonly<Record<string, unknown>>,
    now: Date = new Date()
): SaveSettingsResult {
    const parsed: Partial<Record<SettingKey, unknown>> = {};
    const fieldErrors: Partial<Record<SettingKey, string>> = {};
    for (const [key, value] of Object.entries(values)) {
        if (!isSettingKey(key)) {
            return {
                ok: false,
                message: `There is no setting named ${JSON.stringify(key.slice(0, 40))}, so nothing was saved.`,
                fieldErrors: {},
            };
        }
        const result = parseSetting(key, value);
        if (result.ok) {
            parsed[key] = result.value;
        } else {
            fieldErrors[key] = result.message;
        }
    }
    if (Object.keys(fieldErrors).length > 0) {
        return { ok: false, message: INVALID_SETTINGS_MESSAGE, fieldErrors };
    }
    const saved = Object.keys(parsed) as SettingKey[];
    if (saved.length > 0) {
        writeSettings(getDb(), parsed, now);
    }
    return { ok: true, saved };
}

/** The latest writes to Planning Center, or that they cannot be read. */
export type RecentWrites =
    | { ok: true; writes: WriteLogEntry[] }
    | { ok: false; error: string };

/** How many writes the Settings page lists. */
export const RECENT_WRITES_LIMIT = 20;

/**
 * The `limit` latest writes to Planning Center, newest first, for the
 * Settings page. Never throws: when the database cannot be read it logs the
 * error and says why. One query.
 */
export function getRecentWrites(limit: number = RECENT_WRITES_LIMIT): RecentWrites {
    try {
        return { ok: true, writes: recentWrites(getDb(), limit) };
    } catch (error) {
        console.error("Recent writes unavailable:", error);
        return { ok: false, error: errorMessage(error) };
    }
}
