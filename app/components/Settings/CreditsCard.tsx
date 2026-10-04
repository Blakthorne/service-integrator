import type { CreditPhrases } from "@/lib/settings";
import { SETTINGS_CARD_TITLES } from "@/lib/settingsText";
import CreditsForm from "./CreditsForm";
import SettingsCard from "./SettingsCard";

interface CreditsCardProps {
    /** The saved credit roles, in order. */
    creditRoles: readonly string[];
    /** The saved credit phrases, by role. */
    creditPhrases: CreditPhrases;
}

/**
 * The Credits card of the Settings page: the roles a song's credits name
 * (Words, Music, Arr., Trans. by default) and the phrase the copyright text
 * prints before each one's names. It reads only the local database (the
 * roles and phrases come from the page), so it never waits.
 */
export default function CreditsCard({ creditRoles, creditPhrases }: CreditsCardProps) {
    return (
        <SettingsCard
            title={SETTINGS_CARD_TITLES.credits}
            headingId="credits-heading"
            description='A song&apos;s author field in Planning Center can say who wrote its words and music, and who arranged or translated it, with a role before each name: "Words: Isaac Watts; Music: Lowell Mason". These are those roles, and the phrases the copyright text prints before their names.'
        >
            <CreditsForm creditRoles={creditRoles} creditPhrases={creditPhrases} />
        </SettingsCard>
    );
}
