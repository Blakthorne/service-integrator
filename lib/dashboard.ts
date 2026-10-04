import { hymnNoteBadgeLabel } from "./hymnNoteText";
import {
    hymnNoteState,
    type HymnNoteDiff,
    type HymnNoteState,
    type HymnNoteStatus,
} from "./hymnNotes";
import { planLabel } from "./planLabel";
import type {
    Dashboard,
    DashboardServiceType,
    DashboardSong,
    DashboardTodo,
} from "./queries/dashboard";
import { routes } from "./routes";
import type { ScheduleSongView } from "./scheduleCards";

/**
 * What the dashboard (`/`) says and where it links: each next plan's song
 * rows and hymnal notes, the to-dos and the warnings. Pure and safe on both
 * sides: lib/queries/dashboard.ts reads the data (`getDashboard`), the
 * components in app/components/Dashboard render these decisions.
 */

/**
 * Where a dashboard link goes. Each is a route builder's literal type, so
 * `<Link href>` checks it against the routes that exist.
 */
export type DashboardHref =
    | ReturnType<typeof routes.plan>
    | ReturnType<typeof routes.planSchedule>
    | ReturnType<typeof routes.settings>
    | ReturnType<typeof routes.catalogImport>;

/** A link that fixes something, with what it does. */
export interface DashboardLink {
    label: string;
    href: DashboardHref;
}

/**
 * What a song row shows where its numbers go:
 *
 * - "numbers": its numbers as the schedule text prints them ("R-396 / G-317");
 * - "fix": it is not in the catalog, and the text links to the plan's
 *   Schedule tab, where it can be linked;
 * - "note": why it has no numbers (in no book, set aside as not hymnal
 *   material, no Planning Center song, or a catalog that cannot be read).
 */
export type SongNumbersView =
    | { kind: "numbers"; text: string }
    | { kind: "fix"; text: string }
    | { kind: "note"; text: string };

/** What a song row shows where its numbers go (see `SongNumbersView`). */
export function songNumbersView(song: {
    link: Pick<ScheduleSongView, "kind">;
    numbers: DashboardSong["numbers"];
}): SongNumbersView {
    switch (song.link.kind) {
        case "linked":
            return song.numbers === ""
                ? { kind: "note", text: "Not in a book" }
                : { kind: "numbers", text: song.numbers };
        case "unlinked":
            return { kind: "fix", text: "Not in the catalog" };
        case "ignored":
            return { kind: "note", text: "Not hymnal material" };
        case "no-song":
            return { kind: "note", text: "No Planning Center song" };
        case "unknown":
            return { kind: "note", text: "Numbers unavailable" };
    }
}

/**
 * What a song row's badge says of each hymnal note state: the words the
 * Schedule tab's cards and the sync dialog use too (`HYMN_NOTE_STATE_WORDS`
 * in lib/hymnNoteText.ts), so "Note needs sync" covers a note to remove.
 */
export const HYMN_NOTE_BADGE_LABELS: Readonly<Record<HymnNoteState, string>> = {
    "in-sync": hymnNoteBadgeLabel("in-sync"),
    differs: hymnNoteBadgeLabel("differs"),
    missing: hymnNoteBadgeLabel("missing"),
};

/** A song row's hymnal-note badge. */
export interface HymnNoteBadge {
    state: HymnNoteState;
    label: string;
}

/** What a song row's badge reads: its hymnal note's diff, or null when the notes cannot be compared. */
interface SongNote {
    note: Pick<HymnNoteDiff, "action"> | null;
}

/**
 * A song row's hymnal-note badge (see `hymnNoteState`), or null for none:
 * the notes cannot be compared (no category, or what they need cannot be
 * read), or the song has nothing to say and no note of the app's.
 */
export function hymnNoteBadge(song: SongNote): HymnNoteBadge | null {
    const state = song.note === null ? null : hymnNoteState(song.note);
    return state === null ? null : { state, label: HYMN_NOTE_BADGE_LABELS[state] };
}

/** "1 hymnal note needs syncing.", "3 hymnal notes need syncing." */
function notesNeedSyncing(count: number): string {
    return count === 1
        ? "1 hymnal note needs syncing."
        : `${count} hymnal notes need syncing.`;
}

