import { Suspense } from "react";
import type { HymnNoteCategories } from "@/lib/queries/hymnNotes";
import type { AppSettings } from "@/lib/settings";
import { SETTINGS_CARD_TITLES } from "@/lib/settingsText";
import HymnalCategoryStatus from "./HymnalCategoryStatus";
import HymnalNotesForm from "./HymnalNotesForm";
import SettingsCard from "./SettingsCard";

interface HymnalNotesCardProps {
    settings: AppSettings;
    /**
     * The category in each service type, from the read the Schedule text card
     * shares (`getHymnNoteCategories`, which never rejects). The page starts
     * it before it renders.
     */
    categories: Promise<HymnNoteCategories>;
}

/**
 * The Hymnal notes card of the Settings page: the name of the item note
 * category the notes go in, whether a note names the tune, and, under the
 * form, whether each service type has that category (a warning, with how to
 * create it, where it is missing). The form comes from the local database
 * and is on screen at once; the service types' status asks Planning Center,
 * so it streams in under its own Suspense boundary, and says so when
 * Planning Center cannot be reached.
 */
export default function HymnalNotesCard({ settings, categories }: HymnalNotesCardProps) {
    return (
        <SettingsCard
            title={SETTINGS_CARD_TITLES.hymnalNotes}
            headingId="hymnal-notes-heading"
            description="Sync hymn notes, on a plan's page, writes each song's numbers into an item note in Planning Center for the musicians. The notes go in a category that has to exist in each service type."
        >
            <HymnalNotesForm
                categoryName={settings.hymnNoteCategoryName}
                includesTune={settings.hymnNoteIncludesTune}
                numberSeparator={settings.numberSeparator}
            />
            <div className="mt-6 border-t border-gray-200 dark:border-gray-700 pt-6">
                <h3 className="mb-3 text-base font-semibold text-gray-900 dark:text-gray-100">
                    In Planning Center
                </h3>
                <Suspense
                    fallback={
                        <p role="status" className="text-sm text-gray-600 dark:text-gray-300">
                            Checking each service type in Planning Center…
                        </p>
                    }
                >
                    <HymnalCategoryStatus categories={categories} />
                </Suspense>
            </div>
        </SettingsCard>
    );
}
