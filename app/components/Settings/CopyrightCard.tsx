import { SETTINGS_CARD_TITLES } from "@/lib/settingsText";
import CopyrightForm from "./CopyrightForm";
import SettingsCard from "./SettingsCard";

interface CopyrightCardProps {
    /** The saved CCLI license number. */
    ccliLicenseNumber: string;
}

/**
 * The Copyright card of the Settings page: the license number that ends
 * every song's copyright text on the plan pages. It reads only the local
 * database (its number comes from the page), so it never waits.
 */
export default function CopyrightCard({ ccliLicenseNumber }: CopyrightCardProps) {
    return (
        <SettingsCard
            title={SETTINGS_CARD_TITLES.copyright}
            headingId="copyright-heading"
            description="The church's license number, on the last line of every song's copyright text on the plan pages."
        >
            <CopyrightForm ccliLicenseNumber={ccliLicenseNumber} />
        </SettingsCard>
    );
}
