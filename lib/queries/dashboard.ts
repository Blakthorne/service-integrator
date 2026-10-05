import "server-only";
import { getDb } from "@/lib/db";
import { countCatalog } from "@/lib/db/catalog";
import { errorMessage } from "@/lib/db/errors";
import { bookCoverage, countSongsSung, type BookCoverage } from "@/lib/db/history";
import { latestSyncRun, type SyncRun } from "@/lib/db/syncRuns";
import type { Plan, PlanItemWithSong, ServiceType } from "@/lib/domain";
import {
    hymnNoteDiffFor,
    hymnNotesToSync,
    planHymnNoteStatus,
    type HymnNoteDiff,
    type HymnNoteStatus,
    type ItemNoteCategoriesRead,
} from "@/lib/hymnNotes";
import { addMonthsToYmd } from "@/lib/format";
import { getNextPlan, getPlanItems, getServiceTypes } from "@/lib/pco";
import { localYmd } from "@/lib/plansByDate";
import { scheduleSongView, type ScheduleCatalogState, type ScheduleSongView } from "@/lib/scheduleCards";
import { formatScheduleNumbers } from "@/lib/serviceSchedule";
import type { AppSettings } from "@/lib/settings";
import { readAppWrittenNoteIds, readItemNoteCategories } from "./hymnNotes";
import { planCatalogLinks } from "./plans";
import { getSettings } from "./settings";

/**
 * The dashboard (`/`): each service type's next plan, with its songs, their
 * numbers, links and hymnal notes, and what needs doing.
 *
 * Planning Center requests, kept low: one for the service types, then, for
 * each one that is not archived, in parallel, one for its next plan and,
 * when it has one, its items with their notes (one request per 100 items)
 * and its item note categories, in parallel: seven for the church's two
 * service types. The database: at most fourteen queries, however many plans:
 * seven for every plan's catalog links at once (`planCatalogLinks`), one for
 * which of all their notes the app wrote, one each for the settings, the
 * song sync's latest run and the catalog's size, and three for the history's
 * figures (the books' coverage, the songs sung this year and the history
 * sync's latest run).
 */

/** A song sync whose latest success is older than this is stale: it runs hourly. */
export const PCO_SONGS_SYNC_STALE_MS = 3 * 60 * 60 * 1000;

/** How many years back the coverage of a book counts a song as sung lately. */
export const COVERAGE_YEARS = 5;

/** What the dashboard shows of the plan history. */
export interface DashboardHistory {
    /** The date the figures are as of, `YYYY-MM-DD` (the server's): a plan before it is past, so its songs were sung. */
    today: string;
    /** The first day of the last `COVERAGE_YEARS` years, `YYYY-MM-DD`: where "sung lately" starts. */
    since: string;
    /**
     * Each active book, in book order: how many of its entries there are, how
     * many have a song that was sung in a past plan since `since`, and how
     * many have one that was ever sung.
     */
    coverage: BookCoverage[];
    /** How many different songs were sung in past plans this year, in the catalog or not. */
    songsSungThisYear: number;
    /** The history sync's latest run, finished or not; null before the first (so the figures are empty). */
    lastSync: SyncRun | null;
}

/** A song item of a next plan. */
export interface DashboardSong {
    itemId: string;
    /** The item's title in the plan. */
    title: string;
    sequence: number;
    /** The Planning Center song it schedules, or null. */
    pcoSongId: string | null;
    /**
     * Its link to the catalog, as the Schedule tab's cards see it
     * (`scheduleSongView`): linked, with its catalog song; unlinked, with
     * suggestions to link it to; set aside as not hymnal material; no
     * Planning Center song; or unknown, when the catalog cannot be read.
     */
    link: ScheduleSongView;
    /** Its numbers as the schedule text prints them ("R-396 / G-317"); "" when it has none. */
    numbers: string;
    /** Its hymnal note against the category; null when the notes cannot be compared. */
    note: HymnNoteDiff | null;
}

/** A service type that is not archived, and its next plan. */
export type DashboardServiceType =
    | {
          status: "plan";
          serviceType: ServiceType;
          plan: Plan;
          /** Its song items, in sequence order. */
          songs: DashboardSong[];
          /** Its hymnal notes against the category, or why they cannot be compared. */
          hymnNotes: HymnNoteStatus;
          /** How many song items' notes a sync would change. */
          notesToSync: number;
      }
    /** It has no future plan. */
    | { status: "no-plan"; serviceType: ServiceType }
    /** Its next plan or its items could not be read: a quiet warning, as the plans list gives. */
    | { status: "failed"; serviceType: ServiceType; error: string };

/** What a to-do names of a plan. */
export type DashboardPlanRef = Pick<Plan, "id" | "dates" | "shortDates">;

/** What a to-do names of a service type. */
export type DashboardServiceTypeRef = Pick<ServiceType, "id" | "name">;

