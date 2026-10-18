import Link from "next/link";
import { routes } from "@/lib/routes";
import { SETTINGS_CARD_TITLES } from "@/lib/settingsText";
import NewSongCreditsForm from "./NewSongCreditsForm";
import SettingsCard from "./SettingsCard";

interface NewSongCreditsCardProps {
    /** When labelling new songs automatically was turned on; null while it is off. */
    since: string | null;
}

/**
 * The New songs' credits card of the Settings page: whether the app labels
 * the author of a song added to Planning Center by itself, in the credits
 * convention, when it has one name or two joined by "and" and its
 * copyright text stays the same. It reads only the local database (its
 * value comes from the page), so it never waits.
 */
export default function NewSongCreditsCard({ since }: NewSongCreditsCardProps) {
    return (
        <SettingsCard
            title={SETTINGS_CARD_TITLES.newSongCredits}
            headingId="new-song-credits-heading"
            description={
                <>
                    When a song added to Planning Center has an author that is not labelled yet, the
                    app labels it by itself if it names one person, or two joined by “and” (words,
                    then music), and the copyright text stays the same. Any other new song waits on
                    the{" "}
                    <Link
                        href={routes.catalogCredits()}
                        // In a line of text, blue against the grey around it is under the 3:1
                        // a link needs to be told apart by colour alone, so it is underlined.
                        className="text-blue-600 underline underline-offset-2 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                    >
                        Credits page
                    </Link>
                    , and the dashboard lists it. The app labels a song by itself once at most.
                </>
            }
        >
            <NewSongCreditsForm since={since} />
        </SettingsCard>
    );
}
