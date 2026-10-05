import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// vi.hoisted is required: vi.mock is hoisted above const declarations.
const {
    auth,
    revalidatePath,
    syncPcoSongsNow,
    syncPlanHistoryNow,
    getSettings,
    saveSettings,
    rederiveAllCredits,
    getCreditLabelSets,
    exportCatalogJson,
} = vi.hoisted(() => ({
    auth: vi.fn(),
    revalidatePath: vi.fn(),
    syncPcoSongsNow: vi.fn(),
    syncPlanHistoryNow: vi.fn(),
    getSettings: vi.fn(),
    saveSettings: vi.fn(),
    rederiveAllCredits: vi.fn(),
    getCreditLabelSets: vi.fn(),
    exportCatalogJson: vi.fn(),
}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/queries/reconcile", () => ({ syncPcoSongsNow }));
vi.mock("@/lib/queries/reports", () => ({ syncPlanHistoryNow }));
vi.mock("@/lib/queries/settings", () => ({ getSettings, saveSettings }));
vi.mock("@/lib/queries/credits", () => ({ rederiveAllCredits, getCreditLabelSets }));
vi.mock("@/lib/queries/export", () => ({ exportCatalogJson }));

import { ROLES_IMPACT_UNCHECKED_MESSAGE } from "@/lib/creditRoleImpact";
import { FORM_FAILURE_MESSAGE } from "@/lib/forms";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import {
    exportCatalogAction,
    saveCopyrightAction,
    saveCreditsAction,
    saveEmailAction,
    saveHymnalNotesAction,
    saveRepeatWarningsAction,
    saveScheduleTextAction,
    syncPcoSongsAction,
    syncPlanHistoryAction,
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

/** The pages a song sync revalidates. */
const SYNC_PAGES = [["/settings"], ["/catalog", "layout"], ["/plans", "layout"]];

/** The pages a history sync revalidates: it also changes Reports and the dashboard. */
const HISTORY_SYNC_PAGES = [
    ["/settings"],
    ["/reports"],
    ["/catalog", "layout"],
    ["/plans", "layout"],
    ["/"],
];

beforeEach(() => {
    for (const mock of [
        auth,
        revalidatePath,
        syncPcoSongsNow,
        syncPlanHistoryNow,
        getSettings,
        saveSettings,
        rederiveAllCredits,
        getCreditLabelSets,
        exportCatalogJson,
    ]) {
        mock.mockReset();
    }
    auth.mockResolvedValue(SESSION);
    getSettings.mockReturnValue({ settings: DEFAULT_SETTINGS, error: null });
    saveSettings.mockReturnValue({ ok: true, saved: [] });
    rederiveAllCredits.mockReturnValue({ songs: 8, ok: 1, legacy: 7, unparsed: 0 });
    // No song is labelled, so no change of the roles changes any song's copyright text.
    getCreditLabelSets.mockReturnValue({ sets: [], error: null });
    vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe("exportCatalogAction", () => {
    test("throws without a session, before it reads the catalog", async () => {
        auth.mockResolvedValue(null);

        await expect(exportCatalogAction()).rejects.toThrow("Not signed in");
        expect(exportCatalogJson).not.toHaveBeenCalled();
    });

    test("hands the catalog's JSON to the button, and revalidates nothing, since it only reads", async () => {
        exportCatalogJson.mockReturnValue('{\n  "format": "service-integrator-catalog"\n}\n');

        await expect(exportCatalogAction()).resolves.toEqual({
            ok: true,
            json: '{\n  "format": "service-integrator-catalog"\n}\n',
        });
        expect(exportCatalogJson).toHaveBeenCalledTimes(1);
        expect(revalidatePath).not.toHaveBeenCalled();
    });

    test("returns a message, and logs the cause, when the catalog cannot be read", async () => {
        const cause = new Error("Could not open the database");
        exportCatalogJson.mockImplementation(() => {
            throw cause;
        });

        await expect(exportCatalogAction()).resolves.toEqual({
            ok: false,
            message: expect.stringContaining("nothing was downloaded"),
        });
        expect(console.error).toHaveBeenCalledWith("Failed to export the catalog:", cause);
    });
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

describe("syncPlanHistoryAction", () => {
    /** The finished run of the history sync that syncPlanHistoryNow started or joined. */
    function historyRun(ok: boolean, message: string | null) {
        return { run: { ...run(ok, message).run, kind: "history" } };
    }

    test("throws without a session, before it syncs", async () => {
        auth.mockResolvedValue(null);

        await expect(syncPlanHistoryAction()).rejects.toThrow("Not signed in");
        expect(syncPlanHistoryNow).not.toHaveBeenCalled();
        expect(syncPcoSongsNow).not.toHaveBeenCalled();
        expect(revalidatePath).not.toHaveBeenCalled();
    });

    test("syncs the history, gives the run's message and revalidates every page that shows it", async () => {
        syncPlanHistoryNow.mockResolvedValue(
            historyRun(true, "Synced 216 plans (1386 song items): read 21 plans (4 in the weekly pass), 2 added, 1 changed")
        );

        await expect(syncPlanHistoryAction()).resolves.toEqual({
            ok: true,
            message: "Synced 216 plans (1386 song items): read 21 plans (4 in the weekly pass), 2 added, 1 changed",
        });
        expect(syncPlanHistoryNow).toHaveBeenCalledTimes(1);
        expect(syncPcoSongsNow).not.toHaveBeenCalled();
        expect(revalidatePath.mock.calls).toEqual(HISTORY_SYNC_PAGES);
    });

    test("says why a sync failed, and still revalidates, since the run is recorded", async () => {
        syncPlanHistoryNow.mockResolvedValue(historyRun(false, "PCO request failed (status: 500)"));

        await expect(syncPlanHistoryAction()).resolves.toEqual({
            ok: false,
            message: "The sync failed: PCO request failed (status: 500).",
        });
        expect(revalidatePath.mock.calls).toEqual(HISTORY_SYNC_PAGES);
    });

    test("words a run without a message", async () => {
        syncPlanHistoryNow.mockResolvedValue(historyRun(true, null));
        await expect(syncPlanHistoryAction()).resolves.toEqual({ ok: true, message: "Synced." });

        syncPlanHistoryNow.mockResolvedValue(historyRun(false, null));
        await expect(syncPlanHistoryAction()).resolves.toEqual({
            ok: false,
            message: "The sync failed: no reason was recorded.",
        });
    });

    test("returns a message, and logs the cause, when the sync throws all the same", async () => {
        const cause = new Error("Unexpected");
        syncPlanHistoryNow.mockRejectedValue(cause);

        await expect(syncPlanHistoryAction()).resolves.toEqual({
            ok: false,
            message: FORM_FAILURE_MESSAGE,
        });
        expect(console.error).toHaveBeenCalledWith("Failed to sync the plan history:", cause);
        expect(revalidatePath).not.toHaveBeenCalled();
    });

    test("says nothing was changed, and revalidates nothing, when no run could be recorded", async () => {
        syncPlanHistoryNow.mockResolvedValue({ run: null, error: "database or disk is full" });

        await expect(syncPlanHistoryAction()).resolves.toEqual({
            ok: false,
            message: FORM_FAILURE_MESSAGE,
        });
        expect(revalidatePath).not.toHaveBeenCalled();
    });
});

/** Every page a saved setting revalidates: Settings, the plan pages and the dashboard. */
const SETTINGS_PAGES = [["/settings"], ["/plans", "layout"], ["/"]];

/** What saving the credits revalidates: Settings, the plan pages and the catalog's, not the dashboard. */
const CREDIT_PAGES = [["/settings"], ["/plans", "layout"], ["/catalog", "layout"]];

/** What saving the repeat warning window revalidates: Settings and the plan pages, whose Schedule tabs warn. */
const REPEAT_WARNING_PAGES = [["/settings"], ["/plans", "layout"]];

/** What saving the email settings revalidates: Settings alone. */
const EMAIL_PAGES = [["/settings"]];

/** The message above the Save button when a field needs fixing. */
const FIX_FIELDS = "Nothing was saved. Fix the fields that have an error message, then try again.";

/** A form as the browser posts it. */
function formWith(fields: Record<string, string>): FormData {
    const formData = new FormData();
    for (const [name, value] of Object.entries(fields)) {
        formData.set(name, value);
    }
    return formData;
}

/** Each action, to test what they share: its form's fields, and the pages a save revalidates. */
const FORM_ACTIONS = [
    ["saveCopyrightAction", saveCopyrightAction, { ccliLicenseNumber: "7654321" }, SETTINGS_PAGES],
    [
        "saveScheduleTextAction",
        saveScheduleTextAction,
        { numberSeparator: " / ", "headerLabel-1405391": "Sunday AM" },
        SETTINGS_PAGES,
    ],
    [
        "saveHymnalNotesAction",
        saveHymnalNotesAction,
        { hymnNoteCategoryName: "Hymnal", hymnNoteIncludesTune: "no" },
        SETTINGS_PAGES,
    ],
    [
        "saveCreditsAction",
        saveCreditsAction,
        {
            "creditRole-0": "Words",
            "creditPhrase-0": "Words by",
            "creditRole-1": "Music",
            "creditPhrase-1": "Music by",
            creditPairPhrase: "Words and Music by",
        },
        CREDIT_PAGES,
    ],
    [
        "saveEmailAction",
        saveEmailAction,
        { emailRecipients: "pastor@example.org", emailSubjectTemplate: "Songs for {date}" },
        EMAIL_PAGES,
    ],
    ["saveRepeatWarningsAction", saveRepeatWarningsAction, { repeatWarningWeeks: "6" }, REPEAT_WARNING_PAGES],
] as const;

describe.each(FORM_ACTIONS)("%s", (_name, action, fields, pages) => {
    test("throws without a session, before it reads or saves anything", async () => {
        auth.mockResolvedValue(null);

        await expect(action(formWith(fields))).rejects.toThrow("Not signed in");
        expect(getSettings).not.toHaveBeenCalled();
        expect(saveSettings).not.toHaveBeenCalled();
        expect(rederiveAllCredits).not.toHaveBeenCalled();
        expect(getCreditLabelSets).not.toHaveBeenCalled();
        expect(revalidatePath).not.toHaveBeenCalled();
    });

    test("saves, revalidates the pages that show it, and says it is saved", async () => {
        saveSettings.mockReturnValue({ ok: true, saved: ["x"] });

        const state = await action(formWith(fields));

        expect(state).toMatchObject({ status: "success", message: expect.stringMatching(/^Saved\./) });
        expect(saveSettings).toHaveBeenCalledTimes(1);
        expect(revalidatePath.mock.calls).toEqual(pages);
    });

    test("logs the cause and gives the generic message when the save throws, with what was posted", async () => {
        const cause = new Error("database or disk is full");
        saveSettings.mockImplementation(() => {
            throw cause;
        });

        await expect(action(formWith(fields))).resolves.toEqual({
            status: "error",
            message: FORM_FAILURE_MESSAGE,
            fieldErrors: {},
            values: fields,
        });
        expect(console.error).toHaveBeenCalledWith("Failed to save the settings:", cause);
        expect(rederiveAllCredits).not.toHaveBeenCalled();
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

        const state = await action(formWith(fields));

        expect(state.status).toBe("error");
        if (state.status === "error") {
            // Only a setting that is a field of this form is marked; the reason of
            // any other is added to the message, so none is lost.
            const marked = "numberSeparator" in fields;
            expect(Object.keys(state.fieldErrors)).toEqual(marked ? ["numberSeparator"] : []);
            expect(state.message).toBe(
                [
                    marked ? FIX_FIELDS : "Nothing was saved.",
                    ...(marked ? [] : ["The number separator must be text."]),
                    "The header labels must be a label for each service type.",
                ].join(" ")
            );
            expect(state.values).toEqual(fields);
        }
        expect(rederiveAllCredits).not.toHaveBeenCalled();
        expect(revalidatePath).not.toHaveBeenCalled();
    });
});

describe("saveCopyrightAction", () => {
    test("saves the number trimmed, and gives the form what is saved", async () => {
        const state = await saveCopyrightAction(formWith({ ccliLicenseNumber: "  7654321 " }));

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
        const state = await saveCopyrightAction(formWith({ ccliLicenseNumber: posted }));

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

describe("saveRepeatWarningsAction", () => {
    test("saves the weeks as a number, and gives the form what is saved", async () => {
        const state = await saveRepeatWarningsAction(formWith({ repeatWarningWeeks: " 8 " }));

        expect(saveSettings).toHaveBeenCalledWith({ repeatWarningWeeks: 8 });
        expect(state).toEqual({
            status: "success",
            message: "Saved.",
            values: { repeatWarningWeeks: "8" },
        });
    });

    test("saves 0, which turns the warnings off", async () => {
        const state = await saveRepeatWarningsAction(formWith({ repeatWarningWeeks: "0" }));

        expect(saveSettings).toHaveBeenCalledWith({ repeatWarningWeeks: 0 });
        expect(state).toMatchObject({ status: "success", values: { repeatWarningWeeks: "0" } });
    });

    test.each(["", "  ", "abc", "-1", "1.5", "53", "6 weeks"])(
        "refuses %j, on its field, and saves nothing",
        async (posted) => {
            const state = await saveRepeatWarningsAction(formWith({ repeatWarningWeeks: posted }));

            expect(state).toEqual({
                status: "error",
                message: FIX_FIELDS,
                fieldErrors: {
                    repeatWarningWeeks: {
                        message: "Enter a whole number of weeks from 0 to 52; 0 turns the warnings off.",
                    },
                },
                values: { repeatWarningWeeks: posted },
            });
            expect(saveSettings).not.toHaveBeenCalled();
            expect(revalidatePath).not.toHaveBeenCalled();
        }
    );
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
        await saveScheduleTextAction(formWith({ numberSeparator: " / " }));

        expect(saveSettings).toHaveBeenCalledWith({
            scheduleHeaderLabels: SAVED_LABELS,
            numberSeparator: " / ",
        });
    });

    test("drops a blank label, so its service type gets its default", async () => {
        await saveScheduleTextAction(
            formWith({ "headerLabel-1405391": "  ", numberSeparator: " / " })
        );

        expect(saveSettings).toHaveBeenCalledWith({
            scheduleHeaderLabels: { "1500000": "Midweek" },
            numberSeparator: " / ",
        });
    });

    test("marks every field that is wrong at once, and saves nothing", async () => {
        const state = await saveScheduleTextAction(
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

        await expect(saveScheduleTextAction(formWith({ numberSeparator: " / " }))).resolves.toEqual({
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

describe("saveCreditsAction", () => {
    /** The form of the default roles. */
    const DEFAULT_FIELDS = {
        "creditRole-0": "Words",
        "creditPhrase-0": "Words by",
        "creditRole-1": "Music",
        "creditPhrase-1": "Music by",
        "creditRole-2": "Arr.",
        "creditPhrase-2": "Arr. by",
        "creditRole-3": "Trans.",
        "creditPhrase-3": "Trans. by",
        creditPairPhrase: "Words and Music by",
    };

    test("saves the roles in order with their phrases, as the registry takes them", async () => {
        await saveCreditsAction(
            formWith({
                "creditRole-0": " Lyrics ",
                "creditPhrase-0": "Text by",
                "creditRole-1": "Tune",
                "creditPhrase-1": "",
                "creditRole-2": "Setting",
                "creditPhrase-2": "Set by",
                creditPairPhrase: "Text and tune by",
            })
        );

        expect(saveSettings).toHaveBeenCalledWith({
            creditRoles: ["Lyrics", "Tune", "Setting"],
            creditPhrases: {
                Lyrics: "Text by",
                Setting: "Set by",
                "Lyrics & Tune": "Text and tune by",
            },
        });
    });

    test("then reads every song's credits again, and says how many songs and how they read", async () => {
        rederiveAllCredits.mockReturnValue({ songs: 397, ok: 3, legacy: 390, unparsed: 4 });

        const state = await saveCreditsAction(formWith(DEFAULT_FIELDS));

        expect(rederiveAllCredits).toHaveBeenCalledTimes(1);
        expect(rederiveAllCredits).toHaveBeenCalledWith();
        // The roles are stored before they are read.
        expect(saveSettings.mock.invocationCallOrder[0]).toBeLessThan(
            rederiveAllCredits.mock.invocationCallOrder[0]
        );
        expect(state).toEqual({
            status: "success",
            message:
                "Saved. Read the credits of 397 songs again: 3 follow the roles, 390 have no labels and 4 have labels that no role matches.",
            // Each field as the form shows it once saved: the phrases as the text prints them.
            values: DEFAULT_FIELDS,
        });
    });

    test("shows a blank phrase as what the copyright text prints for it", async () => {
        const state = await saveCreditsAction(
            formWith({
                "creditRole-0": "Words",
                "creditPhrase-0": "",
                "creditRole-1": "Music",
                "creditPhrase-1": "Music by",
                creditPairPhrase: "",
            })
        );

        expect(state).toMatchObject({
            status: "success",
            values: {
                "creditPhrase-0": "Words by",
                creditPairPhrase: "Words and Music by",
            },
        });
    });

    test("marks every field that needs fixing, and saves and reads nothing", async () => {
        const state = await saveCreditsAction(
            formWith({
                ...DEFAULT_FIELDS,
                "creditRole-1": "  ",
                "creditRole-3": "words",
            })
        );

        expect(state).toMatchObject({
            status: "error",
            message: FIX_FIELDS,
            fieldErrors: {
                "creditRole-1": { message: "A role cannot be blank." },
                "creditRole-3": { message: 'The role "words" is listed twice.' },
            },
            values: { "creditRole-1": "  ", "creditRole-3": "words" },
        });
        expect(saveSettings).not.toHaveBeenCalled();
        expect(rederiveAllCredits).not.toHaveBeenCalled();
        expect(revalidatePath).not.toHaveBeenCalled();
    });

    test("refuses fewer than two roles, on the list as a whole", async () => {
        const state = await saveCreditsAction(
            formWith({ "creditRole-0": "Words", "creditPhrase-0": "Words by", creditPairPhrase: "" })
        );

        expect(state).toMatchObject({
            status: "error",
            fieldErrors: { creditRoles: { message: expect.stringContaining("at least two roles") } },
        });
        expect(saveSettings).not.toHaveBeenCalled();
    });

    test("reads nothing again when the save is refused", async () => {
        saveSettings.mockReturnValue({
            ok: false,
            message: "Nothing was saved: fix the settings marked below.",
            fieldErrors: { creditRoles: "The roles must be a list." },
        });

        const state = await saveCreditsAction(formWith(DEFAULT_FIELDS));

        expect(state.status).toBe("error");
        expect(rederiveAllCredits).not.toHaveBeenCalled();
        expect(revalidatePath).not.toHaveBeenCalled();
    });

    test("says the roles are saved, and when the credits follow, when they cannot be read again", async () => {
        const cause = new Error("database or disk is full");
        rederiveAllCredits.mockImplementation(() => {
            throw cause;
        });

        const state = await saveCreditsAction(formWith(DEFAULT_FIELDS));

        expect(state).toEqual({
            status: "error",
            message:
                "The roles were saved, but the songs' credits could not be read again. They follow the new roles at the next song sync, within the hour.",
            fieldErrors: {},
            values: DEFAULT_FIELDS,
        });
        expect(console.error).toHaveBeenCalledWith("Failed to read the songs' credits again:", cause);
        // The roles are stored, so the pages that show them are revalidated.
        expect(revalidatePath.mock.calls).toEqual(CREDIT_PAGES);
    });

    describe("roles that change songs' copyright text", () => {
        /** 38 songs labelled with Words and Music, and 2 with Words, Music and Trans. */
        const SETS = [
            { labels: ["Words", "Music"], songs: 38 },
            { labels: ["Words", "Music", "Trans."], songs: 2 },
        ];

        /** The default roles with Music renamed Tune: 40 songs lose their "Music" label. */
        const RENAMED = { ...DEFAULT_FIELDS, "creditRole-1": "Tune" };

        /** What the checkbox says when the 40 songs were not confirmed. */
        const NOT_CONFIRMED =
            "Confirm that the copyright text of 40 songs will change, or keep the labels their authors use as roles.";

        beforeEach(() => {
            getCreditLabelSets.mockReturnValue({ sets: SETS, error: null });
        });

        test("refuses them without a confirmation, on the checkbox, and saves and reads nothing", async () => {
            const state = await saveCreditsAction(formWith(RENAMED));

            expect(state).toEqual({
                status: "error",
                message: FIX_FIELDS,
                fieldErrors: { creditRolesConfirmed: { message: NOT_CONFIRMED } },
                values: RENAMED,
            });
            expect(getCreditLabelSets).toHaveBeenCalledTimes(1);
            expect(saveSettings).not.toHaveBeenCalled();
            expect(rederiveAllCredits).not.toHaveBeenCalled();
            // Settings again, so its notice shows the songs as they are now.
            expect(revalidatePath.mock.calls).toEqual([["/settings"]]);
        });

        test("saves them once exactly those songs are confirmed, then reads the credits again", async () => {
            const state = await saveCreditsAction(formWith({ ...RENAMED, creditRolesConfirmed: "40" }));

            expect(saveSettings).toHaveBeenCalledWith({
                creditRoles: ["Words", "Tune", "Arr.", "Trans."],
                creditPhrases: expect.objectContaining({ Tune: "Music by" }),
            });
            expect(rederiveAllCredits).toHaveBeenCalledTimes(1);
            expect(state).toMatchObject({ status: "success", message: expect.stringMatching(/^Saved\./) });
            expect(revalidatePath.mock.calls).toEqual(CREDIT_PAGES);
        });

        test("refuses a confirmation of another number of songs, saying how many it is now", async () => {
            const state = await saveCreditsAction(formWith({ ...RENAMED, creditRolesConfirmed: "38" }));

            expect(state).toMatchObject({
                status: "error",
                message: FIX_FIELDS,
                fieldErrors: {
                    creditRolesConfirmed: {
                        message:
                            "These roles now change the copyright text of 40 songs, not the 38 you confirmed, since the songs or the saved roles changed. Check which songs, then confirm again.",
                    },
                },
            });
            expect(saveSettings).not.toHaveBeenCalled();
            expect(revalidatePath.mock.calls).toEqual([["/settings"]]);
        });

        test("takes a confirmation that is not a number of songs as none", async () => {
            for (const confirmed of ["", "forty", "40.0", "-40", "0"]) {
                const state = await saveCreditsAction(
                    formWith({ ...RENAMED, creditRolesConfirmed: confirmed })
                );
                expect(state).toMatchObject({
                    fieldErrors: { creditRolesConfirmed: { message: NOT_CONFIRMED } },
                });
            }
            expect(saveSettings).not.toHaveBeenCalled();
        });

        test("counts a song that would lose two labels once", async () => {
            const state = await saveCreditsAction(
                formWith({
                    "creditRole-0": "Words",
                    "creditPhrase-0": "Words by",
                    "creditRole-1": "Tune",
                    "creditPhrase-1": "Music by",
                    creditPairPhrase: "Words and Music by",
                })
            );

            expect(state).toMatchObject({
                fieldErrors: { creditRolesConfirmed: { message: NOT_CONFIRMED } },
            });
        });

        test("saves roles that keep every label without a confirmation, whatever their case, spaces or order", async () => {
            for (const fields of [
                { ...DEFAULT_FIELDS, "creditRole-1": " music " },
                { ...DEFAULT_FIELDS, "creditRole-4": "Desc.", "creditPhrase-4": "" },
                {
                    ...DEFAULT_FIELDS,
                    "creditRole-2": "Trans.",
                    "creditPhrase-2": "Trans. by",
                    "creditRole-3": "Arr.",
                    "creditPhrase-3": "Arr. by",
                },
            ]) {
                await expect(saveCreditsAction(formWith(fields))).resolves.toMatchObject({
                    status: "success",
                });
            }
            expect(saveSettings).toHaveBeenCalledTimes(3);
        });

        test("checks against the songs as the mirror has them when it saves, not as the page showed them", async () => {
            // No song uses "Music" any more (a sync changed them), so the rename changes none.
            getCreditLabelSets.mockReturnValue({ sets: [{ labels: ["Words"], songs: 40 }], error: null });

            await expect(saveCreditsAction(formWith(RENAMED))).resolves.toMatchObject({
                status: "success",
            });
            expect(saveSettings).toHaveBeenCalledTimes(1);
        });

        test("saves nothing when the songs' labels cannot be read, since the change cannot be checked", async () => {
            getCreditLabelSets.mockReturnValue({ sets: [], error: "Could not open the database" });

            await expect(saveCreditsAction(formWith(RENAMED))).resolves.toEqual({
                status: "error",
                message: ROLES_IMPACT_UNCHECKED_MESSAGE,
                fieldErrors: {},
                values: RENAMED,
            });
            expect(saveSettings).not.toHaveBeenCalled();
            expect(rederiveAllCredits).not.toHaveBeenCalled();
            expect(revalidatePath).not.toHaveBeenCalled();
        });

        test("checks no song while a field needs fixing", async () => {
            await saveCreditsAction(formWith({ ...RENAMED, "creditRole-3": "words" }));

            expect(getCreditLabelSets).not.toHaveBeenCalled();
            expect(saveSettings).not.toHaveBeenCalled();
        });
    });
});

describe("saveEmailAction", () => {
    test("saves the recipients as a list and the subject as a template", async () => {
        const state = await saveEmailAction(
            formWith({
                emailRecipients: " pastor@example.org,\r\nmusic@example.org ;  ",
                emailSubjectTemplate: "  Songs for {date} \u00b7 {service} ",
            })
        );

        expect(saveSettings).toHaveBeenCalledWith({
            emailRecipients: ["pastor@example.org", "music@example.org"],
            emailSubjectTemplate: "Songs for {date} \u00b7 {service}",
        });
        expect(state).toEqual({
            status: "success",
            message: "Saved.",
            values: {
                emailRecipients: "pastor@example.org\nmusic@example.org",
                emailSubjectTemplate: "Songs for {date} \u00b7 {service}",
            },
        });
        expect(rederiveAllCredits).not.toHaveBeenCalled();
    });

    test("saves a blank field as no recipients", async () => {
        await saveEmailAction(formWith({ emailRecipients: "  \n", emailSubjectTemplate: "Songs" }));

        expect(saveSettings).toHaveBeenCalledWith({
            emailRecipients: [],
            emailSubjectTemplate: "Songs",
        });
    });

    test("marks the entries that are not addresses, and the subject, at once, and saves nothing", async () => {
        const state = await saveEmailAction(
            formWith({ emailRecipients: "pastor@example.org\nnope", emailSubjectTemplate: "{when}" })
        );

        expect(state).toMatchObject({
            status: "error",
            message: FIX_FIELDS,
            fieldErrors: {
                emailRecipients: {
                    message: '"nope" is not an email address, such as name@example.org.',
                },
                emailSubjectTemplate: {
                    message: expect.stringContaining('"{when}" is not a placeholder'),
                },
            },
            values: { emailRecipients: "pastor@example.org\nnope", emailSubjectTemplate: "{when}" },
        });
        expect(saveSettings).not.toHaveBeenCalled();
        expect(revalidatePath).not.toHaveBeenCalled();
    });
});
