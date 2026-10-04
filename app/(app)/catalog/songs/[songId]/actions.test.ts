import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// vi.hoisted is required: vi.mock is hoisted above const declarations.
const {
    auth,
    revalidatePath,
    saveSongCredits,
    createSongInPlanningCenter,
    listUpcomingPlans,
    addSongToPlan,
    saveSongTags,
} = vi.hoisted(() => ({
    auth: vi.fn(),
    revalidatePath: vi.fn(),
    saveSongCredits: vi.fn(),
    createSongInPlanningCenter: vi.fn(),
    listUpcomingPlans: vi.fn(),
    addSongToPlan: vi.fn(),
    saveSongTags: vi.fn(),
}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/queries/pcoSongs", () => ({
    saveSongCredits,
    createSongInPlanningCenter,
    listUpcomingPlans,
    addSongToPlan,
    saveSongTags,
}));

import type { Credit, PlanSummary } from "@/lib/domain";
import {
    addSongToPlanAction,
    createInPlanningCenterAction,
    listUpcomingPlansAction,
    saveSongCreditsAction,
    saveSongTagsAction,
} from "./actions";

const SESSION = {
    user: { email: "someone@example.com" },
    expires: "2026-11-03T12:00:00.000Z",
};

const PCO_SONG = "26000001";
const SONG = "42";
const ST = "1405391";
const PLAN = "81234567";

const CREDITS: Credit[] = [
    { role: "Words", names: ["Isaac Watts"] },
    { role: "Music", names: ["Lowell Mason", ""] },
];

const NOT_AN_ID = "This page asked for a change that cannot be made. Reload it and try again.";
const UNREADABLE = "This page sent something the server cannot read. Reload it and try again.";

/** Values an action may be sent where an id should be: none of them is one. */
const NOT_IDS: unknown[] = [
    "",
    "abc",
    "0",
    "01",
    "-1",
    "1.5",
    " 1",
    "../1",
    "1/2",
    "12345678901234567890123",
    42,
    null,
    undefined,
    { id: "1" },
    ["1"],
];

const ALL_QUERIES = [saveSongCredits, createSongInPlanningCenter, listUpcomingPlans, addSongToPlan, saveSongTags];

beforeEach(() => {
    for (const mock of [auth, revalidatePath, ...ALL_QUERIES]) {
        mock.mockReset();
    }
    auth.mockResolvedValue(SESSION);
    vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
});

/** A refusal as the queries return them. */
function refusal(message: string, extra: Record<string, unknown> = {}) {
    return { ok: false, reason: "refused", message, details: ["author: is too long"], ...extra };
}

