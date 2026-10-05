import type { CreditLabelSet } from "@/lib/creditRoleImpact";
import type { CreditPhrases } from "@/lib/settings";
import { SETTINGS_CARD_TITLES } from "@/lib/settingsText";
import CreditsForm from "./CreditsForm";
import SettingsCard from "./SettingsCard";

interface CreditsCardProps {
    /** The saved credit roles, in order. */
    creditRoles: readonly string[];
    /** The saved credit phrases, by role. */
    creditPhrases: CreditPhrases;
    /**
     * The labels the songs' authors use, read with the saved roles
     * (`getCreditLabelSets`), so the form can show what new roles would do
     * to them; null when they could not be read.
     */
    labelSets: readonly CreditLabelSet[] | null;
}

/**
 * The Credits card of the Settings page: the roles a song's credits name
 * (Words, Music, Arr., Trans. by default) and the phrase the copyright text
 * prints before each one's names. It reads only the local database (the
 * roles, the phrases and the songs' labels come from the page), so it never
 * waits.
 */
export default function CreditsCard({ creditRoles, creditPhrases, labelSets }: CreditsCardProps) {
    return (
        <SettingsCard
            title={SETTINGS_CARD_TITLES.credits}
            headingId="credits-heading"
            description='A song&apos;s author field in Planning Center can say who wrote its words and music, and who arranged or translated it, with a role before each name: "Words: Isaac Watts; Music: Lowell Mason". These are those roles, and the phrases the copyright text prints before their names.'
        >
            <CreditsForm
                creditRoles={creditRoles}
                creditPhrases={creditPhrases}
                labelSets={labelSets}
            />
        </SettingsCard>
    );
}
