import type { HistoryOccurrence } from "./db/history";
import type { CatalogSongSummary } from "./domain";
import { addMonthsToYmd, planDateFromSortDate } from "./format";

/**
 * The reports of what the church sang, built from the plan history's song
 * items (`HistoryOccurrence`) and the catalog's songs. Pure and safe on both
 * sides; `lib/queries/reports.ts` reads the history and serves them.
 *
 * **"Sung" counts past plans only**: a plan dated before `today`, the
 * church's calendar date, which every function takes as an argument. A plan
 * dated today or later is upcoming, and a song in one is "scheduled", not
 * sung (a plan dated today is upcoming all day, as Planning Center's own
 * "future" filter has it). A song's "times" are the plans it was sung in:
 * twice in one plan is once.
 */

/** Dates are `YYYY-MM-DD` strings, which compare as text by day. */

/** What the reports need of a catalog song. */
export type ReportSong = Pick<CatalogSongSummary, "id" | "title" | "tuneName" | "pcoSongId" | "entries">;

/** The periods "most sung" is counted over. */
export const MOST_SUNG_PERIODS = ["last-12-months", "this-year", "all-time"] as const;

export type MostSungPeriod = (typeof MOST_SUNG_PERIODS)[number];

/** What each period is called. */
export const MOST_SUNG_PERIOD_LABELS: Readonly<Record<MostSungPeriod, string>> = {
    "last-12-months": "Last 12 months",
    "this-year": "This year",
    "all-time": "All time",
};

/**
 * The first day of `period` as of `today`: the same day a year before for
 * the last 12 months ("2026-10-04" gives "2025-10-04"), January 1 for this
 * year, and null for all time (no first day). The period runs from there up
 * to, not including, `today`.
 */
export function periodStart(period: MostSungPeriod, today: string): string | null {
    switch (period) {
        case "last-12-months":
            return addMonthsToYmd(today, -12);
        case "this-year":
            return `${today.slice(0, 4)}-01-01`;
        case "all-time":
            return null;
    }
}

/** Whether a plan dated `planDate` is a past plan as of `today`. */
export function isPastPlan(planDate: string, today: string): boolean {
    return planDate < today;
}

/** A song's use in the plans of the history. */
export interface SongUse {
    /** How many past plans it was sung in. */
    times: number;
    /** The date of the last past plan it was sung in; null when it never was. */
    lastSungOn: string | null;
    /** The date of the first upcoming plan it is scheduled in; null when it is in none. */
    nextScheduledOn: string | null;
}

/**
 * Each Planning Center song's use as of `today`, by its id: every song with
 * an occurrence in the history, including one only scheduled in upcoming
 * plans (no times, never sung).
 */
export function summarizeUse(
    occurrences: readonly HistoryOccurrence[],
    today: string
): Map<string, SongUse> {
    const plansBySong = new Map<string, Set<string>>();
    const uses = new Map<string, SongUse>();
    for (const { pcoSongId, planId, planDate } of occurrences) {
        let use = uses.get(pcoSongId);
        if (!use) {
            use = { times: 0, lastSungOn: null, nextScheduledOn: null };
            uses.set(pcoSongId, use);
        }
        if (isPastPlan(planDate, today)) {
            let plans = plansBySong.get(pcoSongId);
            if (!plans) {
                plans = new Set();
                plansBySong.set(pcoSongId, plans);
            }
            plans.add(planId);
            use.times = plans.size;
            if (use.lastSungOn === null || planDate > use.lastSungOn) {
                use.lastSungOn = planDate;
            }
        } else if (use.nextScheduledOn === null || planDate < use.nextScheduledOn) {
            use.nextScheduledOn = planDate;
        }
    }
    return uses;
}

/** Compare by a key; equal keys give 0. */
function compareBy<T>(a: T, b: T): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

/** Title order without regard to case, then as written. */
function compareTitles(a: string, b: string): number {
    return compareBy(a.toLowerCase(), b.toLowerCase()) || compareBy(a, b);
}

/** Planning Center ids, which are whole numbers without a leading zero, in numeric order. */
function compareIds(a: string, b: string): number {
    return a.length - b.length || compareBy(a, b);
}

/** Songs by title, then tune name (an unknown tune first), then id. */
function compareSongs(a: ReportSong, b: ReportSong): number {
    return (
        compareTitles(a.title, b.title) ||
        compareTitles(a.tuneName ?? "", b.tuneName ?? "") ||
        a.id - b.id
    );
}

/** A row of the "most sung" report. */
export interface MostSungRow {
    /** The Planning Center song. */
    pcoSongId: string;
    /** The catalog song it is linked to, with its numbers (`entries`); null when it is in no catalog song. */
    song: ReportSong | null;
    /**
     * What to call it: the catalog song's title, or else Planning Center's
     * (`pcoTitles`), or else "Song <id>" when the mirror does not have it.
     */
    title: string;
    /** In how many past plans of the period it was sung. */
    times: number;
    /** The date of the last of them. */
    lastSungOn: string;
}

/**
 * The songs sung in the past plans of `period` as of `today`, most sung
 * first: by times, then by the latest date, then by title. Every song sung
 * is listed, in the catalog or not (`song` is null for one that is not), so a
 * report can show or leave out the ones the catalog does not know.
 * `pcoTitles` are the Planning Center songs' titles by id (the mirror's).
 */
