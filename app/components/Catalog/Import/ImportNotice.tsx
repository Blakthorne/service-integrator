import type { ReactNode } from "react";

const TONE_STYLES = {
    info: "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200",
    warning:
        "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200",
    success:
        "border-green-200 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-200",
    neutral:
        "border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300",
} as const;

interface ImportNoticeProps {
    /** "warning" is for what stops Apply; "info", "success" and "neutral" say where a run stands. */
    tone: keyof typeof TONE_STYLES;
    /** The id of the sentence, for a control that names it with `aria-describedby`. */
    id?: string;
    /** Buttons for what the notice is about: beside the sentence, and below it on a phone. */
    actions?: ReactNode;
    children: ReactNode;
}

/** A boxed sentence or two above an import page's content, with the buttons it is about, if any. */
export default function ImportNotice({
    tone,
    id,
    actions,
    children,
}: ImportNoticeProps) {
    const box = `rounded-lg border px-4 py-3 text-sm ${TONE_STYLES[tone]}`;

    if (!actions) {
        return (
            <p id={id} className={box}>
                {children}
            </p>
        );
    }
    return (
        <div
            className={`${box} flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6`}
        >
            <p id={id}>{children}</p>
            <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
                {actions}
            </div>
        </div>
    );
}
