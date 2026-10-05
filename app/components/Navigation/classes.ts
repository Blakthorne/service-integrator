/** The classes the top bar's links share. */

/**
 * A keyboard focus ring outside the link, so it shows on a filled (current)
 * link too: the browser's own ring, drawn on the link's edge, all but
 * vanished against the blue fill.
 */
export const NAV_FOCUS_CLASS =
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:focus-visible:outline-blue-400";

/**
 * The classes of a nav link drawn as an icon: a 40 px square on phones (a
 * touch target), 36 px from `sm`, filled when it is the current page or
 * section, like the section links.
 */
export function navIconLinkClassName(active: boolean): string {
    return `inline-flex items-center justify-center size-10 sm:size-9 rounded-md transition-colors ${NAV_FOCUS_CLASS} ${
        active
            ? "bg-blue-600 text-white"
            : "text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
    }`;
}
