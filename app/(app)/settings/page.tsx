import type { Metadata } from "next";
import { Suspense } from "react";
import CopyrightCard from "@/app/components/Settings/CopyrightCard";
import DatabaseCard from "@/app/components/Settings/DatabaseCard";
import HymnalNotesCard from "@/app/components/Settings/HymnalNotesCard";
import PcoSyncCard from "@/app/components/Settings/PcoSyncCard";
import RecentWritesCard from "@/app/components/Settings/RecentWritesCard";
import ScheduleTextCard, {
    ScheduleTextCardFallback,
} from "@/app/components/Settings/ScheduleTextCard";
import SettingsIssuesCard from "@/app/components/Settings/SettingsIssuesCard";
import PageHeader from "@/app/components/ui/PageHeader";
import { withDeadline } from "@/lib/deadline";
import { getHymnNoteCategories } from "@/lib/queries/hymnNotes";
import { getRecentWrites, getSettings, getSettingsIssues } from "@/lib/queries/settings";
import { getDatabaseStatus, getLastPcoSongsSync } from "@/lib/queries/system";
import { PCO_WAIT_MS, pcoTimedOutReason } from "@/lib/settingsText";

export const metadata: Metadata = { title: "Settings" };

/**
 * The Settings page. The everyday settings come first, a card and a form
 * each (Copyright, Schedule text, Hymnal notes), then what the app has
 * written to Planning Center, then the song sync and the database.
 *
 * Everything reads the local database, which is quick, and no query throws.
 * Two cards also need Planning Center, for the service types and the item
 * note categories in each: the page starts that one read before it renders
 * (`getHymnNoteCategories`, which never rejects) and the cards that need it
 * wait for it under their own Suspense boundaries, so the rest of the page
 * is on screen at once and Planning Center being slow or down never holds
 * back, or fails, the page. So the page has no loading or error boundary of
 * its own.
 *
 * The wait has a deadline (`PCO_WAIT_MS`). While the page's response is
 * still open, a navigation away from it waits too, and a Planning Center
 * that hangs can take 15 s for each of the two reads in turn: it must not
 * hold the page, or the way out of it, for that long. When the deadline
 * passes the cards say that Planning Center did not answer, as they do when
 * it fails.
 */
export default function SettingsPage() {
    const { settings, error } = getSettings();
    const issues = getSettingsIssues();
    const recentWrites = getRecentWrites();
    const status = getDatabaseStatus();
    const sync = getLastPcoSongsSync();
    const categories = withDeadline(getHymnNoteCategories(), PCO_WAIT_MS, () => ({
        ok: false as const,
        error: pcoTimedOutReason(PCO_WAIT_MS),
    }));

    return (
        <div className="font-sans">
            <PageHeader
                title="Settings"
                description="The text the app writes, what it writes to Planning Center, the song sync and the database."
            />
            <div className="space-y-6">
                <SettingsIssuesCard issues={issues} error={error} />
                <CopyrightCard ccliLicenseNumber={settings.ccliLicenseNumber} />
                <Suspense fallback={<ScheduleTextCardFallback />}>
                    <ScheduleTextCard settings={settings} categories={categories} />
                </Suspense>
                <HymnalNotesCard settings={settings} categories={categories} />
                <RecentWritesCard recent={recentWrites} />
                <PcoSyncCard status={sync} />
                <DatabaseCard status={status} />
            </div>
        </div>
    );
}
