import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// vi.hoisted is required: vi.mock is hoisted above const declarations.
const { auth, revalidatePath, syncPcoSongsNow, getSettings, saveSettings } = vi.hoisted(() => ({
    auth: vi.fn(),
    revalidatePath: vi.fn(),
    syncPcoSongsNow: vi.fn(),
    getSettings: vi.fn(),
    saveSettings: vi.fn(),
}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/queries/reconcile", () => ({ syncPcoSongsNow }));
vi.mock("@/lib/queries/settings", () => ({ getSettings, saveSettings }));

import { FORM_FAILURE_MESSAGE, IDLE_FORM } from "@/lib/forms";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import {
    saveCopyrightAction,
    saveHymnalNotesAction,
    saveScheduleTextAction,
    syncPcoSongsAction,
} from "./actions";

const SESSION = {
    user: { email: "someone@example.com" },
    expires: "2026-11-03T12:00:00.000Z",
};

/** The finished run of the song sync that syncPcoSongsNow started or joined. */
function run(ok: boolean, message: string | null) {
    return {
        run: {
            id: 7,
            kind: "pco-songs",
            startedAt: "2026-10-04T12:00:00.000Z",
            finishedAt: "2026-10-04T12:00:05.000Z",
            ok,
            message,
            counts: null,
        },
    };
}

/** The pages a sync revalidates. */
const SYNC_PAGES = [["/settings"], ["/catalog", "layout"], ["/plans", "layout"]];

beforeEach(() => {
    for (const mock of [auth, revalidatePath, syncPcoSongsNow, getSettings, saveSettings]) {
        mock.mockReset();
    }
    auth.mockResolvedValue(SESSION);
    getSettings.mockReturnValue({ settings: DEFAULT_SETTINGS, error: null });
    saveSettings.mockReturnValue({ ok: true, saved: [] });
    vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe("syncPcoSongsAction", () => {
    test("throws without a session, before it syncs", async () => {
        auth.mockResolvedValue(null);

        await expect(syncPcoSongsAction()).rejects.toThrow("Not signed in");
        expect(syncPcoSongsNow).not.toHaveBeenCalled();
        expect(revalidatePath).not.toHaveBeenCalled();
    });

    test("syncs, gives the run's message and revalidates the pages it changes", async () => {
        syncPcoSongsNow.mockResolvedValue(run(true, "Synced 397 songs: 5 auto-linked"));

        await expect(syncPcoSongsAction()).resolves.toEqual({
            ok: true,
            message: "Synced 397 songs: 5 auto-linked",
        });
        expect(syncPcoSongsNow).toHaveBeenCalledTimes(1);
        expect(revalidatePath.mock.calls).toEqual(SYNC_PAGES);
    });

    test("says why a sync failed, and still revalidates, since the run is recorded", async () => {
        syncPcoSongsNow.mockResolvedValue(run(false, "PCO request failed (status: 500)"));

        await expect(syncPcoSongsAction()).resolves.toEqual({
            ok: false,
            message: "The sync failed: PCO request failed (status: 500).",
        });
        expect(revalidatePath.mock.calls).toEqual(SYNC_PAGES);
    });

    test("words a run without a message", async () => {
        syncPcoSongsNow.mockResolvedValue(run(true, null));
        await expect(syncPcoSongsAction()).resolves.toEqual({ ok: true, message: "Synced." });

        syncPcoSongsNow.mockResolvedValue(run(false, null));
        await expect(syncPcoSongsAction()).resolves.toEqual({
            ok: false,
            message: "The sync failed: no reason was recorded.",
        });
    });

    test("returns a message, and logs the cause, when the sync throws all the same", async () => {
        const cause = new Error("Unexpected");
        syncPcoSongsNow.mockRejectedValue(cause);

        await expect(syncPcoSongsAction()).resolves.toEqual({
            ok: false,
            message: FORM_FAILURE_MESSAGE,
        });
        expect(console.error).toHaveBeenCalledWith(
            "Failed to sync the Planning Center songs:",
            cause
        );
        expect(revalidatePath).not.toHaveBeenCalled();
    });

    test("says nothing was changed, and revalidates nothing, when no run could be recorded", async () => {
        syncPcoSongsNow.mockResolvedValue({ run: null, error: "database or disk is full" });

        await expect(syncPcoSongsAction()).resolves.toEqual({
            ok: false,
            message: FORM_FAILURE_MESSAGE,
        });
        expect(revalidatePath).not.toHaveBeenCalled();
    });
});

/** Every page a saved setting revalidates: Settings, the plan pages and the dashboard. */
const SETTINGS_PAGES = [["/settings"], ["/plans", "layout"], ["/"]];

/** The message above the Save button when a field needs fixing. */
const FIX_FIELDS = "Nothing was saved. Fix what is marked below, then try again.";

/** A form as the browser posts it. */
function formWith(fields: Record<string, string>): FormData {
    const formData = new FormData();
    for (const [name, value] of Object.entries(fields)) {
        formData.set(name, value);
    }
    return formData;
}

/** Each action, to test what they share. */
const FORM_ACTIONS = [
    ["saveCopyrightAction", saveCopyrightAction, { ccliLicenseNumber: "7654321" }],
    [
        "saveScheduleTextAction",
        saveScheduleTextAction,
        { numberSeparator: " / ", "headerLabel-1405391": "Sunday AM" },
    ],
    [
        "saveHymnalNotesAction",
        saveHymnalNotesAction,
        { hymnNoteCategoryName: "Hymnal", hymnNoteIncludesTune: "no" },
    ],
] as const;

describe.each(FORM_ACTIONS)("%s", (_name, action, fields) => {
    test("throws without a session, before it reads or saves anything", async () => {
        auth.mockResolvedValue(null);

        await expect(action(IDLE_FORM, formWith(fields))).rejects.toThrow("Not signed in");
        expect(getSettings).not.toHaveBeenCalled();
        expect(saveSettings).not.toHaveBeenCalled();
        expect(revalidatePath).not.toHaveBeenCalled();
    });

    test("saves, revalidates Settings, the plan pages and the dashboard, and says it is saved", async () => {
        saveSettings.mockReturnValue({ ok: true, saved: ["x"] });

        const state = await action(IDLE_FORM, formWith(fields));

        expect(state).toMatchObject({ status: "success", message: "Saved." });
        expect(saveSettings).toHaveBeenCalledTimes(1);
        expect(revalidatePath.mock.calls).toEqual(SETTINGS_PAGES);
    });

    test("logs the cause and gives the generic message when the save throws, with what was posted", async () => {
        const cause = new Error("database or disk is full");
        saveSettings.mockImplementation(() => {
            throw cause;
        });

        await expect(action(IDLE_FORM, formWith(fields))).resolves.toEqual({
            status: "error",
            message: FORM_FAILURE_MESSAGE,
            fieldErrors: {},
            values: fields,
        });
        expect(console.error).toHaveBeenCalledWith("Failed to save the settings:", cause);
        expect(revalidatePath).not.toHaveBeenCalled();
    });

    test("passes on a refusal from the save, marking the fields it names", async () => {
        saveSettings.mockReturnValue({
            ok: false,
            message: "Nothing was saved: fix the settings marked below.",
            fieldErrors: {
                numberSeparator: "The number separator must be text.",
                scheduleHeaderLabels: "The header labels must be a label for each service type.",
            },
        });

        const state = await action(IDLE_FORM, formWith(fields));

        expect(state.status).toBe("error");
        if (state.status === "error") {
            expect(state.message).toContain("Nothing was saved: fix the settings marked below.");
            expect(state.message).toContain("The header labels must be a label for each service type.");
            expect(state.values).toEqual(fields);
            // Only a setting that is a field of this form is marked.
            expect(Object.keys(state.fieldErrors)).toEqual(
                "numberSeparator" in fields ? ["numberSeparator"] : []
            );
        }
        expect(revalidatePath).not.toHaveBeenCalled();
    });
});

describe("saveCopyrightAction", () => {
    test("saves the number trimmed, and gives the form what is saved", async () => {
        const state = await saveCopyrightAction(
            IDLE_FORM,
            formWith({ ccliLicenseNumber: "  7654321 " })
        );

        expect(saveSettings).toHaveBeenCalledWith({ ccliLicenseNumber: "7654321" });
        expect(state).toEqual({
            status: "success",
            message: "Saved.",
            values: { ccliLicenseNumber: "7654321" },
        });
    });

    test.each([
        ["blank", "  ", "Enter the CCLI license number."],
        [
            "not digits",
            "12-34",
            "A CCLI license number is digits only, at most 20 of them, such as 1564484.",
        ],
    ])("refuses a number that is %s, on its field, and saves nothing", async (_name, posted, message) => {
        const state = await saveCopyrightAction(IDLE_FORM, formWith({ ccliLicenseNumber: posted }));

        expect(state).toEqual({
            status: "error",
            message: FIX_FIELDS,
            fieldErrors: { ccliLicenseNumber: { message } },
            values: { ccliLicenseNumber: posted },
        });
        expect(saveSettings).not.toHaveBeenCalled();
        expect(revalidatePath).not.toHaveBeenCalled();
    });
});

describe("saveScheduleTextAction", () => {
    const SAVED_LABELS = { "1405391": "Sunday AM", "1500000": "Midweek" };

    beforeEach(() => {
        getSettings.mockReturnValue({
            settings: { ...DEFAULT_SETTINGS, scheduleHeaderLabels: SAVED_LABELS },
            error: null,
        });
    });

    test("saves the labels and the separator as typed, keeping the labels the form did not list", async () => {
        const state = await saveScheduleTextAction(
            IDLE_FORM,
            formWith({
                "headerLabel-1405391": "  Sunday Morning ",
                "headerLabel-1486055": "Evening",
                numberSeparator: " | ",
            })
        );

        expect(saveSettings).toHaveBeenCalledWith({
            scheduleHeaderLabels: {
                "1405391": "Sunday Morning",
                "1500000": "Midweek",
                "1486055": "Evening",
            },
            numberSeparator: " | ",
        });
        expect(state).toEqual({
            status: "success",
            message: "Saved.",
            values: {
                "headerLabel-1405391": "Sunday Morning",
                "headerLabel-1486055": "Evening",
                numberSeparator: " | ",
            },
        });
    });

    test("keeps the spaces of the separator", async () => {
        await saveScheduleTextAction(IDLE_FORM, formWith({ numberSeparator: " / " }));

        expect(saveSettings).toHaveBeenCalledWith({
            scheduleHeaderLabels: SAVED_LABELS,
            numberSeparator: " / ",
        });
    });

    test("drops a blank label, so its service type gets its default", async () => {
        await saveScheduleTextAction(
            IDLE_FORM,
            formWith({ "headerLabel-1405391": "  ", numberSeparator: " / " })
        );

        expect(saveSettings).toHaveBeenCalledWith({
            scheduleHeaderLabels: { "1500000": "Midweek" },
            numberSeparator: " / ",
        });
    });

    test("marks every field that is wrong at once, and saves nothing", async () => {
        const state = await saveScheduleTextAction(
            IDLE_FORM,
            formWith({
                "headerLabel-1405391": "x".repeat(41),
                "headerLabel-1486055": "Fine",
                numberSeparator: "",
            })
        );

        expect(state).toMatchObject({
            status: "error",
            message: FIX_FIELDS,
            fieldErrors: {
                "headerLabel-1405391": { message: "A header label is at most 40 characters." },
                numberSeparator: { message: expect.stringContaining("Enter what goes between") },
            },
            values: { "headerLabel-1486055": "Fine", numberSeparator: "" },
        });
        expect(saveSettings).not.toHaveBeenCalled();
        expect(revalidatePath).not.toHaveBeenCalled();
    });

    test("refuses a field that does not name a service type's id, as a tampered form", async () => {
        const state = await saveScheduleTextAction(
            IDLE_FORM,
            formWith({ "headerLabel-abc": "Sunday", numberSeparator: " / " })
        );

        expect(state).toMatchObject({
            status: "error",
            fieldErrors: { "headerLabel-abc": { message: "That is not a service type's id." } },
        });
        expect(saveSettings).not.toHaveBeenCalled();
    });

    test("saves nothing when the saved labels cannot be read, rather than lose them", async () => {
        getSettings.mockReturnValue({
            settings: DEFAULT_SETTINGS,
            error: "Could not open the database at /srv/data/x: denied",
        });

        await expect(
            saveScheduleTextAction(IDLE_FORM, formWith({ numberSeparator: " / " }))
        ).resolves.toEqual({
            status: "error",
            message: FORM_FAILURE_MESSAGE,
            fieldErrors: {},
            values: {},
        });
        expect(saveSettings).not.toHaveBeenCalled();
        expect(revalidatePath).not.toHaveBeenCalled();
    });
});

describe("saveHymnalNotesAction", () => {
    test("saves the category trimmed and the tune as a yes or no", async () => {
        const state = await saveHymnalNotesAction(
            IDLE_FORM,
            formWith({ hymnNoteCategoryName: " Hymn Numbers ", hymnNoteIncludesTune: "yes" })
        );

        expect(saveSettings).toHaveBeenCalledWith({
            hymnNoteCategoryName: "Hymn Numbers",
            hymnNoteIncludesTune: true,
        });
        expect(state).toEqual({
            status: "success",
            message: "Saved.",
            values: { hymnNoteCategoryName: "Hymn Numbers", hymnNoteIncludesTune: "yes" },
        });
    });

    test("refuses a blank category, on its field, and saves nothing", async () => {
        const state = await saveHymnalNotesAction(
            IDLE_FORM,
            formWith({ hymnNoteCategoryName: "   ", hymnNoteIncludesTune: "no" })
        );

        expect(state).toEqual({
            status: "error",
            message: FIX_FIELDS,
            fieldErrors: {
                hymnNoteCategoryName: {
                    message: "Enter the name of the item note category, such as Hymnal.",
                },
            },
            values: { hymnNoteCategoryName: "   ", hymnNoteIncludesTune: "no" },
        });
        expect(saveSettings).not.toHaveBeenCalled();
    });

    test("refuses a tune that is neither yes nor no", async () => {
        const state = await saveHymnalNotesAction(
            IDLE_FORM,
            formWith({ hymnNoteCategoryName: "Hymnal", hymnNoteIncludesTune: "maybe" })
        );

        expect(state).toMatchObject({
            status: "error",
            fieldErrors: {
                hymnNoteIncludesTune: {
                    message: "Whether the note names the tune must be yes or no.",
                },
            },
        });
        expect(saveSettings).not.toHaveBeenCalled();
    });
});
