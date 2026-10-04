import { describe, expect, test } from "vitest";
import type { SyncRun } from "@/lib/db/syncRuns";
import {
    HYMN_NOTE_BADGE_LABELS,
    dashboardNotices,
    emptyTodosText,
    hymnNoteBadge,
    planNotesSummary,
    songNumbersView,
    todoView,
} from "./dashboard";
import type { HymnNoteAction, HymnNoteStatus } from "./hymnNotes";
import type { DashboardTodo } from "./queries/dashboard";

const MORNING = { id: "1405391", name: "Sunday Morning" };
const AM_PLAN = { id: "81234567", dates: "October 4, 2026", shortDates: "Oct 4" };
const AM_LABEL = "October 4, 2026 · Sunday Morning";

function syncRun(overrides: Partial<SyncRun> = {}): SyncRun {
    return {
        id: 7,
        kind: "pco-songs",
        startedAt: "2026-10-04T08:00:00.000Z",
        finishedAt: "2026-10-04T08:00:05.000Z",
        ok: true,
        message: "Synced 397 songs",
        counts: null,
        ...overrides,
    };
}

const READY: HymnNoteStatus = { kind: "ready", category: { id: "503", name: "Hymnal" }, items: [] };

/** A song row's note, with only what the badge reads. */
const noted = (action: HymnNoteAction) => ({ note: { action } });

describe("songNumbersView", () => {
    test("a linked song shows its numbers", () => {
        expect(songNumbersView({ link: { kind: "linked" }, numbers: "R-396 / G-317" })).toEqual({
            kind: "numbers",
            text: "R-396 / G-317",
        });
    });

    test("a linked song in no book says so", () => {
        expect(songNumbersView({ link: { kind: "linked" }, numbers: "" })).toEqual({
            kind: "note",
            text: "Not in a book",
        });
    });

    test("a song not in the catalog is the one to fix", () => {
        expect(songNumbersView({ link: { kind: "unlinked" }, numbers: "" })).toEqual({
            kind: "fix",
            text: "Not in the catalog",
        });
    });

    test.each([
        ["ignored", "Not hymnal material"],
        ["no-song", "No Planning Center song"],
        ["unknown", "Numbers unavailable"],
    ] as const)("%s says why it has no numbers: %s", (kind, text) => {
        expect(songNumbersView({ link: { kind }, numbers: "" })).toEqual({ kind: "note", text });
    });
});

describe("hymnNoteBadge", () => {
    test.each<[HymnNoteAction, string | null]>([
        ["unchanged", "Note in sync"],
        ["create", "Note missing"],
        ["update", "Note differs"],
        ["dedupe", "Note differs"],
        ["delete", "Note differs"],
        ["none", null],
    ])("%s: %s", (action, label) => {
        expect(hymnNoteBadge(noted(action))?.label ?? null).toBe(label);
    });

    test("carries the state, for its colour", () => {
        expect(hymnNoteBadge(noted("unchanged"))).toEqual({ state: "in-sync", label: "Note in sync" });
        expect(hymnNoteBadge(noted("create"))?.state).toBe("missing");
    });

    test("none when the notes cannot be compared", () => {
        expect(hymnNoteBadge({ note: null })).toBeNull();
    });

    test("labels every state", () => {
        expect(Object.keys(HYMN_NOTE_BADGE_LABELS).sort()).toEqual(["differs", "in-sync", "missing"]);
    });
});

