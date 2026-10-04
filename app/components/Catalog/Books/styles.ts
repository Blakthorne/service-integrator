/**
 * The looks the books pages' forms and lists share. Buttons take theirs from
 * `ui/buttonClasses`; these are for what it does not cover.
 */

/** What an action refused or what failed: an alert, keyed per attempt. */
export const ALERT_CLASS =
    "rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200";

/** A boxed sentence that explains what a choice does, such as what a book not in use leaves out. */
export const EXPLAIN_CLASS =
    "rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-100";

/**
 * A link in running text: underlined as well as coloured, since blue against
 * the grey around it is under the 3:1 a link needs to be told apart by
 * colour alone (convention 20).
 */
export const TEXT_LINK_CLASS =
    "text-blue-600 underline underline-offset-2 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300";
