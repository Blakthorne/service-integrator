import type { Metadata } from "next";
import { Suspense } from "react";
import PlansList from "@/app/components/Plans/PlansList";
import EmptyState from "@/app/components/ui/EmptyState";
import LoadingState from "@/app/components/ui/LoadingState";
import PageHeader from "@/app/components/ui/PageHeader";
import { getPlansByDate } from "@/lib/queries/plans";

export const metadata: Metadata = {
    title: "Plans",
};

/**
 * The plans list, the app's home. The server loads every service type's
 * plans; PlansList pages through them in the browser. When a service type
 * fails to load, the others are still listed, with a note that the list may
 * be incomplete.
 */
export default async function PlansPage() {
    const { dates, plansByDate, failedServiceTypeIds } = await getPlansByDate();

    return (
        <div className="font-sans">
            <PageHeader
                title="Plans"
                description="Integrates with Planning Center's public Services API to aggregate data and generate copyright information for songs"
            />
            <div className="w-full max-w-4xl mx-auto">
                {failedServiceTypeIds.length > 0 && (
                    <p className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
                        Some service types couldn&apos;t be loaded from Planning
                        Center, so this list may be incomplete.
                    </p>
                )}
                {dates.length === 0 ? (
                    <EmptyState title="No plans found" />
                ) : (
                    // PlansList reads ?page=, which needs a Suspense boundary.
                    <Suspense fallback={<LoadingState label="Loading plans…" />}>
                        <PlansList dates={dates} plansByDate={plansByDate} />
                    </Suspense>
                )}
            </div>
        </div>
    );
}