/** Something the dashboard asks to be done. */
export type DashboardTodo =
    /** The catalog has no songs yet: import them. */
    | { kind: "empty-catalog" }
    /** The song sync's latest run failed. */
    | { kind: "sync-failed"; run: SyncRun }
    /**
     * The song sync has not succeeded for `PCO_SONGS_SYNC_STALE_MS`:
     * `run` is its latest run, a success, or null when it never ran.
     */
    | { kind: "sync-stale"; run: SyncRun | null }
    /** A service type with a next plan has no category for the hymnal notes. */
    | {
          kind: "missing-category";
          serviceType: DashboardServiceTypeRef;
          categoryName: string;
          message: string;
      }
    /** Songs of a next plan whose Planning Center songs are in no catalog song (and not set aside). */
    | {
          kind: "songs-not-in-catalog";
          serviceType: DashboardServiceTypeRef;
          plan: DashboardPlanRef;
          /** Each Planning Center song once, at its first item. */
          songs: { itemId: string; title: string; pcoSongId: string }[];
      }
    /** Hymnal notes of a next plan that a sync would change. */
    | {
          kind: "notes-out-of-date";
          serviceType: DashboardServiceTypeRef;
          plan: DashboardPlanRef;
          /** How many song items' notes. */
          count: number;
      };

/** What the dashboard shows. */
export interface Dashboard {
    /** Each service type that is not archived, in Planning Center's order. */
    serviceTypes: DashboardServiceType[];
    /** Why the service types could not be read from Planning Center (then there are none), or null. */
    serviceTypesError: string | null;
    /**
     * Why the database could not be read, or null. Links, numbers and notes
     * are then unknown, and the to-dos that need it are left out.
     */
    databaseError: string | null;
    /** The song sync's latest run, finished or not; null before the first, or when it cannot be read. */
    lastSync: SyncRun | null;
    /** What the plan history says of the books and the year; null when the database cannot be read. */
    history: DashboardHistory | null;
    /** What needs doing, the catalog's and the sync's first, then each plan's. */
    todos: DashboardTodo[];
}

/** A service type's next plan as read from Planning Center, or why it could not be. */
type NextPlanRead =
    | {
          ok: true;
          serviceType: ServiceType;
          plan: Plan | null;
          items: PlanItemWithSong[];
          categories: ItemNoteCategoriesRead;
      }
    | { ok: false; serviceType: ServiceType; error: string };

/** Read a service type's next plan, its items and its categories. Never rejects: a failure is logged. */
async function readNextPlan(serviceType: ServiceType): Promise<NextPlanRead> {
    try {
        const plan = await getNextPlan(serviceType.id);
        if (plan === null) {
            return {
                ok: true,
                serviceType,
                plan: null,
                items: [],
                categories: { ok: true, categories: [] },
            };
        }
        const [{ items }, categories] = await Promise.all([
            getPlanItems(serviceType.id, plan.id),
            readItemNoteCategories(serviceType.id),
        ]);
        return { ok: true, serviceType, plan, items, categories };
    } catch (error) {
        console.error(`Failed to load the next plan of service type ${serviceType.id}:`, error);
        return { ok: false, serviceType, error: errorMessage(error) };
    }
}

/** The catalog links of every plan's items at once, or none and why. Never throws. */
function readCatalogLinks(items: readonly PlanItemWithSong[]): ScheduleCatalogState {
    try {
        return { ...planCatalogLinks(items), catalogError: null };
    } catch (error) {
        console.error("Failed to read the catalog links of the next plans:", error);
        return { catalog: {}, suggestions: {}, catalogError: errorMessage(error) };
    }
}

/** The song sync's latest run and how many songs the catalog has, or why they cannot be read. Never throws. */
function readCatalogState():
    | { ok: true; lastSync: SyncRun | null; songs: number }
    | { ok: false; error: string } {
    try {
        const db = getDb();
        return { ok: true, lastSync: latestSyncRun(db, "pco-songs"), songs: countCatalog(db).songs };
    } catch (error) {
        console.error("Failed to read the song sync and the catalog's size:", error);
        return { ok: false, error: errorMessage(error) };
    }
}

/**
 * The plan history's figures at `now`: each active book's coverage, the songs
 * sung this year and the history sync's latest run. Three queries. Never
 * throws: a failure is logged and gives null.
 */
function readHistory(now: Date): DashboardHistory | null {
    try {
        const db = getDb();
        const today = localYmd(now);
        const since = addMonthsToYmd(today, -12 * COVERAGE_YEARS);
        return {
            today,
            since,
            coverage: bookCoverage(db, since, today),
            songsSungThisYear: countSongsSung(db, `${today.slice(0, 4)}-01-01`, today),
            lastSync: latestSyncRun(db, "history"),
        };
    } catch (error) {
        console.error("Failed to read the plan history for the dashboard:", error);
        return null;
    }
}

