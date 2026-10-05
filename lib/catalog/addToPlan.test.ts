import { describe, expect, test } from "vitest";
import type { PlanSummary } from "@/lib/domain";
import {
    ADD_TO_PLAN_NO_ANSWER,
    NO_UPCOMING_PLANS,
    UPCOMING_PLANS_NO_ANSWER,
    confirmAddToPlanQuestion,
    describeAddToPlanWrite,
    describeAddedToPlan,
    describeUnreadServiceTypes,
    planOptionKey,
    upcomingPlanOptions,
} from "./addToPlan";

function plan(
    id: string,
    serviceType: { id: string; name: string },
    dates: string,
    title: string | null = null
): PlanSummary {
    return {
        id,
        serviceTypeId: serviceType.id,
        title,
        dates,
        shortDates: dates,
        sortDate: "2026-10-11T08:00:00Z",
        itemsCount: 12,
        planningCenterUrl: `https://services.planningcenteronline.com/plans/${id}`,
        createdAt: "2026-09-01T12:00:00Z",
        updatedAt: "2026-10-02T15:00:00Z",
        serviceType,
    };
}

const AM = { id: "1405391", name: "Sunday Morning" };
const PM = { id: "1486055", name: "Sunday Evening" };

describe("upcomingPlanOptions", () => {
    test("labels each plan with its date and service type, in the order given", () => {
        expect(
            upcomingPlanOptions([
                plan("81234567", AM, "October 11, 2026", "Communion Sunday"),
                plan("81234568", PM, "October 11, 2026"),
            ])
        ).toEqual([
            {
                serviceTypeId: "1405391",
                planId: "81234567",
                label: "October 11, 2026 · Sunday Morning",
                title: "Communion Sunday",
            },
            {
                serviceTypeId: "1486055",
                planId: "81234568",
                label: "October 11, 2026 · Sunday Evening",
                title: null,
            },
        ]);
    });

    test("gives a blank title as none", () => {
        expect(upcomingPlanOptions([plan("1", AM, "October 11, 2026", "  ")])[0].title).toBeNull();
    });

    test("gives none for no plans", () => {
        expect(upcomingPlanOptions([])).toEqual([]);
    });
});

describe("planOptionKey", () => {
    test("is unique per service type and plan", () => {
        expect(planOptionKey({ serviceTypeId: "1405391", planId: "81234567" })).toBe("1405391/81234567");
        expect(planOptionKey({ serviceTypeId: "1", planId: "23" })).not.toBe(
            planOptionKey({ serviceTypeId: "12", planId: "3" })
        );
    });
});

describe("the dialog's words", () => {
    test("says which service types could not be read, or nothing", () => {
        expect(describeUnreadServiceTypes(0)).toBeNull();
        expect(describeUnreadServiceTypes(1)).toBe(
            "The plans of 1 service type could not be read from Planning Center, so they are not listed."
        );
        expect(describeUnreadServiceTypes(2)).toBe(
            "The plans of 2 service types could not be read from Planning Center, so they are not listed."
        );
    });

    test("names the song and the plan in the confirmation", () => {
        expect(
            confirmAddToPlanQuestion("Amazing Grace (NEW BRITAIN)", {
                label: "October 11, 2026 · Sunday Morning",
            })
        ).toBe('Add "Amazing Grace (NEW BRITAIN)" to October 11, 2026 · Sunday Morning?');
        expect(describeAddToPlanWrite("Amazing Grace")).toBe(
            'It goes at the end of the plan, as "Amazing Grace" with the song\'s default arrangement. The app cannot take it out again: that is done in Planning Center.'
        );
    });

    test("says what was added, where and how", () => {
        expect(
            describeAddedToPlan({
                title: "Amazing Grace",
                plan: { label: "October 11, 2026 · Sunday Morning" },
                arrangement: "Default Arrangement",
            })
        ).toBe(
            'Added "Amazing Grace" to the end of October 11, 2026 · Sunday Morning, with the arrangement "Default Arrangement".'
        );
    });

    test("tells a person to look before trying again when the add never answered", () => {
        expect(ADD_TO_PLAN_NO_ANSWER).toMatch(/not known whether the song was added/);
        expect(UPCOMING_PLANS_NO_ANSWER).toMatch(/could not be read/);
        expect(NO_UPCOMING_PLANS).toMatch(/no upcoming plans/);
    });
});
