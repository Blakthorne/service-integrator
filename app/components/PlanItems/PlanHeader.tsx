"use client";

import PageHeader from "../ui/PageHeader";
import { planLabel } from "@/lib/planLabel";
import { pcoWebUrls, routes } from "@/lib/routes";
import EmailSummaryAction from "./EmailSummaryAction";
import { usePlan } from "./PlanProvider";
import SyncHymnNotesAction from "./SyncHymnNotesAction";
import ViewInPlanningCenterLink from "./ViewInPlanningCenterLink";

/**
 * The plan page's header: breadcrumbs back to the plans, the plan's date and
 * service type as the title, "Sync hymn notes" (which previews and writes
 * the songs' hymnal notes in Planning Center), "Email this plan" (which
 * previews and sends the plan's schedule and copyright text to the staff),
 * and a link to the plan in Planning Center. The actions stand one above
 * the other, full width on phones and as wide as the widest one beside the
 * title, which side by side would squeeze the title off center.
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
                <div className="flex flex-col gap-2">
                    <SyncHymnNotesAction serviceTypeId={serviceType.id} planId={plan.id} />
                    <EmailSummaryAction serviceTypeId={serviceType.id} planId={plan.id} />
                    <ViewInPlanningCenterLink href={pcoWebUrls.plan(plan.id)} />
                </div>
            }
        />
    );
}