/** A next plan's song items, with their links, numbers and notes. */
function dashboardSongs(
    items: readonly PlanItemWithSong[],
    links: ScheduleCatalogState,
    hymnNotes: HymnNoteStatus,
    settings: AppSettings
): DashboardSong[] {
    return items
        .filter((item) => item.itemType === "song")
        .sort((a, b) => a.sequence - b.sequence)
        .map((item) => {
            const link = scheduleSongView(item, links);
            return {
                itemId: item.id,
                title: item.title,
                sequence: item.sequence,
                pcoSongId: item.songId,
                link,
                numbers:
                    link.kind === "linked"
                        ? formatScheduleNumbers(link.match.entries, settings.numberSeparator)
                        : "",
                note: hymnNoteDiffFor(hymnNotes, item.id),
            };
        });
}

/** The to-dos of one service type's next plan. */
function planTodos(entry: Extract<DashboardServiceType, { status: "plan" }>): DashboardTodo[] {
    const serviceType = { id: entry.serviceType.id, name: entry.serviceType.name };
    const plan = { id: entry.plan.id, dates: entry.plan.dates, shortDates: entry.plan.shortDates };
    const todos: DashboardTodo[] = [];
    if (entry.hymnNotes.kind === "no-category") {
        todos.push({
            kind: "missing-category",
            serviceType,
            categoryName: entry.hymnNotes.categoryName,
            message: entry.hymnNotes.message,
        });
    }
    const unlinked = new Map<string, { itemId: string; title: string; pcoSongId: string }>();
    for (const song of entry.songs) {
        if (song.link.kind === "unlinked" && !unlinked.has(song.link.pcoSongId)) {
            unlinked.set(song.link.pcoSongId, {
                itemId: song.itemId,
                title: song.title,
                pcoSongId: song.link.pcoSongId,
            });
        }
    }
    if (unlinked.size > 0) {
        todos.push({ kind: "songs-not-in-catalog", serviceType, plan, songs: [...unlinked.values()] });
    }
    if (entry.notesToSync > 0) {
        todos.push({ kind: "notes-out-of-date", serviceType, plan, count: entry.notesToSync });
    }
    return todos;
}

/** The to-dos of the catalog and the song sync, at `now`. */
function catalogTodos(state: { lastSync: SyncRun | null; songs: number }, now: Date): DashboardTodo[] {
    const todos: DashboardTodo[] = [];
    if (state.songs === 0) {
        todos.push({ kind: "empty-catalog" });
    }
    const run = state.lastSync;
    if (run?.ok === false) {
        todos.push({ kind: "sync-failed", run });
    } else if (
        run === null ||
        (run.ok === true &&
            now.getTime() - Date.parse(run.finishedAt ?? run.startedAt) > PCO_SONGS_SYNC_STALE_MS)
    ) {
        todos.push({ kind: "sync-stale", run });
    }
    return todos;
}

/**
 * Everything the dashboard shows, at `now` (see `Dashboard`). Never throws:
 * a service type whose next plan cannot be read is a quiet warning, as on
 * the plans list; service types that cannot be read, or a database that
 * cannot be, leave the rest of the page, with the reason.
 */
export async function getDashboard(now: Date = new Date()): Promise<Dashboard> {
    let serviceTypes: ServiceType[] = [];
    let serviceTypesError: string | null = null;
    try {
        serviceTypes = (await getServiceTypes()).filter((serviceType) => !serviceType.archived);
    } catch (error) {
        console.error("Failed to read the service types for the dashboard:", error);
        serviceTypesError = errorMessage(error);
    }
    const reads = await Promise.all(serviceTypes.map(readNextPlan));

    const items = reads.flatMap((read) => (read.ok ? read.items : []));
    const links = readCatalogLinks(items);
    const ownedNoteIds = readAppWrittenNoteIds(items);
    const { settings, error: settingsError } = getSettings();
    const state = readCatalogState();

    const entries: DashboardServiceType[] = reads.map((read) => {
        if (!read.ok) {
            return { status: "failed", serviceType: read.serviceType, error: read.error };
        }
        if (read.plan === null) {
            return { status: "no-plan", serviceType: read.serviceType };
        }
        const hymnNotes = planHymnNoteStatus({
            serviceTypeName: read.serviceType.name,
            items: read.items,
            catalog: links.catalog,
            catalogError: links.catalogError,
            categories: read.categories,
            settings,
            settingsError,
            ownedNoteIds,
        });
        return {
            status: "plan",
            serviceType: read.serviceType,
            plan: read.plan,
            songs: dashboardSongs(read.items, links, hymnNotes, settings),
            hymnNotes,
            notesToSync: hymnNotes.kind === "ready" ? hymnNotesToSync(hymnNotes.items).length : 0,
        };
    });

    return {
        serviceTypes: entries,
        serviceTypesError,
        databaseError: links.catalogError ?? settingsError ?? (state.ok ? null : state.error),
        lastSync: state.ok ? state.lastSync : null,
        history: readHistory(now),
        todos: [
            ...(state.ok ? catalogTodos(state, now) : []),
            ...entries.flatMap((entry) => (entry.status === "plan" ? planTodos(entry) : [])),
        ],
    };
}
