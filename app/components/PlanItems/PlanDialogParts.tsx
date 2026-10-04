/**
 * What the plan header's dialogs (Sync hymn notes, Email this plan) share:
 * the look of their buttons and links, the row of buttons along the bottom,
 * and the line that takes focus when an action answers.
 */

/** White on blue-600 is 5.3:1, and the focus ring outside the button 3:1 on the dialog. */
export const PRIMARY_BUTTON_CLASS =
    "px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-600 dark:focus:ring-blue-400 focus:ring-offset-2 dark:focus:ring-offset-gray-800 transition-colors";

export const SECONDARY_BUTTON_CLASS =
    "px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed";

/** A link in running text: underlined, since its colour alone is under 3:1 against the text's. */
export const LINK_CLASS =
    "text-blue-600 underline hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300";

/** The buttons along the bottom of a dialog. */
export function DialogButtons({ children }: { children: React.ReactNode }) {
    return <div className="mt-5 flex flex-wrap justify-end gap-3">{children}</div>;
}

interface DialogAnswerProps {
    /** The ref the dialog focuses when an action answers, so the answer is read out. */
    answerRef: React.RefObject<HTMLParagraphElement | null>;
    /** A failure: an alert, red unless `quiet`. */
    alert?: boolean;
    /**
     * The answer is an alert but not red: the results' summary, which says
     * what was done as well as what failed.
     */
    quiet?: boolean;
    /** Counts the actions run, to key each alert, so the same words are announced again. */
    attempt?: number;
    children: React.ReactNode;
}

/**
 * A message that takes focus when it arrives. A failure is an alert, keyed
 * per attempt, and red unless `quiet`.
 */
export function DialogAnswer({
    answerRef,
    alert,
    quiet = false,
    attempt,
    children,
}: DialogAnswerProps) {
    return (
        <p
            key={alert ? attempt : undefined}
            ref={answerRef}
            tabIndex={-1}
            role={alert ? "alert" : undefined}
            className={`text-sm focus:outline-none ${
                alert && !quiet ? "text-red-600 dark:text-red-400" : "text-gray-900 dark:text-gray-100"
            }`}
        >
            {children}
        </p>
    );
}
