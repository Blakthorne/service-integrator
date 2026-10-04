import type { EmailStatus } from "@/lib/email";
import { describeEmailTransport } from "@/lib/planEmailText";
import { SETTINGS_CARD_TITLES } from "@/lib/settingsText";
import EmailForm from "./EmailForm";
import EmailSetupNotice from "./EmailSetupNotice";
import SettingsCard from "./SettingsCard";

interface EmailCardProps {
    /** The saved recipients. */
    recipients: readonly string[];
    /** The saved subject template. */
    subjectTemplate: string;
    /** Whether email is set up on the server (`getEmailStatus`: it reads only the environment). */
    status: EmailStatus;
}

/** The colours of each state's dot and words: the words carry the state, the colour only backs them up. */
const TONE_CLASSES = {
    ok: { dot: "bg-green-500", text: "text-green-700 dark:text-green-400" },
    warning: { dot: "bg-amber-500", text: "text-amber-800 dark:text-amber-300" },
} as const;

/**
 * The Email card of the Settings page: whether the server can send email at
 * all (`SMTP_URL` and `EMAIL_FROM` are set in its environment, which the app
 * reads when it starts; what is missing is said, and never a value), then
 * who a plan's email goes to and what its subject says. It reads only the
 * environment and the local database, so it never waits.
 */
export default function EmailCard({ recipients, subjectTemplate, status }: EmailCardProps) {
    const transport = describeEmailTransport(status);
    const { dot, text } = TONE_CLASSES[transport.tone];
    return (
        <SettingsCard
            title={SETTINGS_CARD_TITLES.email}
            headingId="email-heading"
            description="Email this plan, on a plan's page, shows the email first and then sends it: the plan's schedule text and its songs' copyright text, as plain text, to these addresses."
        >
            <div className="mb-6 space-y-3 border-b border-gray-200 pb-6 dark:border-gray-700">
                <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                    On the server
                </h3>
                <p className={`inline-flex items-center gap-2 text-sm font-medium ${text}`}>
                    <span aria-hidden="true" className={`size-2.5 shrink-0 rounded-full ${dot}`} />
                    {transport.status}
                </p>
                {transport.detail && (
                    <p className="text-sm text-gray-700 dark:text-gray-300">{transport.detail}</p>
                )}
                {transport.setup && <EmailSetupNotice setup={transport.setup} />}
            </div>
            <EmailForm recipients={recipients} subjectTemplate={subjectTemplate} />
        </SettingsCard>
    );
}
