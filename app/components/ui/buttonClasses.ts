/**
 * Each variant's colours. White text needs 4.5:1 against the button: blue-600
 * gives 5.3:1, red-600 4.8:1. The focus ring sits outside the button, so it
 * needs 3:1 against the page: blue-600 on white, blue-400 on dark grey.
 */
const VARIANT_CLASSES = {
    primary: {
        colour: "text-white bg-blue-600 focus:ring-blue-600 dark:focus:ring-blue-400",
        hover: "hover:bg-blue-700",
    },
    danger: {
        colour: "text-white bg-red-600 focus:ring-red-500",
        hover: "hover:bg-red-700",
    },
    secondary: {
        colour: "text-gray-700 bg-white border border-gray-300 focus:ring-blue-600 dark:text-gray-300 dark:bg-gray-700 dark:border-gray-600 dark:focus:ring-blue-400",
        hover: "hover:bg-gray-50 dark:hover:bg-gray-600",
    },
} as const;

/**
 * How a button looks, whatever it is for: "primary" is the page's main
 * action, "danger" an action that deletes or throws something away, and
 * "secondary" a quieter one that should not draw the eye (Reconcile's
 * Ignore, Undo and Unignore).
 */
export type ButtonVariant = keyof typeof VARIANT_CLASSES;

/** What every variant shares: its shape, and the focus ring, which has an offset that matches the page in dark mode. */
const BASE_CLASSES =
    "px-4 py-2 text-sm font-medium rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-gray-800 transition-colors";

/**
 * The classes of a solid button, the one place the app's buttons get their
 * look from: `ui/SubmitButton` (a form action's, which reads `useFormStatus`)
 * and the buttons that take their pending state from `useState`, which the
 * Settings page's Save and Sync now are. While `pending` the button is faded
 * and shows no hover, and its cursor says it is not available; it is still
 * focusable, so the caller keeps it `aria-disabled` and not `disabled`.
 */
export function buttonClasses(variant: ButtonVariant = "primary", pending = false): string {
    const { colour, hover } = VARIANT_CLASSES[variant];
    return `${BASE_CLASSES} ${colour} ${pending ? "opacity-60 cursor-not-allowed" : `cursor-pointer ${hover}`}`;
}
