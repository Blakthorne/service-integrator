import type { EmailSetupText } from "@/lib/planEmailText";
import { FormNotice } from "../Catalog/SongForm/Fields";

interface EmailSetupNoticeProps {
    setup: EmailSetupText;
}

/**
 * Why email cannot be sent, and what to do: which of `SMTP_URL` and
 * `EMAIL_FROM` are not set or not usable, what each holds, and that the
 * server's `.env.production` needs them. The plan's Email dialog and
 * Settings' Email card both show it, from `describeEmailSetup`.
 */
export default function EmailSetupNotice({ setup }: EmailSetupNoticeProps) {
    return (
        <FormNotice tone="warning">
            <p>{setup.headline}</p>
            {setup.variables.length > 0 && (
                <>
                    <p>Not set, or not usable:</p>
                    <ul role="list" className="list-disc space-y-1 pl-5">
                        {setup.variables.map(({ name, help }) => (
                            <li key={name} className="break-words">
                                <code className="font-mono font-semibold">{name}</code>: {help}
                            </li>
                        ))}
                    </ul>
                </>
            )}
            <p>{setup.howTo}</p>
        </FormNotice>
    );
}
