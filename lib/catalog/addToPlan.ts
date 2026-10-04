import type { PlanSummary } from "@/lib/domain";
import { planLabel } from "@/lib/planLabel";
import { countOf } from "./counts";

/**
 * "Add to a plan" on the page of a song linked to Planning Center: the
 * upcoming plans it offers, and what it says at each step. Pure and safe on
 * both sides.
 */

/** An upcoming plan as the picker offers it. */
export interface UpcomingPlanOption {
    serviceTypeId: string;
    planId: string;
    /** "October 11, 2026 · Sunday Morning" (`planLabel`). */
    label: string;
    /** The plan's own title, such as "Communion Sunday"; null when it has none. */
    title: string | null;
}

/**
 * The picker's options for `plans` (as `listUpcomingPlans` gives them,
 * earliest first), in the same order: each with its label and its own
 * title, and nothing else the browser does not need.
 */
export function upcomingPlanOptions(plans: readonly PlanSummary[]): UpcomingPlanOption[] {
    return plans.map((plan) => ({
        serviceTypeId: plan.serviceType.id,
        planId: plan.id,
        label: planLabel(plan, plan.serviceType),
        title: plan.title?.trim() || null,
    }));
}

/** A key for an option, unique among the options: its service type's id and its own. */
export function planOptionKey({
    serviceTypeId,
    planId,
}: Pick<UpcomingPlanOption, "serviceTypeId" | "planId">): string {
    return `${serviceTypeId}/${planId}`;
}

/** What the picker says when Planning Center lists no upcoming plan. */
export const NO_UPCOMING_PLANS =
    "Planning Center has no upcoming plans to add the song to. Plans are made in Planning Center.";

/** What the picker says about service types whose plans could not be read; null when there are none. */
export function describeUnreadServiceTypes(count: number): string | null {
    return count === 0
        ? null
        : `The plans of ${countOf(count, "service type")} could not be read from Planning Center, so they are not listed.`;
}

/** The confirmation's question, naming the song and the plan. */
export function confirmAddToPlanQuestion(songLabel: string, plan: Pick<UpcomingPlanOption, "label">): string {
    return `Add "${songLabel}" to ${plan.label}?`;
}

/**
 * What the confirmation says the write does: where the item goes, what it
 * is called, and that the app cannot undo it.
 */
export function describeAddToPlanWrite(pcoTitle: string): string {
    return `It goes at the end of the plan, as "${pcoTitle}" with the song's default arrangement. The app cannot take it out again: that is done in Planning Center.`;
}

/** What the dialog says once the song is in the plan. */
export function describeAddedToPlan({
    title,
    plan,
    arrangement,
}: {
    /** The item's title, the song's title in Planning Center. */
    title: string;
    plan: Pick<UpcomingPlanOption, "label">;
    /** The arrangement's name. */
    arrangement: string;
}): string {
    return `Added "${title}" to the end of ${plan.label}, with the arrangement "${arrangement}".`;
}

/** What the dialog says when the action reading the plans never answered (the network, an ended session). */
export const UPCOMING_PLANS_NO_ANSWER =
    "The server did not answer, so the upcoming plans could not be read. Try again, or reload the page.";

/**
 * What the dialog says when the action adding the song never answered.
 * Planning Center may have added it, so it says to look before trying again.
 */
export const ADD_TO_PLAN_NO_ANSWER =
    "The server did not answer, so it is not known whether the song was added. Look at the plan in Planning Center before trying again.";
