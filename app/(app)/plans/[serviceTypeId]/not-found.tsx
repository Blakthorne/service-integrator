import Link from "next/link";
import EmptyState from "@/app/components/ui/EmptyState";
import { routes } from "@/lib/routes";

/**
 * Shown when the `[planId]` layout calls notFound(): an ID that is not a PCO
 * ID, or a plan that PCO does not have. It sits one level up because a
 * segment's own not-found.tsx does not cover its own layout.
 */
export default function PlanNotFound() {
    return (
        <div className="font-sans">
            <EmptyState
                title="Plan not found"
                description="This plan does not exist, or it may have been deleted in Planning Center."
                action={
                    <Link
                        href={routes.plans()}
                        className="text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300"
                    >
                        Back to Plans
                    </Link>
                }
            />
        </div>
    );
}
