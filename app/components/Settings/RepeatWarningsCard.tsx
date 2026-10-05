import { SETTINGS_CARD_TITLES } from "@/lib/settingsText";
import RepeatWarningsForm from "./RepeatWarningsForm";
import SettingsCard from "./SettingsCard";

interface RepeatWarningsCardProps {
    /** The saved window, in weeks. */
    repeatWarningWeeks: number;
}

/**
 * The Repeat warnings card of the Settings page: how far back a song counts
 * as sung lately, so that its card on the Service Schedule tab of an
 * upcoming plan says when, and links to that plan. It reads only the local
 * database (its number comes from the page), so it never waits.
 */
export default function RepeatWarningsCard({ repeatWarningWeeks }: RepeatWarningsCardProps) {
    return (
        <SettingsCard
            title={SETTINGS_CARD_TITLES.repeatWarnings}
            headingId="repeat-warnings-heading"
            description="Flags a song on the Service Schedule tab of an upcoming plan when it was sung lately, from the plan history, with when and a link to that plan."
        >
            <RepeatWarningsForm repeatWarningWeeks={repeatWarningWeeks} />
        </SettingsCard>
    );
}
