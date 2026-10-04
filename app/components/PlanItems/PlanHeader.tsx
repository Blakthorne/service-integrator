"use client";

import PageHeader from "../ui/PageHeader";
import { planLabel } from "@/lib/planLabel";
import { pcoWebUrls, routes } from "@/lib/routes";
import { usePlan } from "./PlanProvider";
import ViewInPlanningCenterLink from "./ViewInPlanningCenterLink";

/**
 * The plan page's header: breadcrumbs back to the plans, the plan's date and
 * service type as the title, and a link to the plan in Planning Center.
 */
export default function PlanHeader() {
    const { plan, serviceType } = usePlan();
    const label = planLabel(plan, serviceType);

    return (
        <PageHeader
            title={label}
            breadcrumbs={[
                { label: "Plans", href: routes.plans() },
                { label },
            ]}
            actions={
                <ViewInPlanningCenterLink href={pcoWebUrls.plan(plan.id)} />
            }
        />
    );
}
