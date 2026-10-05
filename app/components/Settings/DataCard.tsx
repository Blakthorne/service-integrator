import { EXPORT_BACKUP_NOTE, EXPORT_DESCRIPTION } from "@/lib/catalog/exportText";
import ExportCatalogButton from "./ExportCatalogButton";
import SettingsCard from "./SettingsCard";

/**
 * The Data card of the Settings page: the catalog as a JSON file, to keep in
 * git. The card itself reads nothing: the button asks the server for the
 * catalog when it is pressed, so the card never waits and never fails the
 * page.
 */
export default function DataCard() {
    return (
        <SettingsCard title="Data" headingId="data-heading" description={EXPORT_DESCRIPTION}>
            <div className="space-y-4">
                <ExportCatalogButton />
                <p className="text-sm text-gray-600 dark:text-gray-300">{EXPORT_BACKUP_NOTE}</p>
            </div>
        </SettingsCard>
    );
}
