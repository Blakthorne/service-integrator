/** The classes the dashboard's parts share. */

/** A card: a plan, or the to-do list. */
export const CARD_CLASS =
    "bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden";

/** A section's heading above its cards: "Next plans", "To do". */
export const SECTION_HEADING_CLASS = "text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4";

/** A link in running text. */
export const LINK_CLASS =
    "text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:underline";

/**
 * A card's heading link. Lighter than `LINK_CLASS` in dark mode, where the
 * card's header is gray-700: blue-400 on it is under 4.5:1.
 */
export const HEADING_LINK_CLASS =
    "text-blue-600 hover:text-blue-800 dark:text-blue-300 dark:hover:text-blue-200 hover:underline";

/** A quiet warning, the amber box the plans list gives when a service type fails. */
export const NOTICE_CLASS =
    "rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200";
