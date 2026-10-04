import type { SettingIssue } from "@/lib/settings";
import { describeSettingIssue } from "@/lib/settingsText";

interface SettingsIssuesCardProps {
    /** The stored settings that no longer parse, whose defaults are in use. */
    issues: readonly SettingIssue[];
    /** Why the saved settings could not be read at all (the defaults are shown), or null. */
    error: string | null;
}

const CARD_CLASS =
    "max-w-3xl mx-auto rounded-lg border border-amber-300 bg-amber-50 text-amber-950 shadow-sm p-6 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-50";

/**
 * A warning at the top of the Settings page, only when there is something to
 * warn of, about settings the forms below cannot show as they are stored:
 *
 * - `error`: the saved settings could not be read at all, so every form
 *   shows the defaults, and saving fails until the database works (the
 *   Database card below says why);
 * - `issues`: stored values that no longer parse (a value another build
 *   saved, say). Each is named with what is stored, why it is refused, the
 *   default now in use and the card that replaces it: saving that card does.
 *
 * Nothing when both are empty.
 */
export default function SettingsIssuesCard({ issues, error }: SettingsIssuesCardProps) {
    if (error !== null) {
        return (
            <section aria-labelledby="settings-issues-heading" className={CARD_CLASS}>
                <h2 id="settings-issues-heading" className="mb-2 text-xl font-semibold">
                    Saved settings could not be read
                </h2>
                <p className="text-sm">
                    The forms below show the defaults, and saving fails until the database works.
                    The Database card says more.
                </p>
                <p className="mt-2 text-sm break-words">The reason: {error}</p>
            </section>
        );
    }
    if (issues.length === 0) {
        return null;
    }
    return (
        <section aria-labelledby="settings-issues-heading" className={CARD_CLASS}>
            <h2 id="settings-issues-heading" className="mb-2 text-xl font-semibold">
                Saved settings that could not be used
            </h2>
            <p className="mb-4 text-sm">
                These saved values are not valid, so the app is using the defaults. Saving the
                card that edits a setting replaces its saved value.
            </p>
            <ul role="list" className="divide-y divide-amber-200 dark:divide-amber-800">
                {issues.map((issue) => {
                    const text = describeSettingIssue(issue);
                    return (
                        <li key={issue.key} className="py-3 first:pt-0 last:pb-0 text-sm">
                            <p className="font-semibold">
                                {text.label}
                                <span className="font-normal"> (the {text.card} card)</span>
                            </p>
                            <p className="mt-1 break-words">
                                Saved: <code className="break-all">{text.stored}</code>
                            </p>
                            <p className="break-words">{text.message}</p>
                            <p className="break-words">{text.usingDefault}</p>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}
