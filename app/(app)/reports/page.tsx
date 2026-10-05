import type { Metadata } from "next";
import { Suspense } from "react";
import CatalogCard from "@/app/components/Catalog/CatalogCard";
import ReportsView from "@/app/components/Reports/ReportsView";
import HistorySyncDetails from "@/app/components/Settings/HistorySyncDetails";
import EmptyState from "@/app/components/ui/EmptyState";
import LoadingState from "@/app/components/ui/LoadingState";
import PageHeader from "@/app/components/ui/PageHeader";
import { getReports } from "@/lib/queries/reports";
import { getSettings } from "@/lib/queries/settings";
import { toReportData } from "@/lib/reportsView";

export const metadata: Metadata = { title: "Reports" };

/**
 * The reports of what the church sang: the most sung songs of a period,
 * when each catalog song was last sung, and the songs not sung since a date.
 * They are built from the plan history, the app's copy of which songs each
 * Planning Center plan held, which this page reads from the local database
 * only (`getReports`); "Sync history now" brings it up to date. "Sung" means
 * in a plan dated before today. The server reads everything once and sends
 * the rows with their numbers; the view picks the report, the period and
 * the date in the browser, from the URL.
 *
 * It has no history to report until the first sync, and says so with the
 * button that runs it. A history that cannot be read ends in
 * `app/(app)/error.tsx`, as the catalog's pages do.
 */
export default function ReportsPage() {
    const reports = getReports();
    const { settings } = getSettings();

    return (
        <div className="w-full max-w-4xl mx-auto">
            <PageHeader
                title="Reports"
                description="Which songs the church sang, from the plans in Planning Center: the most sung, when each was last sung, and the songs not sung for a while."
            />
            <div className="space-y-6">
                <CatalogCard title="Plan history" headingId="plan-history-heading">
                    <p className="mb-4 text-sm text-gray-600 dark:text-gray-300">
                        The app keeps a copy of which songs each plan held, read from Planning
                        Center once a day. A song counts as sung in a plan dated before today;
                        one in a later plan is only scheduled.
                    </p>
                    <HistorySyncDetails lastRun={reports.lastRun} counts={reports.history} />
                </CatalogCard>
                {reports.history.plans === 0 ? (
                    <EmptyState
                        title="No history to report yet"
                        description="Sync the history, above, to read the plans from Planning Center."
                    />
                ) : (
                    // The view reads the query string, which needs a Suspense boundary.
                    <Suspense fallback={<LoadingState label="Loading reports…" />}>
                        <ReportsView data={toReportData(reports, settings.numberSeparator)} />
                    </Suspense>
                )}
            </div>
        </div>
    );
}
