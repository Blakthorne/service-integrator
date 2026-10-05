import type { HymnNoteCategories } from "@/lib/queries/hymnNotes";
import type { AppSettings } from "@/lib/settings";
import {
    NO_SERVICE_TYPES_TEXT,
    SERVICE_TYPES_UNAVAILABLE_TEXT,
    SETTINGS_CARD_TITLES,
    headerLabelRows,
} from "@/lib/settingsText";
import { FormNotice } from "../Catalog/SongForm/Fields";
import ScheduleTextForm from "./ScheduleTextForm";
import SettingsCard, { SettingsCardFallback } from "./SettingsCard";

const HEADING_ID = "schedule-text-heading";

/** What the Schedule text card shows while Planning Center is asked for the service types. */
export function ScheduleTextCardFallback() {
    return (
        <SettingsCardFallback
            title={SETTINGS_CARD_TITLES.scheduleText}
            headingId={HEADING_ID}
            label="Reading the service types from Planning Center…"
        />
    );
}

interface ScheduleTextCardProps {
    settings: AppSettings;
    /**
     * The service types, from the read the Hymnal notes card shares
     * (`getHymnNoteCategories`, which never rejects). The page starts it
     * before it renders, so this card streams in when it is back.
     */
    categories: Promise<HymnNoteCategories>;
}

/**
 * The Schedule text card of the Settings page: the header label of each
 * service type and the number separator of the Service Schedule tab's text
 * (and of the hymnal notes). It lists the service types from Planning
 * Center, so it waits for them, in a Suspense boundary of the page's; when
 * Planning Center cannot be reached it says so, never fails the page, and
 * the separator can still be saved, which keeps every label already saved.
 */
export default async function ScheduleTextCard({ settings, categories }: ScheduleTextCardProps) {
    const read = await categories;
    const rows = read.ok
        ? headerLabelRows(
              read.serviceTypes.map(({ serviceType }) => serviceType),
              settings.scheduleHeaderLabels
          )
        : [];

    return (
        <SettingsCard
            title={SETTINGS_CARD_TITLES.scheduleText}
            headingId={HEADING_ID}
            description="The text the Service Schedule tab copies for each plan: its header line, and how a song's numbers are joined."
        >
            {!read.ok && (
                <div className="mb-4">
                    <FormNotice tone="warning">
                        <p>{SERVICE_TYPES_UNAVAILABLE_TEXT}</p>
                        <p className="break-words">The reason: {read.error}</p>
                    </FormNotice>
                </div>
            )}
            {read.ok && rows.length === 0 && (
                <p className="mb-4 text-sm text-gray-600 dark:text-gray-300">
                    {NO_SERVICE_TYPES_TEXT}
                </p>
            )}
            <ScheduleTextForm rows={rows} numberSeparator={settings.numberSeparator} />
        </SettingsCard>
    );
}