describe("saveSongCreditsAction", () => {
    const SAVED = {
        ok: true,
        changed: true,
        author: "Words: Isaac Watts; Music: Lowell Mason",
        credits: {
            status: "ok",
            credits: [
                { role: "Words", names: ["Isaac Watts"] },
                { role: "Music", names: ["Lowell Mason"] },
            ],
        },
    };

    /** The author the card showed. */
    const SHOWN = "Isaac Watts and Lowell Mason";

    /** The action called with the song's id, the author shown and the credits, any of which `overrides` replaces. */
    function save(overrides: { pcoSongId?: unknown; shownAuthor?: unknown; credits?: unknown } = {}) {
        const args = { pcoSongId: PCO_SONG, shownAuthor: SHOWN, credits: CREDITS, ...overrides };
        // An action's arguments come from the network, so they may be anything.
        return saveSongCreditsAction(
            args.pcoSongId as string,
            args.shownAuthor as string | null,
            args.credits as Credit[]
        );
    }

    test("throws without a session, before it saves anything", async () => {
        auth.mockResolvedValue(null);

        await expect(save()).rejects.toThrow("Not signed in");
        expect(saveSongCredits).not.toHaveBeenCalled();
        expect(revalidatePath).not.toHaveBeenCalled();
    });

    test("saves the credits, then revalidates the catalog's pages and the plans'", async () => {
        saveSongCredits.mockResolvedValue(SAVED);

        await expect(save()).resolves.toEqual({
            ok: true,
            changed: true,
            author: SAVED.author,
            credits: SAVED.credits,
        });
        expect(saveSongCredits).toHaveBeenCalledTimes(1);
        expect(saveSongCredits).toHaveBeenCalledWith(PCO_SONG, SHOWN, CREDITS);
        expect(revalidatePath.mock.calls).toEqual([
            ["/catalog", "layout"],
            ["/plans", "layout"],
        ]);
    });

    test("revalidates when nothing changed too: the mirror now has what Planning Center has", async () => {
        saveSongCredits.mockResolvedValue({ ...SAVED, changed: false });

        await expect(save()).resolves.toMatchObject({ ok: true, changed: false });
        expect(revalidatePath).toHaveBeenCalledTimes(2);
    });

    test("refuses a Planning Center song id that is not one, without saving", async () => {
        for (const value of NOT_IDS) {
            await expect(save({ pcoSongId: value })).resolves.toEqual({ ok: false, message: NOT_AN_ID });
        }
        expect(saveSongCredits).not.toHaveBeenCalled();
    });

    test("passes on a song shown with no author", async () => {
        saveSongCredits.mockResolvedValue(SAVED);

        await save({ shownAuthor: null });
        await save({ shownAuthor: "" });
        expect(saveSongCredits.mock.calls.map(([, shown]) => shown)).toEqual([null, ""]);
    });

    test("refuses an author shown that is not text or none, without saving", async () => {
        for (const value of [undefined, 42, ["Isaac Watts"], { author: "Isaac Watts" }]) {
            await expect(save({ shownAuthor: value })).resolves.toEqual({ ok: false, message: UNREADABLE });
        }
        expect(saveSongCredits).not.toHaveBeenCalled();
    });

    test("gives the author as it is now when it changed since the page loaded, and revalidates the catalog", async () => {
        const current = {
            author: "Words: Isaac Watts; Music: William Croft",
            credits: {
                status: "ok",
                credits: [
                    { role: "Words", names: ["Isaac Watts"] },
                    { role: "Music", names: ["William Croft"] },
                ],
            },
        };
        saveSongCredits.mockResolvedValue({
            ...refusal('The credits of "O God, Our Help" changed in Planning Center since this page loaded, so nothing was saved.'),
            reason: "changed",
            current,
        });

        await expect(save()).resolves.toEqual({
            ok: false,
            message: 'The credits of "O God, Our Help" changed in Planning Center since this page loaded, so nothing was saved.',
            current,
        });
        // The mirror took the song as it is now: the song's page shows it.
        expect(revalidatePath.mock.calls).toEqual([["/catalog", "layout"]]);
    });

    test("refuses credits that are not a list of roles with names, without saving", async () => {
        for (const value of [null, undefined, "Words: A", [{ role: "Words" }], [{ role: "Words", names: [1] }]]) {
            await expect(save({ credits: value })).resolves.toEqual({ ok: false, message: UNREADABLE });
        }
        expect(saveSongCredits).not.toHaveBeenCalled();
    });

    test("gives a refusal's message, and revalidates nothing", async () => {
        saveSongCredits.mockResolvedValue(refusal('Planning Center refused the credits of "X": author: is too long'));

        await expect(save()).resolves.toEqual({
            ok: false,
            message: 'Planning Center refused the credits of "X": author: is too long',
        });
        expect(revalidatePath).not.toHaveBeenCalled();
    });

    test("logs a failure and says the credits may or may not be saved", async () => {
        const error = new Error("PCO 500");
        saveSongCredits.mockRejectedValue(error);

        const state = await save();
        expect(state).toEqual({ ok: false, message: expect.stringMatching(/may or may not have been saved/) });
        expect(console.error).toHaveBeenCalledWith(
            `Failed to save the credits of Planning Center song ${PCO_SONG}:`,
            error
        );
        expect(revalidatePath).not.toHaveBeenCalled();
    });
});

