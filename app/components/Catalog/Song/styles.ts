/**
 * The looks the song page's Planning Center cards share: the small buttons
 * inside their forms, and the boxes that say how an action went. Their
 * solid buttons take their look from `ui/buttonClasses`, as every page's do.
 */

/** A small button inside a form (Split into names): white or the dark card's grey. */
export const SMALL_BUTTON_CLASS =
    "px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors cursor-pointer aria-disabled:opacity-60 aria-disabled:cursor-not-allowed";

/**
 * "Add a name", which every role of the credit editor has: blue text with
 * no border, so a column of them does not crowd the fields (blue-600 is
 * 5.2:1 on white, blue-400 6:1 on the dark card).
 */
export const ADD_NAME_BUTTON_CLASS =
    "self-start rounded-md px-2 py-1 -ml-2 text-sm font-medium text-blue-600 hover:text-blue-800 hover:bg-blue-50 dark:text-blue-400 dark:hover:text-blue-300 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors cursor-pointer aria-disabled:opacity-60 aria-disabled:cursor-not-allowed";

/** Remove, red in words and colour: 6.5:1 on white, 6.3:1 on the dark card. */
export const REMOVE_BUTTON_CLASS =
    "shrink-0 px-3 py-1.5 text-sm font-medium text-red-700 dark:text-red-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors cursor-pointer aria-disabled:opacity-60 aria-disabled:cursor-not-allowed";

/** What an action refused or what failed: an alert, keyed per attempt. */
export const ALERT_CLASS =
    "rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200";

/** What went as planned but needs reading: a warning after a create, a note on a deleted song. */
export const WARNING_CLASS =
    "rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100";

/** What an action did, beside its button. */
export const DONE_CLASS = "text-sm font-medium text-green-700 dark:text-green-400";

/** A box around a preview of what an action will write. */
export const PREVIEW_BOX_CLASS =
    "rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 px-3 py-2 space-y-1";