describe("planNotesSummary", () => {
    test("notes that need a sync, counted", () => {
        const songs = [noted("unchanged"), noted("create"), noted("update")];
        expect(planNotesSummary({ hymnNotes: READY, notesToSync: 2, songs })).toEqual({
            tone: "attention",
            text: "2 hymnal notes need syncing.",
        });
        expect(planNotesSummary({ hymnNotes: READY, notesToSync: 1, songs })?.text).toBe(
            "1 hymnal note needs syncing."
        );
    });

    test("notes in sync", () => {
        const songs = [noted("unchanged"), noted("none"), { note: null }];
        expect(planNotesSummary({ hymnNotes: READY, notesToSync: 0, songs })).toEqual({
            tone: "ok",
            text: "Hymnal notes in sync.",
        });
    });

    test("nothing when no song has a note to keep", () => {
        expect(planNotesSummary({ hymnNotes: READY, notesToSync: 0, songs: [noted("none")] })).toBeNull();
        expect(planNotesSummary({ hymnNotes: READY, notesToSync: 0, songs: [] })).toBeNull();
    });

    test("a missing category asks for one", () => {
        const message = 'Create an item note category named "Hymnal" in Planning Center for Sunday Evening.';
        expect(
            planNotesSummary({
                hymnNotes: { kind: "no-category", categoryName: "Hymnal", message },
                notesToSync: 0,
                songs: [{ note: null }],
            })
        ).toEqual({ tone: "warning", text: message });
    });

    test("notes that cannot be compared say why, briefly", () => {
        const unavailable = (reason: "catalog" | "categories"): HymnNoteStatus => ({
            kind: "unavailable",
            reason,
            message: "A long message with the error in it.",
        });
        expect(planNotesSummary({ hymnNotes: unavailable("catalog"), notesToSync: 0, songs: [] })).toEqual({
            tone: "muted",
            text: "Hymnal notes can't be compared while the catalog is unavailable.",
        });
        expect(
            planNotesSummary({ hymnNotes: unavailable("categories"), notesToSync: 0, songs: [] })
        ).toEqual({
            tone: "muted",
            text: "Hymnal notes can't be compared: Planning Center's item note categories couldn't be read.",
        });
    });
});

describe("todoView", () => {
    test("an empty catalog links to Import", () => {
        expect(todoView({ kind: "empty-catalog" })).toEqual({
            key: "empty-catalog",
            context: null,
            text: "The catalog has no songs yet, so no song has numbers.",
            time: null,
            action: { label: "Import the hymnals", href: "/catalog/import" },
        });
    });

    test("a failed sync says why and when, and links to Settings' Sync now", () => {
        const run = syncRun({ ok: false, message: "Planning Center did not respond" });
        expect(todoView({ kind: "sync-failed", run })).toEqual({
            key: "sync-failed",
            context: null,
            text: "The Planning Center song sync failed: Planning Center did not respond.",
            time: { label: "Last run", iso: "2026-10-04T08:00:05.000Z" },
            action: { label: "Sync now on Settings", href: "/settings" },
        });
    });

    test("a failure's reason ends the sentence once", () => {
        const text = (message: string | null) =>
            todoView({ kind: "sync-failed", run: syncRun({ ok: false, message }) }).text;
        expect(text("Timed out.")).toBe("The Planning Center song sync failed: Timed out.");
        expect(text("  ")).toBe("The Planning Center song sync failed.");
        expect(text(null)).toBe("The Planning Center song sync failed.");
    });

    test("a stale sync gives its last success", () => {
        expect(todoView({ kind: "sync-stale", run: syncRun() })).toMatchObject({
            key: "sync-stale",
            text: "The Planning Center song sync is overdue: it runs every hour.",
            time: { label: "Last success", iso: "2026-10-04T08:00:05.000Z" },
            action: { label: "Sync now on Settings", href: "/settings" },
        });
    });

    test("a sync that never ran", () => {
        expect(todoView({ kind: "sync-stale", run: null })).toMatchObject({
            text: "The Planning Center song sync has never run.",
            time: null,
            action: { href: "/settings" },
        });
    });

    test("a missing category gives the query's message and links to Settings", () => {
        const message = 'Create an item note category named "Hymnal" in Planning Center for Sunday Evening.';
        expect(
            todoView({
                kind: "missing-category",
                serviceType: { id: "1486055", name: "Sunday Evening" },
                categoryName: "Hymnal",
                message,
            })
        ).toEqual({
            key: "missing-category-1486055",
            context: null,
            text: message,
            time: null,
            action: { label: "Hymnal note settings", href: "/settings" },
        });
    });

    test("songs not in the catalog link to the plan's Schedule tab", () => {
        const songs = (...titles: string[]) =>
            titles.map((title, i) => ({ itemId: String(i + 1), title, pcoSongId: String(90 + i) }));
        const view = (...titles: string[]) =>
            todoView({ kind: "songs-not-in-catalog", serviceType: MORNING, plan: AM_PLAN, songs: songs(...titles) });

        expect(view("New Song")).toEqual({
            key: "songs-not-in-catalog-81234567",
            context: AM_LABEL,
            text: '"New Song" isn\'t in the catalog.',
            time: null,
            action: { label: "Link it on the Schedule tab", href: "/plans/1405391/81234567/schedule" },
        });
        expect(view("Come, Thou Fount", "New Song")).toMatchObject({
            text: '2 songs aren\'t in the catalog: "Come, Thou Fount" and "New Song".',
            action: { label: "Link them on the Schedule tab" },
        });
        expect(view("A", "B", "C").text).toBe('3 songs aren\'t in the catalog: "A", "B" and "C".');
    });

    test("notes out of date link to the plan, where they are synced", () => {
        const view = (count: number) =>
            todoView({ kind: "notes-out-of-date", serviceType: MORNING, plan: AM_PLAN, count });
        expect(view(1)).toEqual({
            key: "notes-out-of-date-81234567",
            context: AM_LABEL,
            text: "1 hymnal note needs syncing.",
            time: null,
            action: { label: "Open the plan to sync it", href: "/plans/1405391/81234567" },
        });
        expect(view(3)).toMatchObject({
            text: "3 hymnal notes need syncing.",
            action: { label: "Open the plan to sync them" },
        });
    });

    test("every to-do of a dashboard has its own key", () => {
        const evening = { id: "1486055", name: "Sunday Evening" };
        const pmPlan = { ...AM_PLAN, id: "81234568" };
        const todos: DashboardTodo[] = [
            { kind: "empty-catalog" },
            { kind: "sync-failed", run: syncRun({ ok: false }) },
            { kind: "missing-category", serviceType: MORNING, categoryName: "Hymnal", message: "m" },
            { kind: "missing-category", serviceType: evening, categoryName: "Hymnal", message: "m" },
            { kind: "songs-not-in-catalog", serviceType: MORNING, plan: AM_PLAN, songs: [] },
            { kind: "songs-not-in-catalog", serviceType: evening, plan: pmPlan, songs: [] },
            { kind: "notes-out-of-date", serviceType: MORNING, plan: AM_PLAN, count: 1 },
            { kind: "notes-out-of-date", serviceType: evening, plan: pmPlan, count: 1 },
        ];
        const keys = todos.map((todo) => todoView(todo).key);
        expect(new Set(keys).size).toBe(keys.length);
    });
});