export function buildMostSung(
    occurrences: readonly HistoryOccurrence[],
    today: string,
    period: MostSungPeriod,
    songs: readonly ReportSong[],
    pcoTitles: ReadonlyMap<string, string>
): MostSungRow[] {
    const from = periodStart(period, today);
    const inPeriod = occurrences.filter(
        ({ planDate }) => isPastPlan(planDate, today) && (from === null || planDate >= from)
    );
    const catalog = new Map(
        songs.flatMap((song) => (song.pcoSongId === null ? [] : [[song.pcoSongId, song] as const]))
    );
    const rows: MostSungRow[] = [];
    for (const [pcoSongId, use] of summarizeUse(inPeriod, today)) {
        if (use.lastSungOn === null) {
            continue;
        }
        const song = catalog.get(pcoSongId) ?? null;
        rows.push({
            pcoSongId,
            song,
            title: song?.title ?? pcoTitles.get(pcoSongId) ?? `Song ${pcoSongId}`,
            times: use.times,
            lastSungOn: use.lastSungOn,
        });
    }
    return rows.sort(
        (a, b) =>
            b.times - a.times ||
            compareBy(b.lastSungOn, a.lastSungOn) ||
            compareTitles(a.title, b.title) ||
            compareIds(a.pcoSongId, b.pcoSongId)
    );
}

/** A row of the "last sung" report: a catalog song linked to a Planning Center song, and its use. */
export interface LastSungRow extends SongUse {
    song: ReportSong;
}

/**
 * Every catalog song linked to a Planning Center song, with when it was
 * last sung, how many times (all time) and when it is next scheduled, by
 * title, then tune. A song never sung in a past plan has no `lastSungOn`
 * (it may be scheduled). A song that is not linked has no history and is
 * left out.
 */
export function buildLastSung(
    occurrences: readonly HistoryOccurrence[],
    today: string,
    songs: readonly ReportSong[]
): LastSungRow[] {
    const uses = summarizeUse(occurrences, today);
    const never: SongUse = { times: 0, lastSungOn: null, nextScheduledOn: null };
    return songs
        .flatMap((song) =>
            song.pcoSongId === null ? [] : [{ song, ...(uses.get(song.pcoSongId) ?? never) }]
        )
        .sort((a, b) => compareSongs(a.song, b.song));
}

/**
 * The linked songs not sung since `since` (`YYYY-MM-DD`): those whose last
 * past plan is before it, and those never sung in a past plan, longest
 * unsung first (never sung first, then the oldest last date), then by
 * title. A song sung on `since` itself counts as sung since.
 */
export function notSungSince(lastSung: readonly LastSungRow[], since: string): LastSungRow[] {
    return lastSung
        .filter(({ lastSungOn }) => lastSungOn === null || lastSungOn < since)
        .sort(
            (a, b) =>
                // A date is later than no date, so never sung sorts first.
                compareBy(a.lastSungOn ?? "", b.lastSungOn ?? "") || compareSongs(a.song, b.song)
        );
}

/** How far back the "not sung since" report looks by default, in months. */
export const DEFAULT_NOT_SUNG_MONTHS = 12;

/** The date "not sung since" starts from when none is asked for: a year before `today`. */
export function defaultNotSince(today: string): string {
    return addMonthsToYmd(today, -DEFAULT_NOT_SUNG_MONTHS);
}

/**
 * A date from a query string (`?notSince=`): exactly `YYYY-MM-DD` and a real
 * calendar date, or null for a missing, malformed or impossible one.
 */
export function parseReportDate(raw: string | null | undefined): string | null {
    return typeof raw === "string" && planDateFromSortDate(raw) === raw ? raw : null;
}

/** One time a song is in a plan, for the song page's history. */
export interface SongHistoryEntry {
    planId: string;
    itemId: string;
    serviceTypeId: string;
    /** The plan's date. */
    planDate: string;
    /** The plan is dated today or later: the song is scheduled, not yet sung. */
    upcoming: boolean;
}

/** A song's history: every plan it is in, newest first, with its use. */
export interface SongHistory extends SongUse {
    entries: SongHistoryEntry[];
}

/**
 * One Planning Center song's history as of `today`: each of its occurrences
 * in the occurrences given (the song's own, as `listSongOccurrences` reads
 * them), the latest date first, the upcoming ones marked, with how many past
 * plans it was sung in, the last of them and the next it is scheduled in.
 */
export function buildSongHistory(
    occurrences: readonly HistoryOccurrence[],
    today: string
): SongHistory {
    const entries = occurrences
        .map(
            ({ planId, itemId, serviceTypeId, planDate }): SongHistoryEntry => ({
                planId,
                itemId,
                serviceTypeId,
                planDate,
                upcoming: !isPastPlan(planDate, today),
            })
        )
        .sort(
            (a, b) =>
                compareBy(b.planDate, a.planDate) ||
                compareIds(b.planId, a.planId) ||
                compareIds(a.itemId, b.itemId)
        );
    const [use] = [...summarizeUse(occurrences, today).values()];
    return { entries, ...(use ?? { times: 0, lastSungOn: null, nextScheduledOn: null }) };
}
