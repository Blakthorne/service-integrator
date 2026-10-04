interface SaveButtonProps {
    /** True while the save is under way. */
    pending: boolean;
    /** The button's text, naming its card: "Save copyright". */
    children: React.ReactNode;
}

/**
 * The Save button of a Settings form. It looks as `ui/SubmitButton`'s primary
 * variant does (white text is 5.3:1 on blue-600, and the focus ring outside
 * it 3:1 against the page), but takes `pending` as a prop: `SubmitButton`
 * reads `useFormStatus`, which these forms do not use (see `useSettingsForm`).
 *
 * While pending it says "Saving…" and ignores clicks. It is `aria-disabled`,
 * not `disabled`: a disabled button loses focus, which would leave a keyboard
 * user on the page's body when the save comes back with a refusal.
 */
export default function SaveButton({ pending, children }: SaveButtonProps) {
    return (
        <button
            type="submit"
            aria-disabled={pending}
            onClick={(event) => {
                // Stops the form submitting again; Enter in a field submits through this click too.
                if (pending) {
                    event.preventDefault();
                }
            }}
            className={`px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-600 dark:focus:ring-blue-400 focus:ring-offset-2 dark:focus:ring-offset-gray-800 transition-colors ${
                pending ? "opacity-60 cursor-not-allowed" : "cursor-pointer hover:bg-blue-700"
            }`}
        >
            {pending ? "Saving…" : children}
        </button>
    );
}
