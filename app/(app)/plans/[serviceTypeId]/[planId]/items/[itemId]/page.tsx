import type { Metadata } from "next";
import { notFound } from "next/navigation";
import PlanItemDetail from "@/app/components/PlanItems/PlanItemDetail";
import { parsePcoId } from "@/lib/pco";
import { getPlanLabels } from "@/lib/queries/plans";

type PlanItemPageProps =
    PageProps<"/plans/[serviceTypeId]/[planId]/items/[itemId]">;

/**
 * The item's title, which the `[planId]` layout's template turns into
 * "<item> · <plan label> · Service Integrator". The label lookup is cached and
 * never throws.
 */
export async function generateMetadata({
    params,
}: Pick<PlanItemPageProps, "params">): Promise<Metadata> {
    const { serviceTypeId, planId, itemId } = await params;
    // Only a PCO ID is looked up: another key could hit an Object.prototype
    // property such as "constructor".
    if (parsePcoId(itemId) === null) {
        return { title: "Item" };
    }
    const labels = await getPlanLabels(serviceTypeId, planId);
    return { title: labels.items[itemId] || "Item" };
}

/**
 * A plan item's page. The plan comes from the `[planId]` layout's
 * PlanProvider, so this server page only checks the item ID; an ID that is not
 * a PCO ID ends in `not-found.tsx` next to it.
 */
export default async function PlanItemPage({ params }: PlanItemPageProps) {
    const { itemId } = await params;
    if (!parsePcoId(itemId)) {
        notFound();
    }
    return <PlanItemDetail itemId={itemId} />;
}