describe("createInPlanningCenterAction", () => {
    const FORM = {
        title: "Abba, Father (PRITCHARD)",
        credits: CREDITS,
        copyright: "",
        ccliNumber: " 22025 ",
        useCcliDetails: false,
    };
    const CREATED = {
        ok: true,
        song: {
            id: "26000099",
            title: "Abba, Father (PRITCHARD)",
            author: "Words: Isaac Watts; Music: Lowell Mason",
            copyright: null,
            ccliNumber: 22025,
            admin: null,
            themes: null,
            hidden: false,
            lastScheduledAt: null,
            createdAt: "2026-10-04T12:00:00Z",
            updatedAt: "2026-10-04T12:00:00Z",
        },
        linked: true,
        warnings: [],
    };

    /** The action called with the song's id and the form, either of which `overrides` replaces. */
    function create(overrides: { songId?: unknown; form?: unknown } = {}) {
        const args = { songId: SONG, form: FORM, ...overrides };
        return createInPlanningCenterAction(args.songId as string, args.form as typeof FORM);
    }

    test("throws without a session, before it creates anything", async () => {
        auth.mockResolvedValue(null);

        await expect(create()).rejects.toThrow("Not signed in");
        expect(createSongInPlanningCenter).not.toHaveBeenCalled();
    });

    test("creates the song with the CCLI number read, then revalidates the catalog, the plans and the dashboard", async () => {
        createSongInPlanningCenter.mockResolvedValue(CREATED);

        await expect(create()).resolves.toEqual({
            ok: true,
            pcoSongId: "26000099",
            title: "Abba, Father (PRITCHARD)",
            linked: true,
            warnings: [],
        });
        expect(createSongInPlanningCenter).toHaveBeenCalledWith(42, {
            title: FORM.title,
            credits: CREDITS,
            copyright: "",
            ccliNumber: 22025,
            useCcliDetails: false,
        });
        expect(revalidatePath.mock.calls).toEqual([
            ["/catalog", "layout"],
            ["/plans", "layout"],
            ["/"],
        ]);
    });

    test("sends no CCLI number for a blank field", async () => {
        createSongInPlanningCenter.mockResolvedValue(CREATED);

        await create({ form: { ...FORM, ccliNumber: "  ", useCcliDetails: true } });
        expect(createSongInPlanningCenter).toHaveBeenCalledWith(
            42,
            expect.objectContaining({ ccliNumber: null, useCcliDetails: true })
        );
    });

    test("gives the warnings of a song created but not linked, and still revalidates", async () => {
        const warnings = ["The song was created in Planning Center, but not linked: taken."];
        createSongInPlanningCenter.mockResolvedValue({ ...CREATED, linked: false, warnings });

        await expect(create()).resolves.toMatchObject({ ok: true, linked: false, warnings });
        expect(revalidatePath).toHaveBeenCalledTimes(3);
    });

    test("refuses a catalog song id that is not one, without creating anything", async () => {
        for (const value of NOT_IDS) {
            await expect(create({ songId: value })).resolves.toEqual({ ok: false, message: NOT_AN_ID });
        }
        expect(createSongInPlanningCenter).not.toHaveBeenCalled();
    });

    test("refuses a form that is not the form's shape", async () => {
        for (const value of [
            null,
            undefined,
            "form",
            { ...FORM, title: 1 },
            { ...FORM, useCcliDetails: "no" },
            { ...FORM, credits: [1] },
        ]) {
            await expect(create({ form: value })).resolves.toEqual({ ok: false, message: UNREADABLE });
        }
        expect(createSongInPlanningCenter).not.toHaveBeenCalled();
    });

    test("refuses a CCLI number that is not one on its field, without creating anything", async () => {
        await expect(create({ form: { ...FORM, ccliNumber: "22,025" } })).resolves.toEqual({
            ok: false,
            message: "A CCLI song number is a whole number, such as 22025.",
            field: "ccliNumber",
        });
        expect(createSongInPlanningCenter).not.toHaveBeenCalled();
    });

    test("gives a refusal's message, and its field when it has one", async () => {
        createSongInPlanningCenter.mockResolvedValue({
            ok: false,
            reason: "invalid",
            message: "Enter the song's title.",
            field: "title",
        });
        await expect(create()).resolves.toEqual({
            ok: false,
            message: "Enter the song's title.",
            field: "title",
        });

        createSongInPlanningCenter.mockResolvedValue(
            refusal('"Abba, Father (PRITCHARD)" is linked to a Planning Center song already, so it is not created again.')
        );
        await expect(create()).resolves.toEqual({
            ok: false,
            message: '"Abba, Father (PRITCHARD)" is linked to a Planning Center song already, so it is not created again.',
        });
        expect(revalidatePath).not.toHaveBeenCalled();
    });

    test("logs a failure and warns against creating the song twice", async () => {
        const error = new Error("timeout");
        createSongInPlanningCenter.mockRejectedValue(error);

        await expect(create()).resolves.toEqual({
            ok: false,
            message: expect.stringMatching(/not known whether the song was created.*not created twice/),
        });
        expect(console.error).toHaveBeenCalledWith(
            "Failed to create catalog song 42 in Planning Center:",
            error
        );
        expect(revalidatePath).not.toHaveBeenCalled();
    });
});

