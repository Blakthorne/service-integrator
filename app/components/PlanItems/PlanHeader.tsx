"use client";

import PageHeader from "../ui/PageHeader";
import type { Plan, ServiceType } from "@/lib/domain";
import { pcoWebUrls, routes } from "@/lib/routes";
import { usePlan } from "./PlanProvider";
import ViewInPlanningCenterLink from "./ViewInPlanningCenterLink";

/** A plan's heading, e.g. "October 4, 2026 · Sunday Morning". */
export function planHeading(
    plan: Pick<Plan, "dates">,
    serviceType: Pick<ServiceType, "name">
): string {
    return `${plan.dates} · ${serviceType.name}`;
}

/**
 * The plan page's header: breadcrumbs back to the plans, the plan's date and
 * service type as the title, and a link to the plan in Planning Center.
 */
export default function PlanHeader() {
    const { plan, serviceType } = usePlan();
    const heading = planHeading(plan, serviceType);

    return (
        <PageHeader
            title={heading}
            breadcrumbs={[
                { label: "Plans", href: routes.plans() },
                { label: heading },
            ]}
            actions={
                <ViewInPlanningCenterLink href={pcoWebUrls.plan(plan.id)} />
            }
        />
    );
}