describe("dashboardNotices", () => {
    test("none when everything could be read", () => {
        expect(dashboardNotices({ serviceTypesError: null, databaseError: null })).toEqual([]);
    });

    test("service types that cannot be read: no plans, quietly", () => {
        expect(
            dashboardNotices({ serviceTypesError: "Planning Center API responded with status: 500", databaseError: null })
        ).toEqual(["Planning Center couldn't be reached, so the next plans can't be shown."]);
    });

    test("a database that cannot be read: why, and what is still shown", () => {
        expect(
            dashboardNotices({ serviceTypesError: null, databaseError: "Could not open the database at /srv/x: denied" })
        ).toEqual([
            "The database can't be read: Could not open the database at /srv/x: denied. The plans are shown without numbers or hymnal notes, and the catalog and the song sync can't be checked.",
        ]);
        expect(dashboardNotices({ serviceTypesError: null, databaseError: "Disk full." })[0]).toMatch(
            /^The database can't be read: Disk full\. The plans/
        );
    });

    test("both, Planning Center first", () => {
        expect(dashboardNotices({ serviceTypesError: "x", databaseError: "y" })).toHaveLength(2);
    });
});

describe("emptyTodosText", () => {
    const fine = { serviceTypesError: null, databaseError: null };

    test("nothing to do when everything was checked", () => {
        expect(emptyTodosText({ ...fine, serviceTypes: [{ status: "plan" }, { status: "no-plan" }] })).toBe(
            "Nothing to do."
        );
        expect(emptyTodosText({ ...fine, serviceTypes: [] })).toBe("Nothing to do.");
    });

    test.each([
        ["a service type that failed", { ...fine, serviceTypes: [{ status: "plan" as const }, { status: "failed" as const }] }],
        ["service types that cannot be read", { ...fine, serviceTypesError: "x", serviceTypes: [] }],
        ["a database that cannot be read", { ...fine, databaseError: "x", serviceTypes: [] }],
    ])("hedged after %s", (_, dashboard) => {
        expect(emptyTodosText(dashboard)).toBe("Nothing to do among what could be checked.");
    });
});
