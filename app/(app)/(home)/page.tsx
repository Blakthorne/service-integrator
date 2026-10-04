import type { Metadata } from "next";
import DashboardView from "@/app/components/Dashboard/DashboardView";
import PageHeader from "@/app/components/ui/PageHeader";
import { getDashboard } from "@/lib/queries/dashboard";

export const metadata: Metadata = { title: "Dashboard" };

/**
 * The dashboard at `/`, the app's home: each service type's next plan, with
 * its songs, their numbers and their hymnal notes, then what needs doing.
 * `getDashboard()` never throws: what could not be read is a warning on the
 * page, beside what still works. A render error falls through to
 * `app/(app)/error.tsx`. The page sits in the `(home)` route group so that
 * its `loading.tsx` covers this page alone: in `app/(app)/` it would wrap
 * every page.
 */
export default async function DashboardPage() {
    const dashboard = await getDashboard();

    return (
        <div className="font-sans">
            <PageHeader
                title="Dashboard"
                description="The next plan of each service type, and what needs doing."
            />
            <DashboardView dashboard={dashboard} />
        </div>
    );
}