describe("listUpcomingPlansAction", () => {
    const PLAN_SUMMARY: PlanSummary = {
        id: PLAN,
        serviceTypeId: ST,
        title: "Communion Sunday",
        dates: "October 11, 2026",
        shortDates: "Oct 11",
        sortDate: "2026-10-11T08:00:00Z",
        itemsCount: 12,
        planningCenterUrl: `https://services.planningcenteronline.com/plans/${PLAN}`,
        createdAt: "2026-09-01T12:00:00Z",
        updatedAt: "2026-10-02T15:00:00Z",
        serviceType: { id: ST, name: "Sunday Morning" },
    };

    test("throws without a session, before it reads anything", async () => {
        auth.mockResolvedValue(null);

        await expect(listUpcomingPlansAction()).rejects.toThrow("Not signed in");
        expect(listUpcomingPlans).not.toHaveBeenCalled();
    });

    test("gives the upcoming plans as the picker shows them, and how many service types were not read", async () => {
        listUpcomingPlans.mockResolvedValue({ plans: [PLAN_SUMMARY], failedServiceTypeIds: ["1486055"] });

        await expect(listUpcomingPlansAction()).resolves.toEqual({
            ok: true,
            plans: [
                {
                    serviceTypeId: ST,
                    planId: PLAN,
                    label: "October 11, 2026 · Sunday Morning",
                    title: "Communion Sunday",
                },
            ],
            unreadServiceTypes: 1,
        });
        expect(revalidatePath).not.toHaveBeenCalled();
    });

    test("logs a failure and says the plans could not be read", async () => {
        const error = new Error("PCO down");
        listUpcomingPlans.mockRejectedValue(error);

        await expect(listUpcomingPlansAction()).resolves.toEqual({
            ok: false,
            message: expect.stringMatching(/could not be read from Planning Center/),
        });
        expect(console.error).toHaveBeenCalledWith("Failed to read the upcoming plans:", error);
    });
});

describe("addSongToPlanAction", () => {
    const ADDED = {
        ok: true,
        item: { id: "91000099", title: "Amazing Grace", itemType: "song", sequence: 12 },
        plan: { id: PLAN, dates: "October 11, 2026" },
        arrangement: { id: "3001", name: "Default Arrangement", archived: false, createdAt: null },
    };

    function add(
        overrides: Partial<Record<"serviceTypeId" | "planId" | "pcoSongId", unknown>> = {}
    ) {
        const ids = { serviceTypeId: ST, planId: PLAN, pcoSongId: PCO_SONG, ...overrides };
        return addSongToPlanAction(ids.serviceTypeId as string, ids.planId as string, ids.pcoSongId as string);
    }

    test("throws without a session, before it adds anything", async () => {
        auth.mockResolvedValue(null);

        await expect(add()).rejects.toThrow("Not signed in");
        expect(addSongToPlan).not.toHaveBeenCalled();
    });

    test("adds the song, then revalidates the plan, the dashboard and the catalog", async () => {
        addSongToPlan.mockResolvedValue(ADDED);

        await expect(add()).resolves.toEqual({
            ok: true,
            itemId: "91000099",
            title: "Amazing Grace",
            arrangement: "Default Arrangement",
        });
        expect(addSongToPlan).toHaveBeenCalledWith(ST, PLAN, PCO_SONG);
        expect(revalidatePath.mock.calls).toEqual([
            [`/plans/${ST}/${PLAN}`, "layout"],
            ["/"],
            ["/catalog", "layout"],
        ]);
    });

    test.each([
        ["service type", "serviceTypeId"],
        ["plan", "planId"],
        ["Planning Center song", "pcoSongId"],
    ] as const)("refuses a %s id that is not one, without adding anything", async (_name, field) => {
        for (const value of NOT_IDS) {
            await expect(add({ [field]: value })).resolves.toEqual({ ok: false, message: NOT_AN_ID });
        }
        expect(addSongToPlan).not.toHaveBeenCalled();
    });

    test("gives a refusal's message, and revalidates nothing", async () => {
        addSongToPlan.mockResolvedValue({
            ok: false,
            reason: "no-arrangement",
            message: '"Amazing Grace" has no arrangement in Planning Center to put in a plan.',
        });

        await expect(add()).resolves.toEqual({
            ok: false,
            message: '"Amazing Grace" has no arrangement in Planning Center to put in a plan.',
        });
        expect(revalidatePath).not.toHaveBeenCalled();
    });

    test("logs a failure and says to look at the plan before trying again", async () => {
        const error = new Error("timeout");
        addSongToPlan.mockRejectedValue(error);

        await expect(add()).resolves.toEqual({
            ok: false,
            message: expect.stringMatching(/not known whether the song was added.*before trying again/),
        });
        expect(console.error).toHaveBeenCalledWith(
            `Failed to add Planning Center song ${PCO_SONG} to plan ${ST}/${PLAN}:`,
            error
        );
        expect(revalidatePath).not.toHaveBeenCalled();
    });
});