/**
 * What a plan card says of its hymnal notes, under its songs:
 *
 * - "ok": the songs' notes are in sync;
 * - "attention": some need a sync, which the plan page makes;
 * - "warning": the service type has no category for them, so nothing can
 *   be written until someone creates it in Planning Center (the to-do says
 *   how, beside a link);
 * - "muted": they cannot be compared, and why.
 */
export interface PlanNotesSummary {
    tone: "ok" | "attention" | "warning" | "muted";
    text: string;
}

/**
 * What a plan card says of its hymnal notes (see `PlanNotesSummary`), or
 * null when there is nothing to say: no song item has numbers or a note of
 * the app's.
 */
export function planNotesSummary(entry: {
    hymnNotes: HymnNoteStatus;
    notesToSync: number;
    songs: readonly SongNote[];
}): PlanNotesSummary | null {
    const { hymnNotes } = entry;
    switch (hymnNotes.kind) {
        case "no-category":
            return {
                tone: "warning",
                text: `Hymnal notes can't be synced without a "${hymnNotes.categoryName}" item note category.`,
            };
        case "unavailable":
            return unavailableNotesSummary(hymnNotes);
        case "ready":
            if (entry.notesToSync > 0) {
                return { tone: "attention", text: notesNeedSyncing(entry.notesToSync) };
            }
            return entry.songs.some((song) => hymnNoteBadge(song) !== null)
                ? { tone: "ok", text: "Hymnal notes in sync." }
                : null;
    }
}

/** Why a plan's hymnal notes cannot be compared, briefly: the status's message is for the sync dialog. */
function unavailableNotesSummary(
    status: Extract<HymnNoteStatus, { kind: "unavailable" }>
): PlanNotesSummary {
    switch (status.reason) {
        case "ambiguous-category":
            return {
                tone: "warning",
                text: `Hymnal notes can't be synced: ${status.categories.length} item note categories are named "${status.categoryName}".`,
            };
        case "settings":
            return {
                tone: "muted",
                text: "Hymnal notes can't be compared while the settings can't be read.",
            };
        case "catalog":
            return {
                tone: "muted",
                text: "Hymnal notes can't be compared while the catalog is unavailable.",
            };
        case "categories":
            return {
                tone: "muted",
                text: "Hymnal notes can't be compared: Planning Center's item note categories couldn't be read.",
            };
    }
}

/** A to-do as the dashboard lists it. */
export interface TodoView {
    /** Unique among the to-dos, for React. */
    key: string;
    /** The plan it is about ("October 4, 2026 · Sunday Morning"); null when its text says. */
    context: string | null;
    /** What needs doing. */
    text: string;
    /** A time to show with it, in the viewer's time zone, and what it is ("Last run"). */
    time: { label: string; iso: string } | null;
    /** Where it is fixed. */
    action: DashboardLink;
}

/** A reason as the end of a sentence: ": reason." (no second full stop), or "." when there is none. */
function reasonSentence(reason: string | null): string {
    const text = reason?.trim() ?? "";
    if (text === "") {
        return ".";
    }
    return /[.!?]$/.test(text) ? `: ${text}` : `: ${text}.`;
}

/** How many titles a to-do names before it counts the rest. */
export const TODO_TITLES_SHOWN = 3;

/**
 * `"A"`, `"A" and "B"`, `"A", "B" and "C"`; past `TODO_TITLES_SHOWN`, the
 * first few and a count: `"A", "B", "C" and 4 more`.
 */
function quotedList(titles: readonly string[]): string {
    const quoted = titles.map((title) => `"${title}"`);
    if (quoted.length > TODO_TITLES_SHOWN) {
        const rest = quoted.length - TODO_TITLES_SHOWN;
        return `${quoted.slice(0, TODO_TITLES_SHOWN).join(", ")} and ${rest} more`;
    }
    return quoted.length <= 1
        ? quoted.join("")
        : `${quoted.slice(0, -1).join(", ")} and ${quoted[quoted.length - 1]}`;
}

/** Where the song sync is run by hand. */
const SYNC_NOW: DashboardLink = { label: "Sync now on Settings", href: routes.settings() };

