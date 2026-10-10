import "server-only";
import { getDb } from "@/lib/db";
import { listCatalogSongs } from "@/lib/db/catalog";
import { errorMessage } from "@/lib/db/errors";
import {
    countHistory,
    listOccurrences,
    listSongOccurrences,
    type HistoryCounts,
} from "@/lib/db/history";
import { listPcoSongs } from "@/lib/db/pcoSongs";
import { latestSyncRun, type SyncRun } from "@/lib/db/syncRuns";
import { historyJob, runJob, type RunJobResult } from "@/lib/jobs";
import { getServiceTypes } from "@/lib/pco";
import { localYmd } from "@/lib/plansByDate";
import {
    MOST_SUNG_PERIODS,
    buildLastSung,
    buildMostSung,
    buildNeverSung,
    buildSongHistory,
    defaultNotSince,
    notSungSince,
    type LastSungRow,
    type MostSungPeriod,
    type MostSungRow,
    type NeverSungRow,
    type SongHistory,
} from "@/lib/reports";
import { createTtlCache } from "@/lib/ttlCache";

/**
 * The reports of what the church sang, for the Reports page, a song's
 * history, and "Sync history now". They are built from the plan history
 * (`syncPlanHistory`, lib/queries/history.ts) by lib/reports.ts, with "sung"
 * meaning a plan dated before today, the server's calendar date at `now`.
 * The reads are synchronous, like the database, and throw when it cannot be
 * read, as the catalog's do.
 */

export type { RunJobResult } from "@/lib/jobs";

/**
 * "Sync history now": run the plan history sync through `runJob`, so that a
 * run already in progress (the daily one) is joined rather than doubled,
 * and give that run as recorded, with `ok` false and the reason when the
 * sync failed; or `run: null` and why, when no run could be recorded at all
 * (the database could not be opened or written). Never an older run, and
 * never throws.
 */
export function syncPlanHistoryNow(): Promise<RunJobResult> {
    return runJob(historyJob);
}

/** Everything the Reports page shows. */
export interface Reports {
    /** The date the reports are as of, `YYYY-MM-DD`: a plan before it is past, so its songs were sung. */
    today: string;
    /** What the history holds: its plans, its song items and the dates they span; all zero before the first sync. */
    history: HistoryCounts;
    /** The latest history sync run, finished or not; null before the first. */
    lastRun: SyncRun | null;
    /**
     * The songs sung in each period, most sung first, in the catalog or not
     * (`MostSungRow.song` is null for one that is not). Every song, not a
     * top few: the page shows as many as it likes.
     */
    mostSung: Record<MostSungPeriod, MostSungRow[]>;
    /** Every catalog song linked to a Planning Center song, by title, with when it was last sung. */
    lastSung: LastSungRow[];
    /** The date `notSungSince` is as of: the one asked for, or a year before `today`. */
    notSince: string;
    /** The linked songs not sung since `notSince`, never sung first, then the longest unsung. */
    notSungSince: LastSungRow[];
    /** Every song in Planning Center or in a book of the catalog that was never in a past plan, by title. */
    neverSung: NeverSungRow[];
}

/** What a page may ask the reports for. */
export interface ReportsOptions {
    /**
     * The date for "not sung since", `YYYY-MM-DD` (a query string's
     * `?notSince=` after `parseReportDate`); a year before today when left
     * out or null.
     */
    notSince?: string | null;
}

/**
 * Every report at `now`: most sung in each period, last sung, not sung
 * since and never sung. Reads the whole history (a few thousand rows), the
 * catalog's songs and the mirror's songs, in a few queries however many
 * songs there are.
 */
export function getReports({ notSince = null }: ReportsOptions = {}, now: Date = new Date()): Reports {
    const db = getDb();
    const today = localYmd(now);
    const occurrences = listOccurrences(db);
    const songs = listCatalogSongs(db, today);
    const pcoSongs = listPcoSongs(db);
    const titles = new Map(pcoSongs.map(({ id, title }) => [id, title]));
    const lastSung = buildLastSung(occurrences, today, songs);
    const since = notSince ?? defaultNotSince(today);
    return {
        today,
        history: countHistory(db),
        lastRun: latestSyncRun(db, "history"),
        mostSung: Object.fromEntries(
            MOST_SUNG_PERIODS.map((period) => [
                period,
                buildMostSung(occurrences, today, period, songs, titles),
            ])
        ) as Record<MostSungPeriod, MostSungRow[]>,
        lastSung,
        notSince: since,
        notSungSince: notSungSince(lastSung, since),
        neverSung: buildNeverSung(occurrences, today, songs, pcoSongs),
    };
}

/**
 * A song's history at `now`, for its page: every plan its Planning Center
 * song is in, newest first, upcoming ones marked, with how many past plans
 * it was sung in, the last of them and the next it is scheduled in. Pass
 * the song's `pcoSongId` (an id the database gave, so already checked):
 * a song that is not linked has no history, and gets an empty one. One
 * query.
 */
export function getSongHistory(pcoSongId: string | null, now: Date = new Date()): SongHistory {
    const today = localYmd(now);
    return buildSongHistory(
        pcoSongId === null ? [] : listSongOccurrences(getDb(), pcoSongId),
        today
    );
}

const SERVICE_TYPE_NAMES_TTL_MS = 5 * 60 * 1000;

const serviceTypeNamesCache = createTtlCache<string, Record<string, string>>({
    ttlMs: SERVICE_TYPE_NAMES_TTL_MS,
});

/**
 * Each service type's name by its Planning Center id, for the pages that
 * list plans from the history ("Sunday Morning"), which keeps only the
 * ids. One Planning Center request, cached for 5 minutes. Never throws: a
 * failure is logged and gives none, and the page falls back to the id. A
 * page that reads only the local database should not wait on this: stream
 * it under its own Suspense boundary, with a deadline (`withDeadline`).
 */
export async function getServiceTypeNames(): Promise<Record<string, string>> {
    try {
        return await serviceTypeNamesCache.get("all", async () =>
            Object.fromEntries((await getServiceTypes()).map(({ id, name }) => [id, name]))
        );
    } catch (error) {
        console.error("Failed to read the service type names:", errorMessage(error));
        return {};
    }
}
