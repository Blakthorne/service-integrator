"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import EmptyState from "@/app/components/ui/EmptyState";
import { routes } from "@/lib/routes";

/**
 * Shown when the item page calls notFound() for an item ID that is not a PCO
 * ID. It renders inside the plan's layout, with a link back to the plan.
 */
export default function PlanItemNotFound() {
    // The [planId] layout above has already checked both IDs with parsePcoId.
    const { serviceTypeId, planId } = useParams<{
        serviceTypeId: string;
        planId: string;
    }>();

    return (
        <EmptyState
            title="Item not found"
            description="This plan has no item at this address."
            action={
                <Link
                    href={routes.plan(serviceTypeId, planId)}
                    className="text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300"
                >
                    Back to the plan
                </Link>
            }
        />
    );
}
