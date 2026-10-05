import type { Metadata } from "next";
import DatabaseCard from "@/app/components/Settings/DatabaseCard";
import PageHeader from "@/app/components/ui/PageHeader";
import { getDatabaseStatus } from "@/lib/queries/system";

export const metadata: Metadata = { title: "Settings" };

/**
 * The Settings page. For now it shows whether the database works. It reads
 * only the local database, which is quick and never throws, so it has no
 * loading or error boundary of its own.
 */
export default function SettingsPage() {
    const status = getDatabaseStatus();

    return (
        <div className="font-sans">
            <PageHeader
                title="Settings"
                description="The app's database and its backups."
            />
            <DatabaseCard status={status} />
        </div>
    );
}
