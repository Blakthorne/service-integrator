import type { Metadata } from "next";
import DatabaseCard from "@/app/components/Settings/DatabaseCard";
import PcoSyncCard from "@/app/components/Settings/PcoSyncCard";
import PageHeader from "@/app/components/ui/PageHeader";
import { getDatabaseStatus, getLastPcoSongsSync } from "@/lib/queries/system";

export const metadata: Metadata = { title: "Settings" };

/**
 * The Settings page: whether the database works, and the Planning Center
 * song sync with Sync now. It reads only the local database, which is quick,
 * and neither query throws, so it has no loading or error boundary of its
 * own.
 */
export default function SettingsPage() {
    const status = getDatabaseStatus();
    const sync = getLastPcoSongsSync();

    return (
        <div className="font-sans">
            <PageHeader
                title="Settings"
                description="The app's database, its backups and the Planning Center sync."
            />
            <div className="space-y-6">
                <DatabaseCard status={status} />
                <PcoSyncCard status={sync} />
            </div>
        </div>
    );
}