describe("saveSongTagsAction", () => {
    const SAVED = { ok: true, changed: true, tagIds: ["102", "900"], kept: [{ id: "900", name: "Fast", groupId: null }] };

    /** The action called with the song's id, the tags shown and those wanted, any of which `overrides` replaces. */
    function save(overrides: { pcoSongId?: unknown; shown?: unknown; wanted?: unknown } = {}) {
        const args = { pcoSongId: PCO_SONG, shown: ["101"], wanted: ["102"], ...overrides };
        return saveSongTagsAction(args.pcoSongId as string, args.shown as string[], args.wanted as string[]);
    }

    test("throws without a session, before it saves anything", async () => {
        auth.mockResolvedValue(null);

        await expect(save()).rejects.toThrow("Not signed in");
        expect(saveSongTags).not.toHaveBeenCalled();
    });

    test("saves the tags, then revalidates the catalog's pages", async () => {
        saveSongTags.mockResolvedValue(SAVED);

        await expect(save()).resolves.toEqual({
            ok: true,
            changed: true,
            tagIds: ["102", "900"],
            kept: [{ id: "900", name: "Fast" }],
        });
        expect(saveSongTags).toHaveBeenCalledWith(PCO_SONG, ["101"], ["102"]);
        expect(revalidatePath.mock.calls).toEqual([["/catalog", "layout"]]);
    });

    test("passes on empty sets: a song shown with no tags, or none wanted", async () => {
        saveSongTags.mockResolvedValue({ ok: true, changed: true, tagIds: [], kept: [] });

        await expect(save({ wanted: [] })).resolves.toMatchObject({ ok: true, tagIds: [] });
        await save({ shown: [], wanted: ["102"] });
        expect(saveSongTags.mock.calls).toEqual([
            [PCO_SONG, ["101"], []],
            [PCO_SONG, [], ["102"]],
        ]);
    });

    test("says when the tags changed in Planning Center since the page showed them, and revalidates nothing", async () => {
        saveSongTags.mockResolvedValue({
            ok: false,
            reason: "changed",
            message: '"Season" takes one tag, and "X" has another of its tags in Planning Center now.',
        });

        await expect(save()).resolves.toEqual({
            ok: false,
            message: '"Season" takes one tag, and "X" has another of its tags in Planning Center now.',
            changedSinceShown: true,
        });
        expect(revalidatePath).not.toHaveBeenCalled();
    });

    test("refuses a song id or a tag id that is not one, without saving", async () => {
        for (const value of NOT_IDS) {
            await expect(save({ pcoSongId: value })).resolves.toEqual({ ok: false, message: NOT_AN_ID });
        }
        for (const value of ["", "abc", "0", "1.5", "../1"]) {
            await expect(save({ wanted: ["102", value] })).resolves.toEqual({ ok: false, message: NOT_AN_ID });
            await expect(save({ shown: [value] })).resolves.toEqual({ ok: false, message: NOT_AN_ID });
        }
        expect(saveSongTags).not.toHaveBeenCalled();
    });

    test("refuses tag ids that are not a list of texts", async () => {
        for (const value of [null, undefined, "102", [102], [null]]) {
            await expect(save({ wanted: value })).resolves.toEqual({ ok: false, message: UNREADABLE });
            await expect(save({ shown: value })).resolves.toEqual({ ok: false, message: UNREADABLE });
        }
        expect(saveSongTags).not.toHaveBeenCalled();
    });

    test("gives a refusal's message, and revalidates nothing", async () => {
        saveSongTags.mockResolvedValue({
            ok: false,
            reason: "invalid",
            message: 'Choose one tag at most of "Season".',
        });

        await expect(save()).resolves.toEqual({ ok: false, message: 'Choose one tag at most of "Season".' });
        expect(revalidatePath).not.toHaveBeenCalled();
    });

    test("logs a failure and says the tags may or may not be saved", async () => {
        const error = new Error("PCO 500");
        saveSongTags.mockRejectedValue(error);

        await expect(save()).resolves.toEqual({
            ok: false,
            message: expect.stringMatching(/may or may not have been saved/),
        });
        expect(console.error).toHaveBeenCalledWith(
            `Failed to save the tags of Planning Center song ${PCO_SONG}:`,
            error
        );
        expect(revalidatePath).not.toHaveBeenCalled();
    });
});