/** The to-do as the dashboard lists it: what needs doing, and the link that fixes it. */
export function todoView(todo: DashboardTodo): TodoView {
    switch (todo.kind) {
        case "empty-catalog":
            return {
                key: "empty-catalog",
                context: null,
                text: "The catalog has no songs yet, so no song has numbers.",
                time: null,
                action: { label: "Import the hymnals", href: routes.catalogImport() },
            };
        case "sync-failed":
            return {
                key: "sync-failed",
                context: null,
                text: `The Planning Center song sync failed${reasonSentence(todo.run.message)}`,
                time: { label: "Last run", iso: todo.run.finishedAt ?? todo.run.startedAt },
                action: SYNC_NOW,
            };
        case "sync-stale":
            return todo.run === null
                ? {
                      key: "sync-stale",
                      context: null,
                      text: "The Planning Center song sync has never run.",
                      time: null,
                      action: SYNC_NOW,
                  }
                : {
                      key: "sync-stale",
                      context: null,
                      text: "The Planning Center song sync is overdue: it runs every hour.",
                      time: {
                          label: "Last success",
                          iso: todo.run.finishedAt ?? todo.run.startedAt,
                      },
                      action: SYNC_NOW,
                  };
        case "missing-category":
            return {
                key: `missing-category-${todo.serviceType.id}`,
                context: null,
                text: todo.message,
                time: null,
                action: { label: "Hymnal note settings", href: routes.settings() },
            };
        case "songs-not-in-catalog": {
            const titles = todo.songs.map((song) => song.title);
            return {
                key: `songs-not-in-catalog-${todo.plan.id}`,
                context: planLabel(todo.plan, todo.serviceType),
                text:
                    titles.length === 1
                        ? `${quotedList(titles)} isn't in the catalog.`
                        : `${titles.length} songs aren't in the catalog: ${quotedList(titles)}.`,
                time: null,
                action: {
                    label:
                        titles.length === 1
                            ? "Link it on the Schedule tab"
                            : "Link them on the Schedule tab",
                    href: routes.planSchedule(todo.serviceType.id, todo.plan.id),
                },
            };
        }
        case "notes-out-of-date":
            return {
                key: `notes-out-of-date-${todo.plan.id}`,
                context: planLabel(todo.plan, todo.serviceType),
                text: notesNeedSyncing(todo.count),
                time: null,
                action: {
                    label: todo.count === 1 ? "Open the plan to sync it" : "Open the plan to sync them",
                    href: routes.plan(todo.serviceType.id, todo.plan.id),
                },
            };
    }
}

/**
 * The warning at the top of the dashboard when the database cannot be read:
 * why, and what the page still shows without it. Null when it can be read.
 */
export function databaseNotice(dashboard: Pick<Dashboard, "databaseError">): string | null {
    return dashboard.databaseError === null
        ? null
        : `The database can't be read${reasonSentence(dashboard.databaseError)} The plans are shown without numbers or hymnal notes, and the catalog and the song sync can't be checked.`;
}

/**
 * The warning in place of the next plans when Planning Center's service
 * types cannot be read, quiet like the plans list's: the reason is logged,
 * not shown. Null when they can be read.
 */
export function serviceTypesNotice(dashboard: Pick<Dashboard, "serviceTypesError">): string | null {
    return dashboard.serviceTypesError === null
        ? null
        : "Planning Center couldn't be reached, so the next plans can't be shown.";
}

/** What a service type's card says when it has no next plan, or it could not be read. */
export const NO_NEXT_PLAN_TEXT = "No upcoming plan in Planning Center.";
export const NEXT_PLAN_FAILED_TEXT = "Its next plan couldn't be loaded from Planning Center.";

/** What the dashboard says when Planning Center lists no service type that is not archived. */
export const NO_SERVICE_TYPES_TEXT = "Planning Center has no service types.";

/**
 * What the to-do list says when it is empty: "Nothing to do.", unless
 * something could not be read (the service types, a service type's next
 * plan, or the database), whose to-dos are then unknown.
 */
export function emptyTodosText(
    dashboard: Pick<Dashboard, "serviceTypesError" | "databaseError"> & {
        serviceTypes: readonly Pick<DashboardServiceType, "status">[];
    }
): string {
    const unchecked =
        dashboard.serviceTypesError !== null ||
        dashboard.databaseError !== null ||
        dashboard.serviceTypes.some((entry) => entry.status === "failed");
    return unchecked ? "Nothing to do among what could be checked." : "Nothing to do.";
}
