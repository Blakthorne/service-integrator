"use client";

import Link from "next/link";
import EmptyState from "../ui/EmptyState";
import PageHeader from "../ui/PageHeader";
import SongDetails from "../SongDetails";
import { planLabel } from "@/lib/planLabel";
import { pcoWebUrls, routes } from "@/lib/routes";
import { usePlan } from "./PlanProvider";
import ViewInPlanningCenterLink from "./ViewInPlanningCenterLink";

interface PlanItemDetailProps {
    /** The item to show: a valid PCO ID, though not necessarily in this plan. */
    itemId: string;
}

/**
 * An item's page: breadcrumbs back to the plan, the item's title, a link to
 * its song in Planning Center, and the song's details. The item comes from
 * the plan already loaded by the `[planId]` layout. An ID that is not one of
 * the plan's items gets an inline message (client code never calls
 * notFound()).
 */
export default function PlanItemDetail({ itemId }: PlanItemDetailProps) {
    const { plan, serviceType, items } = usePlan();
    const item = items.find((candidate) => candidate.id === itemId);
    const label = planLabel(plan, serviceType);
    const planHref = routes.plan(serviceType.id, plan.id);

    if (!item) {
        return (
            <EmptyState
                title="This item isn't in this plan"
                description="It may have been removed from the plan in Planning Center."
                action={
                    <Link
                        href={planHref}
                        className="text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300"
                    >
                        Back to {label}
                    </Link>
                }
            />
        );
    }

    return (
        <>
            <PageHeader
                title={item.title}
                breadcrumbs={[
                    { label: "Plans", href: routes.plans() },
                    { label, href: planHref },
                    { label: item.title },
                ]}
                actions={
                    item.song && (
                        <ViewInPlanningCenterLink
                            href={pcoWebUrls.song(item.song.id)}
                        />
                    )
                }
            />
            <SongDetails item={item} />
        </>
    );
}
