import type { Metadata } from "next";
import { notFound } from "next/navigation";
import PlanProvider from "@/app/components/PlanItems/PlanProvider";
import { orNotFound, parsePcoId } from "@/lib/pco";
import { getPlanDetail, getPlanLabels } from "@/lib/queries/plans";

/**
 * The tab title: the plan's label on its own, and "<page> · <label> · Service
 * Integrator" for the pages below, which only give the leading part
 * ("Schedule", an item's title). `getPlanLabels` is cached and never throws.
 */
export async function generateMetadata({
    params,
}: Pick<
    LayoutProps<"/plans/[serviceTypeId]/[planId]">,
    "params"
>): Promise<Metadata> {
    const { serviceTypeId, planId } = await params;
    const labels = await getPlanLabels(serviceTypeId, planId);
    return {
        title: {
            default: labels.plan,
            template: `%s · ${labels.plan} · Service Integrator`,
        },
    };
}

/**
 * Loads the plan once for all of its pages: the Copyright and Schedule tabs
 * and the item pages share it through PlanProvider, and moving between them
 * does not run this layout again. A bad ID or a plan PCO does not have ends
 * in `[serviceTypeId]/not-found.tsx`, and other failures in
 * `[serviceTypeId]/error.tsx`.
 */
export default async function PlanLayout({
    params,
    children,
}: LayoutProps<"/plans/[serviceTypeId]/[planId]">) {
    const raw = await params;
    const serviceTypeId = parsePcoId(raw.serviceTypeId) ?? notFound();
    const planId = parsePcoId(raw.planId) ?? notFound();
    const detail = await orNotFound(getPlanDetail(serviceTypeId, planId));

    return (
        <div className="font-sans w-full max-w-4xl mx-auto">
            <PlanProvider key={`${serviceTypeId}/${planId}`} detail={detail}>
                {children}
            </PlanProvider>
        </div>
    );
}
